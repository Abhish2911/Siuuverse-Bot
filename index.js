require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const express = require('express');
const { sendAuditLog } = require('./utils/helpers');
const { RoleCooldown, RolePing } = require('./models/rolehandler');

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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function connectMongo() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.log('⚠️ MongoDB URI not set. Skipping MongoDB connection.');
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
  }
}

client.commands = new Collection();

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

const commandFolders = [
  path.join(__dirname, 'commands'),
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

      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded: ${file}`);
    } catch (err) {
      console.log(`❌ ERROR in ${file}:`, err.message);
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
});

client.on('interactionCreate', async interaction => {
  try {
    // =========================
    // Slash commands
    // =========================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Commands that handle their own replies should not be auto-deferred.
      if (interaction.commandName !== 'setrolecooldown') {
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
      const parts = interaction.customId.split('_');
      const cmd = parts.shift();
      const action = parts.shift();
      const value = parts.join('_');
      const extra = '';

      // captainpanel result format button
      if (interaction.customId.startsWith('captainpanel_resultformat:')) {
        const command = client.commands.get('captainpanel');
        if (!command || !command.buttonHandler) return;

        const value = interaction.customId.replace('captainpanel_resultformat:', '').trim();
        const result = await command.buttonHandler(interaction, 'resultformat', value);

        if (result) {
          await interaction.reply(result);
        }
        return;
      }

      // replaceteam buttons
      if (cmd === 'replaceteam') {
        const command = client.commands.get('replaceteam');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.buttonHandler(interaction, action, value, extra);
        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      // addteamlogo buttons
      if (cmd === 'addteamlogo') {
        const command = client.commands.get('addteamlogo');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.buttonHandler(interaction, action, value, extra);
        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      // myfixtures special button handler
      if (cmd === 'myfixtures') {
        const command = client.commands.get('myfixtures');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const [page, targetType, targetValue, ownerId] = parts;

        const result = await command.buttonHandler(
          interaction,
          action,
          page,
          decodeURIComponent(targetType || ''),
          decodeURIComponent(targetValue || '')
        );

        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      // matchday special button handler
      if (cmd === 'matchday') {
        const command = client.commands.get('matchday');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.buttonHandler(interaction, action, value, extra);

        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      // mycareer special button handler
      if (cmd === 'mycareer') {
        const command = client.commands.get('mycareer');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        // customId format:
        // mycareer_<view>_<targetType>_<targetValue>
        const [targetType, ...targetParts] = parts;
        const targetValue = targetParts.join('_');

        const result = await command.buttonHandler(
          interaction,
          action,
          targetType,
          decodeURIComponent(targetValue || '')
        );

        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      // reserve pagination buttons
      if (cmd === 'reserve' && action === 'page') {
        const command = client.commands.get('reserve');
        if (!command || !command.buttonHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.buttonHandler(
          interaction,
          interaction.customId
        );

        if (result) {
          await interaction.message.edit({
            content: null,
            ...result
          });
        }
        return;
      }

      const command = client.commands.get(cmd);
      if (!command || !command.buttonHandler) return;

      const deferred = await safeDeferUpdate(interaction);
      if (!deferred) return;

      const result = await command.buttonHandler(interaction, action, value, extra);

      if (result) {
        await interaction.message.edit({
          content: null,
          ...result
        });
      }
      return;
    }

    // =========================
    // Dropdowns
    // =========================
    if (interaction.isStringSelectMenu()) {
      // stats dropdown handler
      if (interaction.customId === 'stats_select') {
        const command = client.commands.get('stats');
        if (!command || !command.selectHandler) return;

        const deferred = await safeDeferUpdate(interaction);
        if (!deferred) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit({
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
          await interaction.message.edit({
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
          await interaction.message.edit({
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
          await interaction.message.edit({
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
          await interaction.message.edit({
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
          await interaction.message.edit({
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

        const parts = interaction.customId.split('_');
        const targetType = decodeURIComponent(parts[2] || 'self');
        const targetValue = decodeURIComponent(parts[3] || interaction.user.id);

        const result = await command.selectMenuHandler(
          interaction,
          targetType,
          targetValue
        );

        if (result) {
          await interaction.message.edit({
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
          content: `❌ Error occurred while executing command\n\`${error.message || 'Unknown error'}\``
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
            content: `❌ Action failed: ${error.message || 'Unknown error'}`,
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
    if (message.author.bot || !message.guild) return;
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
          content: `❌ ${role} is on cooldown. Remaining: ${hours}h ${minutes}m`
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
  await connectMongo();
  await client.login(process.env.TOKEN);
})();
