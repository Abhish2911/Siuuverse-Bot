const E = require('../utils/emojis');
const HFTournament = require('../models/HFTournament');
const { hasHFPermission } = require('../utils/hfPermissions');

module.exports = {
  name: 'hfsetvicecaptain',
  aliases: ['sethfvicecaptain', 'hfvicecaptain'],
  usesHFTournamentContext: false,

  async execute(message, args) {
    if (!(await hasHFPermission(message, 'manageRegistration'))) {
      return message.reply(`${E.wrong} You need HF registration access to set vice-captains.`);
    }
    const tournament = await HFTournament.findOne({ guildId: message.guild.id, status: { $in: ['registration', 'active'] } }).sort({ createdAt: -1 });
    if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
    const userId = message.mentions.users.first()?.id || args.join(' ').match(/\d{15,25}/)?.[0] || '';
    const teamName = args.filter(arg => !/<@!?\d+>/.test(arg) && !/^\d{15,25}$/.test(arg)).join(' ').trim();
    const team = tournament.teams.find(item => item.name.toLowerCase() === teamName.toLowerCase());
    if (!team || !userId) return message.reply(`${E.missing} Usage: .hfsetvicecaptain @user Team Name`);
    if (tournament.teams.some(item => item.viceCaptainUserId === userId && item.teamId !== team.teamId)) {
      return message.reply(`${E.warning} That user is already vice-captain of another team in this tournament.`);
    }
    team.viceCaptainUserId = userId;
    if (!team.playerUserIds.includes(userId)) team.playerUserIds.push(userId);
    await tournament.save();
    if (tournament.viceCaptainRoleId) {
      await message.guild.members.fetch(userId).then(member => member.roles.add(tournament.viceCaptainRoleId)).catch(() => null);
    }
    return message.reply(`${E.captain} Set <@${userId}> as vice-captain of **${team.name}**.`);
  }
};