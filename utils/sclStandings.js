const { buildSclTableImage } = require('./sclTablesImage');

function buildIndividualStandingsRows(players) {
  return [...players]
    .sort((a, b) => b.individualPoints - a.individualPoints || a.displayName.localeCompare(b.displayName))
    .slice(0, 10)
    .map((player, index) => ({
      rank: index + 1,
      name: player.displayName,
      points: player.individualPoints
    }));
}

async function buildSclStandingsImage({ guildId, type, Team, Player }) {
  if (type === 'individual') {
    const players = await Player.find({ guildId }).select('displayName individualPoints').lean();
    return buildSclTableImage({
      title: 'Siuuverse Champions League',
      subtitle: 'Individual Standings • Top 10',
      headers: [
        { key: 'rank', label: '#', width: 85 },
        { key: 'name', label: 'PLAYER', width: 700 },
        { key: 'points', label: 'POINTS', width: 259 }
      ],
      rows: buildIndividualStandingsRows(players)
    });
  }

  if (type === 'team') {
    const teams = await Team.find({ guildId }).select('name captainName roster teamPoints').lean();
    const rows = teams
      .sort((a, b) => b.teamPoints - a.teamPoints || a.name.localeCompare(b.name))
      .map((team, index) => ({
        rank: index + 1,
        name: team.name,
        captain: team.captainName,
        players: team.roster.length,
        points: team.teamPoints
      }));
    return buildSclTableImage({
      title: 'Siuuverse Champions League',
      subtitle: 'Team Standings',
      headers: [
        { key: 'rank', label: '#', width: 75 },
        { key: 'name', label: 'TEAM', width: 380 },
        { key: 'captain', label: 'CAPTAIN', width: 240 },
        { key: 'players', label: 'PLAYERS', width: 160 },
        { key: 'points', label: 'POINTS', width: 189 }
      ],
      rows,
      accent: '#fbbf24'
    });
  }

  throw new Error(`Unknown SCL standings type: ${type}`);
}

module.exports = { buildIndividualStandingsRows, buildSclStandingsImage };
