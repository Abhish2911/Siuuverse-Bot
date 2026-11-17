const HFTournament = require('../models/HFTournament');

function calculateStandings(tournament) {
  const adjustments = new Map((tournament.standings || []).map(row => [row.teamId, row.pointAdjustments || 0]));
  const rows = new Map((tournament.teams || []).map(team => [team.teamId, {
    teamId: team.teamId,
    teamName: team.name,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: adjustments.get(team.teamId) || 0,
    pointAdjustments: adjustments.get(team.teamId) || 0
  }]));
  for (const fixture of tournament.fixtures || []) {
    if (fixture.homeScore === null || fixture.homeScore === undefined || fixture.awayScore === null || fixture.awayScore === undefined) continue;
    const home = rows.get(fixture.homeTeamId);
    const away = rows.get(fixture.awayTeamId);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += fixture.homeScore;
    home.goalsAgainst += fixture.awayScore;
    away.goalsFor += fixture.awayScore;
    away.goalsAgainst += fixture.homeScore;
    if (fixture.homeScore > fixture.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (fixture.homeScore < fixture.awayScore) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  return [...rows.values()];
}

async function recordMongoResult(guildId, matchId, homeScore, awayScore, options = {}) {
  const tournament = await HFTournament.findOne({
    guildId,
    status: { $in: ['registration', 'active'] }
  }).sort({ createdAt: -1 });
  if (!tournament) return null;
  const fixture = tournament.fixtures.find(item => item.matchId === String(matchId));
  if (!fixture) return null;
  const decision = String(options.decision || '').toLowerCase();
  fixture.homeScore = homeScore;
  fixture.awayScore = awayScore;
  fixture.decision = ['home', 'away'].includes(decision) ? decision : '';
  fixture.homePenaltyScore = options.homePenaltyScore ?? null;
  fixture.awayPenaltyScore = options.awayPenaltyScore ?? null;
  fixture.status = 'played';

  const aggregateId = fixture.aggregateId || fixture.tieId;
  const tieFixtures = aggregateId
    ? tournament.fixtures.filter(item => (item.aggregateId || item.tieId) === aggregateId)
    : [fixture];
  const tieComplete = tieFixtures.every(item => item.homeScore !== null && item.homeScore !== undefined && item.awayScore !== null && item.awayScore !== undefined);
  if (tieComplete) {
    const totals = new Map();
    tieFixtures.forEach(item => {
      totals.set(item.homeTeamId, (totals.get(item.homeTeamId) || 0) + item.homeScore);
      totals.set(item.awayTeamId, (totals.get(item.awayTeamId) || 0) + item.awayScore);
    });
    const homeTotal = totals.get(fixture.homeTeamId) || 0;
    const awayTotal = totals.get(fixture.awayTeamId) || 0;
    if (homeTotal === awayTotal && fixture.leg === fixture.legs && !['home', 'away'].includes(decision)) {
      throw new Error('The aggregate is tied. Add home or away and the penalty score to the second leg.');
    }
    if (aggregateId && tieFixtures.length > 1) {
      const first = tieFixtures[0];
      const second = tieFixtures.sort((left, right) => (left.leg || 1) - (right.leg || 1))[1];
      const winnerId = homeTotal === awayTotal
        ? (second.decision === 'home' ? second.homeTeamId : second.awayTeamId)
        : homeTotal > awayTotal ? fixture.homeTeamId : fixture.awayTeamId;
      second.winnerTeamId = winnerId;
    } else {
      fixture.winnerTeamId = homeScore > awayScore
        ? fixture.homeTeamId
        : homeScore < awayScore
          ? fixture.awayTeamId
          : decision === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
    }
  }
  tournament.standings = calculateStandings(tournament);
  await tournament.save();
  return fixture.toObject ? fixture.toObject() : fixture;
}

async function clearMongoResult(guildId, matchId) {
  const tournament = await HFTournament.findOne({
    guildId,
    status: { $in: ['registration', 'active'] }
  }).sort({ createdAt: -1 });
  if (!tournament) return null;
  const fixture = tournament.fixtures.find(item => item.matchId === String(matchId));
  if (!fixture) return null;
  fixture.homeScore = null;
  fixture.awayScore = null;
  fixture.decision = '';
  fixture.winnerTeamId = '';
  fixture.homePenaltyScore = null;
  fixture.awayPenaltyScore = null;
  fixture.status = 'upcoming';
  tournament.standings = calculateStandings(tournament);
  await tournament.save();
  return fixture.toObject ? fixture.toObject() : fixture;
}

module.exports = { calculateStandings, recordMongoResult, clearMongoResult };
