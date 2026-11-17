const E = require('../utils/emojis');
const HFTournament = require('../models/HFTournament');
const { hasHFPermission } = require('../utils/hfPermissions');

const NEXT_ROUND = {
  'round 1': 'Round 2',
  'round 2': 'Quarter Final',
  'quarter final': 'Semi Final',
  'semi final': 'Final',
  'round of 16': 'Quarter Final'
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function slug(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function winnerOf(fixture) {
  if (fixture.homeScore === null || fixture.homeScore === undefined || fixture.awayScore === null || fixture.awayScore === undefined) return null;
  if (fixture.homeScore === fixture.awayScore) {
    if (fixture.winnerTeamId) {
      return fixture.winnerTeamId === fixture.homeTeamId
        ? { id: fixture.homeTeamId, name: fixture.homeTeamName }
        : fixture.winnerTeamId === fixture.awayTeamId
          ? { id: fixture.awayTeamId, name: fixture.awayTeamName }
          : null;
    }
    if (fixture.decision === 'home') return { id: fixture.homeTeamId, name: fixture.homeTeamName };
    if (fixture.decision === 'away') return { id: fixture.awayTeamId, name: fixture.awayTeamName };
    return null;
  }
  return fixture.homeScore > fixture.awayScore
    ? { id: fixture.homeTeamId, name: fixture.homeTeamName }
    : { id: fixture.awayTeamId, name: fixture.awayTeamName };
}

function tieWinner(fixtures) {
  const ordered = [...fixtures].sort((left, right) => (left.leg || 1) - (right.leg || 1));
  const expectedLegs = Math.max(...ordered.map(fixture => fixture.legs || 1), 1);
  if (ordered.length !== expectedLegs || new Set(ordered.map(fixture => fixture.leg || 1)).size !== expectedLegs) return null;
  if (ordered.some(fixture => fixture.homeScore === null || fixture.homeScore === undefined || fixture.awayScore === null || fixture.awayScore === undefined)) return null;
  if (ordered.length === 1) return winnerOf(ordered[0]);

  const first = ordered[0];
  const second = ordered[1];
  const totals = new Map([
    [first.homeTeamId, 0],
    [first.awayTeamId, 0]
  ]);
  for (const fixture of ordered) {
    totals.set(fixture.homeTeamId, (totals.get(fixture.homeTeamId) || 0) + fixture.homeScore);
    totals.set(fixture.awayTeamId, (totals.get(fixture.awayTeamId) || 0) + fixture.awayScore);
  }
  const homeTotal = totals.get(first.homeTeamId) || 0;
  const awayTotal = totals.get(first.awayTeamId) || 0;
  if (homeTotal !== awayTotal) {
    return homeTotal > awayTotal
      ? { id: first.homeTeamId, name: first.homeTeamName }
      : { id: first.awayTeamId, name: first.awayTeamName };
  }

  return winnerOf(second);
}

function createNextFixtures(winners, round) {
  const fixtures = [];
  const twoLegged = normalize(round) !== 'final';
  for (let index = 0; index < winners.length - 1; index += 2) {
    const home = winners[index];
    const away = winners[index + 1];
    if (!home || !away) continue;
    const tieNumber = Math.floor(index / 2) + 1;
    const tieId = `${slug(round)}-${tieNumber}`;
    fixtures.push({
      matchId: `${tieId}${twoLegged ? '-1' : ''}`,
      round,
      group: '',
      tieId: twoLegged ? tieId : '',
      aggregateId: twoLegged ? tieId : '',
      leg: 1,
      legs: twoLegged ? 2 : 1,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeTeamName: home.name,
      awayTeamName: away.name,
      venue: '',
      scheduledAt: null,
      status: 'upcoming',
      homeScore: null,
      awayScore: null
    });
    if (twoLegged) {
      fixtures.push({
        matchId: `${tieId}-2`,
        round,
        group: '',
        tieId,
        aggregateId: tieId,
        leg: 2,
        legs: 2,
        homeTeamId: away.id,
        awayTeamId: home.id,
        homeTeamName: away.name,
        awayTeamName: home.name,
        venue: '',
        scheduledAt: null,
        status: 'upcoming',
        homeScore: null,
        awayScore: null
      });
    }
  }
  return fixtures;
}

module.exports = {
  name: 'hfadvance',
  aliases: ['hfknockout', 'advancehf'],
  usesHFTournamentContext: false,

  async execute(message, args) {
    if (!(await hasHFPermission(message, 'createTournament'))) {
      return message.reply(`${E.wrong} Only the bot owner or an authorized HF admin can advance HF rounds.`);
    }

    const explicitId = args[0]?.startsWith('hf-') ? args[0] : '';
    const requestedRound = (explicitId ? args.slice(1) : args).join(' ').trim();
    const tournament = await HFTournament.findOne({
      guildId: message.guild.id,
      ...(explicitId ? { tournamentId: explicitId } : {}),
      type: { $in: ['cup', 'groups_knockout'] },
      status: { $in: ['registration', 'active'] }
    });
    if (!tournament) return message.reply(`${E.missing} Active Mongo cup/group tournament not found.`);

    const rounds = [...new Set(tournament.fixtures.map(fixture => fixture.round).filter(Boolean))];
    const currentRound = requestedRound || rounds.find(round => {
      const fixtures = tournament.fixtures.filter(fixture => normalize(fixture.round) === normalize(round));
      const ties = new Map();
      fixtures.forEach(fixture => {
        const key = fixture.aggregateId || fixture.tieId || fixture.matchId;
        if (!ties.has(key)) ties.set(key, []);
        ties.get(key).push(fixture);
      });
      return ties.size > 0 && [...ties.values()].every(tie => tieWinner(tie) || tie[0].status === 'bye');
    });
    if (!currentRound) return message.reply(`${E.warning} No completed knockout round is ready to advance.`);

    const currentFixtures = tournament.fixtures.filter(fixture => normalize(fixture.round) === normalize(currentRound));
    if (!currentFixtures.length) return message.reply(`${E.missing} Round **${currentRound}** was not found.`);
    const ties = new Map();
    currentFixtures.forEach(fixture => {
      const key = fixture.aggregateId || fixture.tieId || fixture.matchId;
      if (!ties.has(key)) ties.set(key, []);
      ties.get(key).push(fixture);
    });
    const winners = [...ties.values()].map(tieWinner);
    if (winners.some(winner => !winner)) return message.reply(`${E.warning} Every fixture in **${currentRound}** must be completed with a winner. Draws need a winner decision first.`);

    const nextRound = NEXT_ROUND[normalize(currentRound)] || `${currentRound} Next Round`;
    if (tournament.fixtures.some(fixture => normalize(fixture.round) === normalize(nextRound))) {
      return message.reply(`${E.warning} **${nextRound}** fixtures already exist for this tournament.`);
    }

    const nextFixtures = createNextFixtures(winners, nextRound);
    if (!nextFixtures.length) return message.reply(`${E.warning} Not enough winners to create **${nextRound}** fixtures.`);
    tournament.fixtures.push(...nextFixtures);
    tournament.status = 'active';
    await tournament.save();
    return message.reply(`${E.correct || '✅'} Advanced **${tournament.name}** from **${currentRound}** to **${nextRound}** with **${nextFixtures.length}** fixtures.`);
  }
};
