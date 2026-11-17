function clean(value) {
  return String(value || '').trim();
}

function pair(home, away, round, index, group = '', tieId = '', leg = 1, legs = 1) {
  return {
    matchId: `${round.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${index}${legs > 1 ? `-${leg}` : ''}`,
    round,
    group,
    tieId,
    aggregateId: tieId,
    leg,
    legs,
    homeTeamId: home.id || home.name,
    awayTeamId: away.id || away.name,
    homeTeamName: home.name,
    awayTeamName: away.name,
    status: 'upcoming'
  };
}

function leagueFixtures(teams) {
  const list = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2) list.push({ id: 'bye', name: 'BYE' });
  const rounds = list.length - 1;
  const fixtures = [];
  const state = new Map();
  const roundPairs = [];

  for (let round = 0; round < rounds; round += 1) {
    const pairs = [];
    for (let index = 0; index < list.length / 2; index += 1) {
      const home = list[index];
      const away = list[list.length - 1 - index];
      if (home.id !== 'bye' && away.id !== 'bye') {
        pairs.push({ home, away, index });
      }
    }
    roundPairs.push(pairs);
    list.splice(1, 0, list.pop());
  }

  for (const [roundIndex, pairs] of roundPairs.entries()) {
    const used = new Set();
    for (const current of pairs.sort(() => Math.random() - 0.5)) {
      const options = [current, { home: current.away, away: current.home }];
      const scored = options.map(option => {
        const homeState = state.get(option.home.id) || { side: '', run: 0, home: 0, away: 0 };
        const awayState = state.get(option.away.id) || { side: '', run: 0, home: 0, away: 0 };
        const homeRun = homeState.side === 'home' ? homeState.run + 1 : 1;
        const awayRun = awayState.side === 'away' ? awayState.run + 1 : 1;
        const streakPenalty = (homeRun > 2 ? 1000 : homeRun * 10) + (awayRun > 2 ? 1000 : awayRun * 10);
        const balancePenalty = Math.abs((homeState.home + 1) - homeState.away) + Math.abs(awayState.home - (awayState.away + 1));
        return { option, score: streakPenalty + balancePenalty + Math.random() };
      }).sort((left, right) => left.score - right.score);

      const selected = scored[0].option;
      const update = (team, side) => {
        const previous = state.get(team.id) || { side: '', run: 0, home: 0, away: 0 };
        state.set(team.id, {
          side,
          run: previous.side === side ? previous.run + 1 : 1,
          home: previous.home + (side === 'home' ? 1 : 0),
          away: previous.away + (side === 'away' ? 1 : 0)
        });
      };
      update(selected.home, 'home');
      update(selected.away, 'away');
      used.add(selected.home.id);
      used.add(selected.away.id);
      fixtures.push(pair(selected.home, selected.away, `Matchday ${roundIndex + 1}`, current.index + 1));
    }
  }

  return fixtures;
}

function knockoutFixtures(teams, round = 'Round 1', options = {}) {
  const fixtures = [];
  const legs = options.twoLegged ? 2 : 1;
  for (let index = 0; index < teams.length - 1; index += 2) {
    const home = teams[index];
    const away = teams[index + 1];
    if (!home || !away) continue;
    const tieId = `${round.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${Math.floor(index / 2) + 1}`;
    fixtures.push(pair(home, away, round, Math.floor(index / 2) + 1, '', tieId, 1, legs));
    if (legs === 2) fixtures.push(pair(away, home, round, Math.floor(index / 2) + 1, '', tieId, 2, legs));
  }
  return fixtures;
}

function groupAndKnockoutFixtures(teams, groupCount = 2) {
  const groups = Array.from({ length: Math.max(1, groupCount) }, () => []);
  teams.forEach((team, index) => groups[index % groups.length].push(team));
  const fixtures = groups.flatMap((group, index) => leagueFixtures(group).map(fixture => ({
    ...fixture,
    group: String.fromCharCode(65 + index),
    matchId: `GROUP-${String.fromCharCode(65 + index)}-${fixture.matchId}`
  })));
  const qualifiers = groups.flatMap(group => group.slice(0, 2));
  fixtures.push(...knockoutFixtures(qualifiers, 'Quarter Final', { twoLegged: true }));
  return fixtures;
}

function generateFixtures(type, teams, options = {}) {
  const normalized = teams.map(team => ({ id: clean(team.id), name: clean(team.name) })).filter(team => team.name);
  if (type === 'league') return leagueFixtures(normalized);
  if (type === 'groups_knockout') return groupAndKnockoutFixtures(normalized, options.groupCount || 2);
  return knockoutFixtures(normalized, 'Round 1', { twoLegged: true });
}

module.exports = { generateFixtures, leagueFixtures, knockoutFixtures, groupAndKnockoutFixtures };