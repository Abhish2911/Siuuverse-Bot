require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Collection, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const express = require('express');
const { sendAuditLog } = require('./utils/helpers');
const {
  refreshAllHFLiveMessages,
  startHFLiveUpdater
} = require('./utils/handfootballLive');
const { RoleCooldown, RolePing } = require('./models/rolehandler');
const { restoreStoredAnnouncements } = require('./utils/hfAnnouncements');
const { runWithHFTournament, getLegacyStatsMigrationGuildId } = require('./utils/hfTournamentConfig');
const TournamentStats = require('./models/TournamentStats');
require('./models/HFTournament');
const { restorePenaltyRoyaleTimers, handlePenaltyRoyaleDm } = require('./utils/penaltyRoyale');
const { getGuildPrefix } = require('./utils/guildPrefix');
const { executeModerationPrefix } = require('./utils/moderation');
const GrokGuildSettings = require('./models/GrokGuildSettings');
const GuildModuleSettings = require('./models/GuildModuleSettings');
const { isGuildModuleEnabled } = require('./utils/guildModules');

// Keep unexpected failures visible to the host logs without exposing internal
// details (tokens, database errors, stack traces, etc.) to Discord users.
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error);
});

function startHealthServer() {
  const app = express();
  const port = process.env.PORT || 10000;

  app.get('/', (req, res) => {
    res.status(200).send('SiuuVerse bot is running.');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true, service: 'siuuverse-bot' });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Health server listening on port ${port}`);
  });
}

startHealthServer();

function ensureGoogleCredentialsFile() {
  const credentials = process.env.GOOGLE_CREDENTIALS;

  if (!credentials) return;

  const shouldCreateCredentialsFile =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    process.env.NODE_ENV === 'production';

  // Locally, keep using your normal credentials.json file and avoid nodemon restart loops.
  if (!shouldCreateCredentialsFile) {
    return;
  }

  const credentialsPath = path.join(__dirname, 'credentials.json');

  // Prevent nodemon restart loop locally because credentials.json is watched as a JSON file.
  if (fs.existsSync(credentialsPath)) {
    return;
  }

  try {
    const parsed = JSON.parse(credentials);

    if (parsed.private_key) {
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    }

    fs.writeFileSync(credentialsPath, JSON.stringify(parsed, null, 2));
    console.log('✅ Google credentials file created from environment variable');
  } catch (error) {
    fs.writeFileSync(credentialsPath, credentials);
    console.log('✅ Google credentials file created from raw environment variable');
  }
}

ensureGoogleCredentialsFile();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  // DM channels are partial until Discord sends a message through them.
  // Keeping the Channel partial lets Penalty Royale receive numbered DM replies.
  partials: [Partials.Channel]
});

async function connectMongo() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.log('⚠️ MongoDB URI not set. Skipping MongoDB connection.');
    return;
  }

  try {
    // Do not let an unreachable MongoDB instance prevent the Discord gateway
    // from connecting. Commands that need MongoDB will report their own error.
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000
    });
    // Older versions stored one global stat row per player. Remove that
    // constraint so the same Discord user can have independent HF stats in
    // multiple servers, then create the guild + player unique index.
    await TournamentStats.collection.dropIndex('userId_1').catch(error => {
      if (error?.codeName !== 'IndexNotFound') throw error;
    });
    await TournamentStats.collection.dropIndex('guildId_1_userId_1').catch(error => {
      if (error?.codeName !== 'IndexNotFound') throw error;
    });
    await TournamentStats.syncIndexes();
    await GrokGuildSettings.syncIndexes();
    await GuildModuleSettings.syncIndexes();
    const legacyStatsGuildId = getLegacyStatsMigrationGuildId();
    if (legacyStatsGuildId) {
      const migrated = await TournamentStats.updateMany(
        { $or: [{ guildId: 'legacy' }, { guildId: { $exists: false } }] },
        { $set: { guildId: legacyStatsGuildId } }
      );
      if (migrated.modifiedCount) {
        console.log(`✅ Moved ${migrated.modifiedCount} legacy HF stat rows to ${legacyStatsGuildId}`);
      }
    }
    console.log('✅ MongoDB connected');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    return false;
  }
}

client.commands = new Collection();
client.prefixCommands = new Collection();
const PREFIX = process.env.PREFIX || '.';

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }

    return await interaction.reply(payload);
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) {
      console.warn(`⚠️ Interaction reply skipped: ${error.message}`);
      return null;
    }

    throw error;
  }
}

async function safeDeferReply(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    return true;
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) {
      console.warn(`⚠️ Interaction defer skipped: ${error.message}`);
      return false;
    }

    throw error;
  }
}

async function safeDeferUpdate(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    return true;
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) {
      console.warn(`⚠️ Interaction update defer skipped: ${error.message}`);
      return false;
    }

    throw error;
  }
}

async function ensureModuleEnabled(interaction, moduleKey) {
  if (!moduleKey || !interaction.guildId) return true;
  if (await isGuildModuleEnabled(interaction.guildId, moduleKey)) return true;

  await safeReply(interaction, {
    content: `${moduleKey.toUpperCase()} commands are disabled in this server.`,
    ephemeral: true
  });
  return false;
}

function getComponentModule(customId) {
  const commandName = String(customId || '').split(/[_:]/, 1)[0];
  const normalizedName = commandName === 'md' ? 'fixtures' : commandName;
  const command = client.commands.get(normalizedName)
    || client.prefixCommands.get(normalizedName);
  return command?.moduleKey;
}

async function safeEditMessage(message, payload) {
  try {
    const freshMessage = await message.fetch().catch(() => null);
    if (!freshMessage) return null;
    return await freshMessage.edit(payload);
  } catch (error) {
    if (error?.code === 10008) {
      console.warn('⚠️ Message edit skipped: message no longer exists.');
      return null;
    }
    throw error;
  }
}

const commandFolders = [
  path.join(__dirname, 'commands'),
  path.join(__dirname, 'coop-commands'),
  path.join(__dirname, 'eco-commands')
];

// Load commands from all command folders
for (const commandsPath of commandFolders) {
  if (!fs.existsSync(commandsPath)) continue;

  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));

      if (!command.data || !command.execute) {
        console.log(`❌ Missing command data in ${file}`);
        continue;
      }

      if (path.basename(commandsPath) === 'coop-commands') command.moduleKey = 'coop';
      client.commands.set(command.data.name, command);
      if (command.prefix) client.prefixCommands.set(command.data.name, command);
      console.log(`✅ Loaded: ${file}`);
    } catch (err) {
      console.log(`❌ ERROR in ${file}:`, err.message);
    }
  }
}

const prefixCommandFolders = [
  path.join(__dirname, 'prefix'),
  path.join(__dirname, 'prefix-commands'),
  path.join(__dirname, 'penalty-royale-commands'),
  path.join(__dirname, 'scl-commands')
];
const sharedPrefixCommands = new Set(['setprefix', 'translate']);

// Load prefix commands and aliases
for (const prefixCommandsPath of prefixCommandFolders) {
  if (!fs.existsSync(prefixCommandsPath)) continue;

  const prefixCommandFiles = fs
    .readdirSync(prefixCommandsPath)
    .filter(file => file.endsWith('.js'));

  for (const file of prefixCommandFiles) {
    try {
      const command = require(path.join(prefixCommandsPath, file));
      const commandName = command.name || command.data?.name;

      if (!commandName || !command.execute) {
        console.log(`❌ Missing prefix command data in ${file}`);
        continue;
      }

      command.isHandFootball = prefixCommandsPath.endsWith('prefix-commands');
      if (path.basename(prefixCommandsPath) === 'prefix-commands'
        && !sharedPrefixCommands.has(commandName.toLowerCase())) {
        command.moduleKey = 'hf';
      }
      if (path.basename(prefixCommandsPath) === 'scl-commands') command.moduleKey = 'scl';

      client.prefixCommands.set(commandName.toLowerCase(), command);

      if (Array.isArray(command.aliases)) {
        for (const alias of command.aliases) {
          if (alias) {
            client.prefixCommands.set(String(alias).toLowerCase(), command);
          }
        }
      }

      console.log(`✅ Loaded prefix: ${file}`);
    } catch (err) {
      console.log(`❌ ERROR in prefix command ${file}:`, err.message);
    }
  }
}

client.once('clientReady', async () => {
  console.log(`🚀 Bot ready: ${client.user.tag}`);
  console.log(`📝 Audit log config: ${process.env.AUDIT_LOG_CHANNELS || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID || process.env.AUDIT_LOG_CHANNEL_ID || 'NOT SET'}`);

  const restoreCommands = [
    'setlivestats',
    'setlivestandings',
    'setlivestandings2'
  ];

  for (const commandName of restoreCommands) {
    try {
      const command = client.commands.get(commandName);

      if (command && typeof command.restore === 'function') {
        const restored = await command.restore(client);
        console.log(`${restored ? '✅' : '⚠️'} Restore ${commandName}: ${restored ? 'active' : 'not configured'}`);
      }
    } catch (error) {
      console.error(`❌ Restore error in ${commandName}:`, error);
    }
  }

  // Restore role mentionability after bot restarts
  try {
    const cooldowns = await RoleCooldown.find({});

    for (const config of cooldowns) {
      const pingData = await RolePing.findOne({
        guildId: config.guildId,
        roleId: config.roleId
      });

      if (!pingData?.lastPing) continue;

      const expiresAt = pingData.lastPing + config.cooldownMs;
      const remaining = expiresAt - Date.now();

      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) continue;

      const role = await guild.roles.fetch(config.roleId).catch(() => null);
      if (!role) continue;

      if (remaining <= 0) {
        if (!role.mentionable) {
          await role.setMentionable(true, 'Restored after cooldown expiry');
        }
        continue;
      }

      if (role.mentionable) {
        await role.setMentionable(false, 'Restored cooldown state after restart');
      }

      setTimeout(async () => {
        try {
          const freshRole = await guild.roles.fetch(config.roleId).catch(() => null);

          if (freshRole && !freshRole.mentionable) {
            await freshRole.setMentionable(true, 'Role cooldown expired');
          }
        } catch (err) {
          console.error('❌ Failed to restore role mentionability:', err);
        }
      }, remaining);
    }

    console.log('✅ Role cooldown states restored');
  } catch (error) {
    console.error('❌ Failed to restore role cooldowns:', error);
  }

  try {
    await startHFLiveUpdater(client);
    await refreshAllHFLiveMessages(client);
    console.log('✅ HandFootball live messages restored');
  } catch (error) {
    console.error('❌ Failed to restore HandFootball live messages:', error);
  }
});

client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

client.on('shardDisconnect', (event, shardId) => {
  console.error(`⚠️ Discord shard ${shardId} disconnected:`, event);
});

client.on('shardReconnecting', shardId => {
  console.warn(`🔄 Discord shard ${shardId} reconnecting`);
});

function getButtonOwnerId(customId) {
  const id = String(customId || '');

  if (id.startsWith('rpstats_')) return id.split('__').pop();
  if (id.startsWith('hfleaderboard_') || id.startsWith('hffixtures_')) return id.split('_').pop();
  if (id.startsWith('hfprofile_')) return id.split('_')[3];
  if (id.startsWith('myrpstats_') || id.startsWith('myrpprofile_')) return id.split('_')[1];
  if (id.startsWith('myrpclubstats_') || id.startsWith('myrpclubdetails_')) return id.split('_')[1];
  if (id.startsWith('myfixtures_')) return id.split('_').pop();
  return null;
}

async function denyButtonAccess(interaction) {
  await safeReply(interaction, {
    content: 'Only the user who opened this control can use it.',
    ephemeral: true
  }).catch(() => null);
}

function canManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
}

// Buttons which do not encode their owner must be from the original interaction
// author, or be used by a server manager. This also makes old, unowned controls
// safe instead of silently trusting any clicker.
function isOriginalInteractionUser(interaction) {
  const ownerId = interaction.message?.interactionMetadata?.user?.id
    || interaction.message?.interaction?.user?.id;
  return Boolean(ownerId && ownerId === interaction.user.id);
}

async function authorizeButton(interaction, policy) {
  if (policy === 'owner') {
    const ownerId = getButtonOwnerId(interaction.customId);
    if (ownerId && ownerId === interaction.user.id) return true;
    await denyButtonAccess(interaction);
    return false;
  }

  if (policy === 'ownerOrManageGuild' && (isOriginalInteractionUser(interaction) || canManageGuild(interaction))) {
    return true;
  }

  await denyButtonAccess(interaction);
  return false;
}

function editButtonMessage(interaction, result) {
  if (!result) return null;
  return safeEditMessage(interaction.message, { content: null, ...result });
}

// Every button is claimed here, with its access policy next to its route. Keep
// specific patterns above broad ones so the first matching entry owns the ID.
const buttonRegistry = [
  {
    match: id => id.startsWith('rpstats_'), policy: 'owner',
    handler: async interaction => {
      const command = client.commands.get('rpstats');
      if (!command?.buttonHandler) return;
      if (!await safeDeferUpdate(interaction)) return;
      const [, action, ...rest] = interaction.customId.split('_');
      return editButtonMessage(interaction, await command.buttonHandler(interaction, action, rest.join('_')));
    }
  },
  {
    match: id => id.startsWith('rpleaderboard_'), policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const command = client.commands.get('rpleaderboard');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const [, action, page] = interaction.customId.split('_');
      return editButtonMessage(interaction, await command.buttonHandler(interaction, action, page));
    }
  },
  {
    match: id => id.startsWith('hfleaderboard_mode_'), policy: 'owner',
    handler: async interaction => {
      const command = client.prefixCommands.get('hfleaderboard');
      if (!command?.modeButtonHandler || !await safeDeferUpdate(interaction)) return;
      const [, , mode, ownerId] = interaction.customId.split('_');
      return editButtonMessage(interaction, await command.modeButtonHandler(interaction, mode, ownerId));
    }
  },
  {
    match: id => id.startsWith('hfleaderboard_'), policy: 'owner',
    handler: async interaction => {
      const command = client.prefixCommands.get('hfleaderboard');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const [, action, statKey, page, ownerId] = interaction.customId.split('_');
      const result = await runWithHFTournament(interaction.guild, () => command.buttonHandler(interaction, action, statKey, page, ownerId));
      return editButtonMessage(interaction, result);
    }
  },
  {
    match: id => id.startsWith('hfprofile_'), policy: 'owner',
    handler: async interaction => {
      const command = client.prefixCommands.get('hfprofile');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      return editButtonMessage(interaction, await command.buttonHandler(interaction));
    }
  },
  {
    match: id => id.startsWith('pr_'), policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const command = client.prefixCommands.get('prcreate');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const result = await command.buttonHandler(interaction);
      if (result?.payload) await editButtonMessage(interaction, result.payload);
      if (result?.notice) await interaction.followUp({ content: result.notice, ephemeral: true }).catch(() => null);
    }
  },
  {
    match: id => id.startsWith('captainpanel_resultformat:'), policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const command = client.commands.get('captainpanel');
      if (!command?.buttonHandler) return;
      const value = interaction.customId.replace('captainpanel_resultformat:', '').trim();
      const result = await command.buttonHandler(interaction, 'resultformat', value);
      if (result) await safeReply(interaction, result);
    }
  },
  {
    match: id => id.startsWith('myrpstats_') || id.startsWith('myrpprofile_'), policy: 'owner',
    handler: interaction => client.commands.get('myrpplayer')?.handleButton?.(interaction)
  },
  {
    match: id => id.startsWith('myrpclubstats_') || id.startsWith('myrpclubdetails_'), policy: 'owner',
    handler: interaction => client.commands.get('myrpclub')?.handleButton?.(interaction)
  },
  {
    match: id => id.startsWith('hffixtures_'), policy: 'owner',
    handler: async interaction => {
      const command = client.prefixCommands.get('fixtures');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const [, action, page, targetType, ...rest] = interaction.customId.split('_');
      const ownerId = rest.pop();
      const result = await runWithHFTournament(interaction.guild, () => command.buttonHandler(interaction, action, page, decodeURIComponent(targetType || ''), decodeURIComponent(rest.join('_')), ownerId));
      return editButtonMessage(interaction, result);
    }
  },
  {
    match: id => id.startsWith('myfixtures_'), policy: 'owner',
    handler: async interaction => {
      const command = client.commands.get('myfixtures');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const [, action, page, targetType, targetValue] = interaction.customId.split('_');
      const result = await command.buttonHandler(interaction, action, page, decodeURIComponent(targetType || ''), decodeURIComponent(targetValue || ''));
      return editButtonMessage(interaction, result);
    }
  },
  {
    match: id => id.startsWith('mycareer_'), policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const command = client.commands.get('mycareer');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const [, action, targetType, ...targetParts] = interaction.customId.split('_');
      return editButtonMessage(interaction, await command.buttonHandler(interaction, action, targetType, decodeURIComponent(targetParts.join('_'))));
    }
  },
  {
    match: id => id.startsWith('reserve_page_'), policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const command = client.commands.get('reserve');
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      return editButtonMessage(interaction, await command.buttonHandler(interaction, interaction.customId));
    }
  },
  {
    // The remaining slash-command buttons have no stable owner in their ID.
    match: () => true, policy: 'ownerOrManageGuild',
    handler: async interaction => {
      const [cmd, action, ...valueParts] = interaction.customId.split('_');
      const command = client.commands.get(cmd);
      if (!command?.buttonHandler || !await safeDeferUpdate(interaction)) return;
      const result = await command.buttonHandler(interaction, action, valueParts.join('_'), '');
      return editButtonMessage(interaction, result);
    }
  }
];

async function routeButton(interaction) {
  const entry = buttonRegistry.find(candidate => candidate.match(interaction.customId));
  if (!await ensureModuleEnabled(interaction, entry?.moduleKey || getComponentModule(interaction.customId))) return;
  if (!entry || !await authorizeButton(interaction, entry.policy)) return;
  return entry.handler(interaction);
}

client.on('interactionCreate', async interaction => {
  try {
    // =========================
    // Slash commands
    // =========================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      if (!await ensureModuleEnabled(interaction, command.moduleKey)) return;

      // Commands that handle their own replies should not be auto-deferred.
      if (![
        'setrolecooldown',
        'groksettings',
        'lock',
        'unlock',
        'timeout',
        'untimeout',
        'warn',
        'warnings',
        'purge',
        'slowmode',
        'modlog'
      ].includes(interaction.commandName)) {
        const deferred = await safeDeferReply(interaction);
        if (!deferred) return;
      }

      const result = await command.execute(interaction);

      sendAuditLog(interaction, {
        title: '📝 Command Used',
        description:
          `**Command:** /${interaction.commandName}\n` +
          `**User:** ${interaction.user} (${interaction.user.id})\n` +
          `**Channel:** <#${interaction.channelId}>`,
        color: 0x5865F2
      }).catch(error => console.error('❌ Audit log failed:', error));

      // Some commands reply/followUp internally.
      // Only send a response if the command returned data AND
      // the interaction has not already been replied to.
      if (result && !interaction.replied && !interaction.deferred) {
        await interaction.reply(result);
      } else if (result && interaction.deferred && !interaction.replied) {
        await interaction.editReply(result);
      }
      return;
    }

    // =========================
    // Buttons
    // =========================
    if (interaction.isButton()) {
      return routeButton(interaction);
    }

    // =========================
    // Dropdowns
    // =========================
    if (interaction.isStringSelectMenu()) {
      if (!await ensureModuleEnabled(interaction, getComponentModule(interaction.customId))) return;
      // =========================
      // Penalty Royale help menu
      // =========================
      if (interaction.customId === 'prhelp_topic') {
        const command = client.prefixCommands.get('prhelp');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.buttonHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // =========================
      // rpstats dropdown
      // =========================
      if (interaction.customId.startsWith('rpstats_select_')) {
        const command = client.commands.get('rpstats');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);

        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // HandFootball leaderboard stat selector
      if (interaction.customId.startsWith('hfleaderboard_select_')) {
        const command = client.prefixCommands.get('hfleaderboard');
        if (!command || !command.selectHandler) return;

        const ownerId = interaction.customId.replace('hfleaderboard_select_', '');

        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({
            content: 'Only the user who opened this leaderboard can use this menu.',
            ephemeral: true
          }).catch(() => null);
          return;
        }

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await runWithHFTournament(interaction.guild, () => command.selectHandler(
          interaction,
          interaction.values?.[0],
          ownerId
        ));

        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // Mongo-backed HF profile tournament selector
      if (interaction.customId.startsWith('hfprofile_select_')) {
        const command = client.prefixCommands.get('hfprofile');
        if (!command || !command.selectHandler) return;
        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;
        const result = await command.selectHandler(interaction);
        if (result) await safeEditMessage(interaction.message, { content: null, ...result });
        return;
      }

      // Mongo-backed HF help category selector
      if (interaction.customId === 'hfhelp_category') {
        const command = client.prefixCommands.get('hfhelp');
        if (!command || !command.selectHandler) return;
        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;
        const result = await command.selectHandler(interaction);
        if (result) await safeEditMessage(interaction.message, { content: null, ...result });
        return;
      }

      // stats dropdown handler
      if (interaction.customId.startsWith('stats_select_')) {
        const command = client.commands.get('stats');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // fixtures dropdown handler
      if (interaction.customId.startsWith('md_select_fixtures')) {
        const command = client.commands.get('fixtures');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
      if (result) {
        await safeEditMessage(interaction.message, {
          content: null,
          ...result
        });
      }
        return;
      }

      // removeteam dropdown handler
      if (interaction.customId === 'removeteam_select') {
        const command = client.commands.get('removeteam');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // replaceteam dropdown handler
      if (interaction.customId === 'replaceteam_select') {
        const command = client.commands.get('replaceteam');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // addteamlogo dropdown handler
      if (interaction.customId === 'addteamlogo_select') {
        const command = client.commands.get('addteamlogo');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // derbystats dropdown handler
      if (interaction.customId === 'derbystats_select') {
        const command = client.commands.get('derbystats');
        if (!command || !command.selectMenuHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectMenuHandler(interaction);
        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // myfixtures special select menu handler
      if (interaction.customId.startsWith('myfixtures_comp_')) {
        const command = client.commands.get('myfixtures');
        if (!command || !command.selectMenuHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const [, , ...parts] = interaction.customId.split('_');
        const ownerId = parts.pop();
        const targetValue = decodeURIComponent(parts.pop() || interaction.user.id);
        const targetType = decodeURIComponent(parts.join('_') || 'self');

        const result = await command.selectMenuHandler(
          interaction,
          targetType,
          targetValue
        );

        if (result) {
          await safeEditMessage(interaction.message, {
            content: null,
            ...result
          });
        }
        return;
      }

      // matchday competition dropdown handler
      if (interaction.customId.startsWith('matchday_comp_')) {
        const command = client.commands.get('matchday');
        if (!command || !command.selectMenuHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectMenuHandler(interaction);

        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }
      return;
    }
  } catch (error) {
    console.error('❌ Interaction Error:', error);

    try {
      if (interaction.isChatInputCommand()) {
        const errorPayload = {
          content: '❌ Something went wrong while executing that command. Please try again later.'
        };

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(errorPayload).catch(() => null);
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply(errorPayload).catch(() => null);
        } else {
          await interaction.followUp({
            ...errorPayload,
            ephemeral: true
          }).catch(() => null);
        }
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: '❌ That action failed. Please try again later.',
            ephemeral: true
          }).catch(() => null);
        }
      }
    } catch (replyError) {
      console.error('❌ Error while sending error reply:', replyError);
    }
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;

    // Penalty Royale accepts numbered replies privately by DM. Handle this
    // before guild-only prefix command processing.
    if (!message.guild) {
      await handlePenaltyRoyaleDm(client, message);
      return;
    }

    // =========================
    // Prefix Commands
    // =========================
    const guildPrefix = await getGuildPrefix(message.guild.id);
    if (message.content.startsWith(guildPrefix)) {
      const args = message.content
        .slice(guildPrefix.length)
        .trim()
        .split(/\s+/);
      const commandName = args.shift()?.toLowerCase();
      const prefixCommand = client.prefixCommands.get(commandName);
      const command = prefixCommand || client.commands.get(commandName);

      if (!command || (!prefixCommand && !command.prefix)) return;

      try {
        if (command.moduleKey && !await isGuildModuleEnabled(message.guild.id, command.moduleKey)) {
          await message.reply(`${command.moduleKey.toUpperCase()} commands are disabled in this server.`);
          return;
        }

        if (command.prefix) {
          await executeModerationPrefix(command, message, args, command.prefix);
        } else if (command.isHandFootball && command.usesHFTournamentContext !== false) {
          await runWithHFTournament(message.guild, () => command.execute(message, args, client));
        } else {
          // The invoked alias is passed as a fourth argument.  Older commands
          // simply ignore it; grouped command modules can use it to expose
          // short, collision-free prefix commands.
          await command.execute(message, args, client, commandName);
        }
        sendAuditLog(message, {
          title: '📝 Prefix Command Used',
          description:
            `**Command:** \`${message.content.slice(0, 1000)}\`\n` +
            `**Channel:** <#${message.channel.id}>`,
          color: 0x5865F2
        }).catch(error => console.error('❌ Prefix audit log failed:', error));
      } catch (err) {
        console.error(`❌ Prefix Command Error (${commandName}):`, err);
        sendAuditLog(message, {
          title: '⚠️ Prefix Command Failed',
          description:
            `**Command:** \`${message.content.slice(0, 1000)}\`\n` +
            `**Channel:** <#${message.channel.id}>\n` +
            `**Error:** ${String(err.message || 'Unknown error').slice(0, 1000)}`,
          color: 0xED4245
        }).catch(error => console.error('❌ Prefix failure audit log failed:', error));
        await message.reply('❌ That command failed. Please try again later.').catch(() => {});
      }

      return;
    }

    if (!message.mentions.roles.size) return;

    for (const role of message.mentions.roles.values()) {
      const config = await RoleCooldown.findOne({
        guildId: message.guild.id,
        roleId: role.id
      });

      if (!config || !config.cooldownMs) continue;

      if (message.member?.permissions?.has('Administrator')) {
        continue;
      }

      const pingData = await RolePing.findOne({
        guildId: message.guild.id,
        roleId: role.id
      });

      const now = Date.now();

      if (
        pingData &&
        pingData.lastPing &&
        now - pingData.lastPing < config.cooldownMs
      ) {
        const remaining = config.cooldownMs - (now - pingData.lastPing);

        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);

        await message.delete().catch(() => null);

        await message.channel.send({
          content: `❌ ${role.name} is on cooldown. Remaining: ${hours}h ${minutes}m`
        }).catch(() => null);

        return;
      }

      await RolePing.findOneAndUpdate(
        {
          guildId: message.guild.id,
          roleId: role.id
        },
        {
          lastPing: now
        },
        {
          upsert: true,
          returnDocument: 'after'
        }
      );

      try {
        if (role.mentionable) {
          await role.setMentionable(false, 'Role cooldown activated');

          setTimeout(async () => {
            try {
              const freshRole = await message.guild.roles.fetch(role.id).catch(() => null);

              if (freshRole && !freshRole.mentionable) {
                await freshRole.setMentionable(true, 'Role cooldown expired');
              }
            } catch (err) {
              console.error('❌ Failed to restore role mentionability:', err);
            }
          }, config.cooldownMs);
        }
      } catch (err) {
        console.error('❌ Failed to toggle role mentionability:', err);
      }
    }
  } catch (error) {
    console.error('❌ Role cooldown error:', error);
  }
});

(async () => {
  try {
    if (!process.env.TOKEN) {
      throw new Error('TOKEN environment variable is missing');
    }

    // Connect Discord first. A database outage must not leave the bot offline.
    await client.login(process.env.TOKEN);
    const mongoConnected = await connectMongo();

    if (mongoConnected) {
      const restoredAnnouncements = await restoreStoredAnnouncements(client);
      console.log(`✅ Restored ${restoredAnnouncements} scheduled HandFootball announcements`);

      const restoredPenaltyRoyaleTimers = await restorePenaltyRoyaleTimers(client);
      console.log(`✅ Restored ${restoredPenaltyRoyaleTimers} Penalty Royale timers`);
    }
  } catch (error) {
    console.error('❌ Bot startup failed:', error);
    process.exitCode = 1;
  }
})();
