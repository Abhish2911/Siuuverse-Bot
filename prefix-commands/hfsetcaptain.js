const {
  findPlayerByName,
  findPlayerByUserId,
  findTeamByName,
  getFirstIdArg,
  getMentionedUserId,
  getSearchText,
  isBotOwner,
  loadHandFootballData,
  setHFCaptain
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function stripUserArgs(args, userId) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg))
    .filter(arg => String(arg || '').trim() !== String(userId || '').trim());
}

module.exports = {
  name: 'hfsetcaptain',
  aliases: ['sethfcaptain', 'hfcaptain'],

  async execute(message, args) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can set HandFootball captains.`);
    }

    const data = await loadHandFootballData();
    const mentionedUserId = getMentionedUserId(message);
    const idArg = getFirstIdArg(args);
    let userId = mentionedUserId || idArg;
    const searchText = getSearchText(stripUserArgs(args, userId));
    let player = userId
      ? findPlayerByUserId(data.players, userId)
      : findPlayerByName(data.players, searchText);

    if (!userId && player) {
      userId = player.userId;
    }

    if (!player || !userId) {
      return message.reply(`${E.missing} HandFootball player not found. Use \`.hfsetcaptain @user\` or \`.hfsetcaptain Player Name\`.`);
    }

    const team = searchText
      ? findTeamByName(data, searchText)
      : null;
    const teamName = team?.team || player.team;
    const updated = await setHFCaptain(teamName, userId);

    if (!updated) {
      return message.reply(`${E.wrong} Could not update captain. Make sure the player is registered in Team_Data.`);
    }

    return message.reply(`${E.captain} Set **${player.player}** as captain of **${teamName}**.`);
  }
};
