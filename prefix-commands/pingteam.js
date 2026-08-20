const E = require('../utils/emojis');
const {
  findPlayerByUserId,
  findTeamMeta,
  getTeamRoster,
  isBotOwner,
  loadHandFootballData
} = require('../utils/handfootball');

module.exports = {
  name: 'pingteam',
  aliases: ['pt', 'hfrally', 'hfpingteam'],

  async execute(message) {
    const data = await loadHandFootballData();
    const captainTeams = data.players
      .filter(player => player.userId === message.author.id && player.isCaptain)
      .map(player => player.team);

    if (!isBotOwner(message) && !captainTeams.length) {
      return message.reply(`${E.wrong} Only a HandFootball captain can ping their team.`);
    }

    const teamName = captainTeams[0] || findPlayerByUserId(data.players, message.author.id)?.team;
    if (!teamName) {
      return message.reply(`${E.missing} Your HandFootball team could not be found.`);
    }

    const teamMeta = findTeamMeta(data.teams, teamName);
    const roster = getTeamRoster(data.players, teamName);
    const roleMention = teamMeta.roleId ? `<@&${teamMeta.roleId}>` : '';
    const userMentions = roster.map(player => `<@${player.userId}>`);
    const mention = roleMention || userMentions.join(' ');

    if (!mention) {
      return message.reply(`${E.missing} No registered players or team role were found for **${teamName}**.`);
    }

    return message.channel.send({
      content: `${mention}\n${E.team} **${teamName}** — team ping from the captain.`,
      allowedMentions: {
        roles: teamMeta.roleId ? [teamMeta.roleId] : [],
        users: teamMeta.roleId ? [] : roster.map(player => player.userId)
      }
    });
  }
};
