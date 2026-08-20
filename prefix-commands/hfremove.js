const {
  findPlayerByName,
  findPlayerByUserId,
  getFirstIdArg,
  getMentionedUserId,
  isBotOwner,
  loadHandFootballData,
  removeHFPlayer,
  sameTeam
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function getPlayerSearchText(args, userId) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg))
    .filter(arg => String(arg || '').trim() !== String(userId || '').trim())
    .join(' ')
    .trim();
}

module.exports = {
  name: 'hfremove',
  aliases: ['removehfplayer'],

  async execute(message, args) {
    const data = await loadHandFootballData();
    const owner = isBotOwner(message);
    const mentionedUserId = getMentionedUserId(message);
    const idArg = getFirstIdArg(args);
    const userId = mentionedUserId || idArg;
    const searchText = getPlayerSearchText(args, userId);
    const player = userId
      ? findPlayerByUserId(data.players, userId)
      : findPlayerByName(data.players, searchText);

    if (!player) {
      return message.reply(`${E.missing} HandFootball player not found. Provide a player mention, ID, or name.`);
    }

    const captainTeams = data.players
      .filter(item => item.userId === message.author.id && item.isCaptain)
      .map(item => item.team);
    if (!owner && !captainTeams.some(team => sameTeam(team, player.team))) {
      return message.reply(`${E.wrong} Only the captain of **${player.team}** can remove this player.`);
    }

    if (!owner && player.isCaptain) {
      return message.reply(`${E.warning} The team captain cannot be removed. Transfer captaincy first.`);
    }

    await removeHFPlayer(player.userId);

    return message.reply(
      `${E.correct} Removed **${player.player}** (<@${player.userId}>) from **${player.team}**.`
    );
  }
};
