require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

const guildIds = String(process.env.GUILD_IDS || process.env.GUILD_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!process.env.TOKEN || !process.env.CLIENT_ID) {
  console.error('❌ Missing TOKEN / CLIENT_ID in .env');
  return;
}

if (!fs.existsSync(commandsPath)) {
  console.error('❌ commands folder not found');
  return;
}

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

const loaded = new Set();

for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);

    delete require.cache[require.resolve(filePath)];

    const command = require(filePath);

    if (!command.data || !command.execute) {
      console.log(`⚠️ Skipped ${file}`);
      continue;
    }

    const json = command.data.toJSON();

    if (loaded.has(json.name)) {
      console.log(`⚠️ Duplicate skipped: ${json.name}`);
      continue;
    }

    loaded.add(json.name);
    commands.push(json);

    console.log(`✅ Loaded: /${json.name}`);
  } catch (err) {
    console.error(`❌ Error in ${file}`);
    console.error(err);
  }
}

console.log(`📦 Total commands: ${commands.length}`);

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🚀 Deploying slash commands...');

    if (guildIds.length) {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: [] }
      );

      console.log('🧹 Cleared global slash commands to prevent duplicates.');

      for (const guildId of guildIds) {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
          { body: commands }
        );

        console.log(`✅ Slash commands deployed to guild: ${guildId}`);
      }
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );

      console.log('✅ Slash commands deployed globally!');
    }
  } catch (err) {
    console.error('❌ Deploy failed:');
    console.error(err);
  }
})();
