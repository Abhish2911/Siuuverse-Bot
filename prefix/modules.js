const {
  getGuildModuleSettings,
  setAllGuildModulesEnabled,
  setGuildModuleEnabled
} = require('../utils/guildModules');

const MODULE_LABELS = {
  coop: 'Co-op',
  hf: 'HandFootball',
  scl: 'SCL'
};

function isModuleManager(message) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return ownerIds.includes(message.author.id)
    || message.guild?.ownerId === message.author.id;
}

function statusMessage(settings) {
  return Object.entries(MODULE_LABELS)
    .map(([moduleName, label]) => `**${label}:** ${settings[moduleName] ? 'enabled' : 'disabled'}`)
    .join('\n');
}

module.exports = {
  name: 'modules',
  aliases: ['module'],

  async execute(message, args) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!isModuleManager(message)) {
      return message.reply("Only the bot owner or this server's owner can change module settings.");
    }

    const [requestedModule, requestedState] = args.map(value => String(value).toLowerCase());
    if (!requestedModule || requestedModule === 'status') {
      return message.reply(`**Server module status**\n${statusMessage(await getGuildModuleSettings(message.guild.id))}`);
    }

    if (!['coop', 'hf', 'scl', 'all'].includes(requestedModule)
      || !['on', 'off'].includes(requestedState)) {
      return message.reply('Usage: `.modules status` or `.modules <coop|hf|scl|all> <on|off>`');
    }

    const enabled = requestedState === 'on';
    if (requestedModule === 'all') {
      await setAllGuildModulesEnabled(message.guild.id, enabled);
      return message.reply(`Co-op, HandFootball, and SCL commands are now **${enabled ? 'enabled' : 'disabled'}** in this server.`);
    }

    await setGuildModuleEnabled(message.guild.id, requestedModule, enabled);
    return message.reply(`${MODULE_LABELS[requestedModule]} commands are now **${enabled ? 'enabled' : 'disabled'}** in this server.`);
  }
};
