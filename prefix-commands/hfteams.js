const { EmbedBuilder } = require('discord.js');
const E = require('../utils/emojis');
const {
  loadHandFootballData,
  findTeamMeta,
  getTeamRoster,
  getTeamCaptains,
  getTeamRecord,
  mentionUser,
  truncateField
} = require('../utils/handfootball');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function getAllTeamNames(data) {
  return [...new Set([
    ...data.teams.map(team => team.team),
    ...data.players.map(player => player.team)
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

module.exports = {
  name: 'hfteams',
  aliases: ['hfteamslist', 'hflistteams'],

  async execute(message) {
    const data = await loadHandFootballData();
    const teamNames = getAllTeamNames(data);

    if (!teamNames.length) {
      return message.reply(`${E.missing} No HandFootball teams found in the sheet.`);
    }

    const lines = teamNames.map(teamName => {
      const team = findTeamMeta(data.teams, teamName);
      const roster = getTeamRoster(data.players, teamName);
      const captains = getTeamCaptains(data.players, teamName);
      const record = getTeamRecord(data.fixtures, teamName);
      const roleText = team.roleId ? `<@&${team.roleId}>` : 'No role';
      const recordText = data.fixtures.length
        ? ` | ${record.wins}W-${record.draws}D-${record.losses}L | Pts ${record.points}`
        : '';

      return [
        `**${teamName}** - ${roster.length} players${recordText}`,
        `Captain${captains.length === 1 ? '' : 's'}: ${captains.length ? captains.map(captain => `${captain.player} ${mentionUser(captain.userId)}`).join(', ') : 'Not set'} | ${roleText}`
      ].join('\n');
    });

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.team, 'Teams')} HandFootball Teams`)
      .setDescription(truncateField(lines.join('\n\n'), 4096))
      .setColor(0xF1C40F)
      .setFooter({
        text: `${teamNames.length} teams registered`
      })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
