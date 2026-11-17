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
const HFTournament = require('../models/HFTournament');
const { hasHFPermission } = require('../utils/hfPermissions');

function stripUserArgs(args, userId) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg))
    .filter(arg => String(arg || '').trim() !== String(userId || '').trim());
}

module.exports = {
  name: 'hfsetcaptain',
  aliases: ['sethfcaptain', 'hfcaptain'],

  async execute(message, args) {
    const mongoTournament = await HFTournament.findOne({
      guildId: message.guild.id,
      status: { $in: ['registration', 'active'] }
    }).sort({ createdAt: -1 });
    if (mongoTournament) {
      if (!(await hasHFPermission(message, 'manageRegistration'))) {
        return message.reply(`${E.wrong} You need HF registration access to set captains.`);
      }
      const userId = getMentionedUserId(message) || getFirstIdArg(args);
      const teamName = args.filter(arg => !/<@!?\d+>/.test(arg) && !/^\d{15,25}$/.test(arg)).join(' ').trim();
      const team = mongoTournament.teams.find(item => item.name.toLowerCase() === teamName.toLowerCase());
      if (!team || !userId) return message.reply(`${E.missing} Usage: .hfsetcaptain @user Team Name`);
      if (mongoTournament.teams.some(item => item.captainUserId === userId && item.teamId !== team.teamId)) {
        return message.reply(`${E.warning} That user is already captain of another team in this tournament.`);
      }
      team.captainUserId = userId;
      if (!team.playerUserIds.includes(userId)) team.playerUserIds.push(userId);
      await mongoTournament.save();
      if (mongoTournament.captainRoleId) {
        await message.guild.members.fetch(userId).then(member => member.roles.add(mongoTournament.captainRoleId)).catch(() => null);
      }
      return message.reply(`${E.captain} Set <@${userId}> as captain of **${team.name}**.`);
    }

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
