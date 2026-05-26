require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

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
  intents: [GatewayIntentBits.Guilds]
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
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

async function safeDeferReply(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
}

async function safeDeferUpdate(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
}

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Load commands
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

client.once('clientReady', async () => {
  console.log(`🚀 Bot ready: ${client.user.tag}`);
  console.log(`📢 Weekly summary channel: ${process.env.WEEKLY_SUMMARY_CHANNEL_ID || 'NOT SET'}`);
  console.log(`📝 Audit log channel: ${process.env.DISCORD_AUDIT_LOG_CHANNEL_ID || 'NOT SET'}`);

  const restoreCommands = [
    'setlivestats',
    'setlivestandings',
    'setweeklysummary'
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
});

client.on('interactionCreate', async interaction => {
  try {
    // =========================
    // Slash commands
    // =========================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await safeDeferReply(interaction);
      const result = await command.execute(interaction);

      if (result) {
        await safeReply(interaction, result);
      }
      return;
    }

    // =========================
    // Buttons
    // =========================
    if (interaction.isButton()) {
      const parts = interaction.customId.split('_');
      const cmd = parts[0];
      const action = parts[1];
      const value = parts[2];
      const extra = parts.slice(3).join('_');

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

        await safeDeferUpdate(interaction);
        const result = await command.buttonHandler(interaction, action, value, extra);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // addteamlogo buttons
      if (cmd === 'addteamlogo') {
        const command = client.commands.get('addteamlogo');
        if (!command || !command.buttonHandler) return;

        await safeDeferUpdate(interaction);
        const result = await command.buttonHandler(interaction, action, value, extra);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      const command = client.commands.get(cmd);
      if (!command || !command.buttonHandler) return;

      await safeDeferUpdate(interaction);
      const result = await command.buttonHandler(interaction, action, value, extra);

      if (result) {
        await interaction.message.edit(result);
      }
      return;
    }

    // =========================
    // Dropdowns
    // =========================
    if (interaction.isStringSelectMenu()) {
      await safeDeferUpdate(interaction);

      // stats dropdown handler
      if (interaction.customId === 'stats_select') {
        const command = client.commands.get('stats');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // weeklysummary dropdown handler
      if (interaction.customId === 'weeklysummary_select') {
        const command = client.commands.get('weeklysummary');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // fixtures dropdown handler
      if (interaction.customId === 'md_select_fixtures') {
        const command = client.commands.get('fixtures');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // removeteam dropdown handler
      if (interaction.customId === 'removeteam_select') {
        const command = client.commands.get('removeteam');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // replaceteam dropdown handler
      if (interaction.customId === 'replaceteam_select') {
        const command = client.commands.get('replaceteam');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      // addteamlogo dropdown handler
      if (interaction.customId === 'addteamlogo_select') {
        const command = client.commands.get('addteamlogo');
        if (!command || !command.selectHandler) return;

        const result = await command.selectHandler(interaction);
        if (result) {
          await interaction.message.edit(result);
        }
        return;
      }

      return;
    }
  } catch (error) {
    console.error('❌ Interaction Error:', error);

    try {
      if (interaction.isChatInputCommand()) {
        await safeReply(interaction, {
          content: `❌ Error occurred while executing command\n\`${error.message || 'Unknown error'}\``
        });
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (interaction.message?.editable) {
          await interaction.followUp({
            content: `❌ Action failed: ${error.message || 'Unknown error'}`,
            ephemeral: true
          });
        }
      }
    } catch (replyError) {
      console.error('❌ Error while sending error reply:', replyError);
    }
  }
});

(async () => {
  await connectMongo();
  await client.login(process.env.TOKEN);
})();