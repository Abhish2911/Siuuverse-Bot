const E = require('../utils/emojis');
const { DEFAULT_PREFIX, setGuildPrefix } = require('../utils/guildPrefix');

function isBotOwner(userId) {
  return String(process.env.OWNER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(userId);
}

module.exports = {
  name: 'setprefix',
  aliases: ['prefix'],
  usesHFTournamentContext: false,

  async execute(message, args) {
    const isAllowed = isBotOwner(message.author.id) || message.guild.ownerId === message.author.id;
    if (!isAllowed) {
      return message.reply(`${E.wrong} Only the bot owner or server owner can change this server's prefix.`);
    }

    const requested = String(args[0] || '').trim();
    if (requested.toLowerCase() === 'reset') {
      await setGuildPrefix(message.guild.id, DEFAULT_PREFIX);
      return message.reply(`${E.correct || '✅'} This server's prefix was reset to \`${DEFAULT_PREFIX}\`.`);
    }

    if (requested.length > 3 || /\s/.test(requested) || requested === '@') {
      return message.reply(`${E.warning} Prefix must be 1 to 3 non-space characters.`);
    }

    if (!requested) return message.reply('Usage: `.setprefix <prefix>` or `.setprefix reset`');

    await setGuildPrefix(message.guild.id, requested);
    return message.reply(`${E.correct || '✅'} This server's prefix is now \`${requested}\`.`);
  }
};
