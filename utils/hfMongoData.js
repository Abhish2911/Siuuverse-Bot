const HFTournament = require('../models/HFTournament');

async function getOpenTournament(guildId) {
  return HFTournament.findOne({
    guildId,
    status: { $in: ['registration', 'active'] }
  }).sort({ createdAt: -1 }).lean();
}

function toPlayerRows(tournament) {
  return (tournament?.teams || []).flatMap(team => [
    ...(team.playerUserIds || []).map(userId => ({
      team: team.name,
      player: `<@${userId}>`,
      userId,
      isCaptain: userId === team.captainUserId,
      isViceCaptain: userId === team.viceCaptainUserId
    })),
    ...(team.captainUserId && !(team.playerUserIds || []).includes(team.captainUserId)
      ? [{ team: team.name, player: `<@${team.captainUserId}>`, userId: team.captainUserId, isCaptain: true, isViceCaptain: false }]
      : [])
  ]);
}

function toMongoData(tournament) {
  const teams = (tournament?.teams || []).map(team => ({
    team: team.name,
    roleId: team.roleId || '',
    stadium: team.stadium || '',
    logoUrl: '',
    color: team.color || '',
    stadiumChannelId: '',
    teamId: team.teamId,
    captainUserId: team.captainUserId || '',
    viceCaptainUserId: team.viceCaptainUserId || ''
  }));
  const fixtures = (tournament?.fixtures || []).map((fixture, index) => ({
    index: index + 1,
    matchNo: fixture.matchId || String(index + 1),
    matchday: fixture.round || '',
    group: fixture.group || '',
    tieId: fixture.tieId || '',
    aggregateId: fixture.aggregateId || fixture.tieId || '',
    leg: fixture.leg || 1,
    legs: fixture.legs || 1,
    home: fixture.homeTeamName || '',
    away: fixture.awayTeamName || '',
    homeGoals: fixture.homeScore ?? '',
    awayGoals: fixture.awayScore ?? '',
    decision: fixture.decision || '',
    homePenaltyScore: fixture.homePenaltyScore ?? '',
    awayPenaltyScore: fixture.awayPenaltyScore ?? '',
    status: fixture.status || 'Upcoming',
    date: fixture.scheduledAt ? new Date(fixture.scheduledAt).toISOString() : '',
    time: '',
    venue: fixture.venue || teams.find(team => team.teamId === fixture.homeTeamId)?.stadium || '',
    note: '',
    played: fixture.homeScore !== null && fixture.homeScore !== undefined && fixture.awayScore !== null && fixture.awayScore !== undefined
  }));
  return {
    teams,
    players: toPlayerRows(tournament),
    standings: (tournament?.standings || []).map(row => ({
      team: row.teamName,
      played: row.played || 0,
      wins: row.wins || 0,
      draws: row.draws || 0,
      losses: row.losses || 0,
      goalsFor: row.goalsFor || 0,
      goalsAgainst: row.goalsAgainst || 0,
      points: row.points || 0,
      pointAdjustments: row.pointAdjustments || 0
    }))
  };
}

module.exports = { getOpenTournament, toMongoData };