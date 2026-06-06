/****
 * competitionHelpers.js
 *
 * Refactored shared competition utilities:
 * - string/number normalization
 * - team metadata helpers
 * - seeding & ranking utilities
 * - draw & group assignment logic
 * - knockout & fixture generation
 */

/* -----------------------------
 * BASIC UTILITIES
 * ----------------------------- */

function clean(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function cleanLower(value) {
  return clean(value).toLowerCase();
}

function shuffleArray(arr) {
  if (!Array.isArray(arr)) return [];
  const copy = [...arr];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/* -----------------------------
 * HEADER MAPPING
 * ----------------------------- */

function getTeamsHeaderMap(header = []) {
  const lowered = Array.isArray(header)
    ? header.map(col => cleanLower(col))
    : [];

  const indexOf = (...names) => {
    for (const name of names) {
      const idx = lowered.indexOf(String(name).toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    teamName: indexOf('Team Name', 'Team'),
    players: indexOf('Players'),
    shortName: indexOf('Short Name', 'Short'),
    logo: indexOf('Logo'),
    captainId: indexOf('CaptainID', 'Captain ID'),
    usersId: indexOf('UsersID', 'Users ID'),
    stadium: indexOf('Stadium'),
    color: indexOf('Color'),

    faStatus: indexOf('FA Status', 'FA Cup Status'),
    carabaoStatus: indexOf('Carabao Status', 'Carabao Cup Status'),
    uclStatus: indexOf('UCL Status'),

    uclGroup: indexOf('UCL Group', 'Group'),
    uclPot: indexOf('UCL Pot', 'Pot'),

    powerRank: indexOf('Power Rank'),
    powerScore: indexOf('Power Score'),

    faSeed: indexOf('FA Cup Seed', 'FA Seed'),
    carabaoSeed: indexOf('Carabao Seed', 'Carabao Cup Seed')
  };
}

/* -----------------------------
 * TEAM FILTERING / SORTING
 * ----------------------------- */

function getActiveTeamsByCompetition(teamRows = [], headerMap = {}, competition = 'league') {
  const comp = cleanLower(competition);
  const rows = Array.isArray(teamRows) ? teamRows : [];

  return rows.filter(row => {
    const name = clean(row?.[headerMap.teamName]);
    if (!name) return false;

    if (comp === 'league') return true;
    if (comp === 'fa') return cleanLower(row?.[headerMap.faStatus]) === 'active';
    if (comp === 'carabao') return cleanLower(row?.[headerMap.carabaoStatus]) === 'active';
    if (comp === 'ucl') return cleanLower(row?.[headerMap.uclStatus]) === 'active';

    return false;
  });
}

function sortTeamsByColumn(teamRows = [], columnIndex = -1, fallbackIndex = 0) {
  const rows = Array.isArray(teamRows) ? [...teamRows] : [];

  return rows.sort((a, b) => {
    if (columnIndex >= 0) {
      const diff = toNumber(a?.[columnIndex]) - toNumber(b?.[columnIndex]);
      if (diff !== 0) return diff;
    }

    return clean(a?.[fallbackIndex]).localeCompare(clean(b?.[fallbackIndex]));
  });
}

/* -----------------------------
 * SEEDING / ASSIGNMENT
 * ----------------------------- */

function assignSequentialValues(teamRows = [], headerMap = {}, sortedRows = [], targetColumn = -1) {
  if (targetColumn < 0 || headerMap.teamName < 0) {
    return Array.isArray(teamRows) ? teamRows.map(r => [...r]) : [];
  }

  const map = new Map();

  sortedRows.forEach((row, i) => {
    const name = cleanLower(row?.[headerMap.teamName]);
    if (name) map.set(name, i + 1);
  });

  return teamRows.map(row => {
    const next = [...row];
    const name = cleanLower(row?.[headerMap.teamName]);
    next[targetColumn] = map.get(name) || '';
    return next;
  });
}

function assignUclPots(sortedTeams = [], headerMap = {}, potColumn = -1) {
  if (potColumn < 0) return Array.isArray(sortedTeams) ? sortedTeams.map(r => [...r]) : [];

  const total = sortedTeams.length;
  let potSize = 4;

  if (total === 8 || total === 12 || total === 16) potSize = 4;
  else if (total > 0) potSize = Math.ceil(total / Math.ceil(total / 4));

  return sortedTeams.map((row, i) => {
    const next = [...row];
    next[potColumn] = Math.floor(i / potSize) + 1;
    return next;
  });
}

/* -----------------------------
 * UCL GROUP DRAW
 * ----------------------------- */

function drawGroupsFromPots(teamRows = [], headerMap = {}, groupNames = []) {
  if (
    headerMap.teamName < 0 ||
    headerMap.uclPot < 0 ||
    headerMap.uclGroup < 0
  ) return Array.isArray(teamRows) ? teamRows.map(r => [...r]) : [];

  const groups = Array.isArray(groupNames)
    ? groupNames.map(clean).filter(Boolean)
    : [];

  if (!groups.length) return Array.isArray(teamRows) ? teamRows.map(r => [...r]) : [];

  const potMap = new Map();

  teamRows.forEach(row => {
    const pot = clean(row?.[headerMap.uclPot]);
    if (!pot) return;
    if (!potMap.has(pot)) potMap.set(pot, []);
    potMap.get(pot).push(row);
  });

  const assignments = new Map();

  [...potMap.keys()]
    .sort((a, b) => toNumber(a) - toNumber(b))
    .forEach(pot => {
      const shuffled = shuffleArray(potMap.get(pot));
      shuffled.forEach((row, i) => {
        const team = cleanLower(row?.[headerMap.teamName]);
        if (!team) return;
        assignments.set(team, groups[i % groups.length]);
      });
    });

  return teamRows.map(row => {
    const next = [...row];
    const team = cleanLower(row?.[headerMap.teamName]);
    next[headerMap.uclGroup] = assignments.get(team) || '';
    return next;
  });
}

/* -----------------------------
 * KNOCKOUT HELPERS
 * ----------------------------- */

function generateSeededKnockoutPairings(teams = [], options = {}) {
  const {
    teamNameKey = 'teamName',
    shortNameKey = 'shortName',
    roundCode = 'QF',
    competitionCode = 'FA'
  } = options;

  const list = (Array.isArray(teams) ? teams : [])
    .map(t => ({ ...t }))
    .filter(t => clean(t?.[teamNameKey]));

  const out = [];
  let l = 0;
  let r = list.length - 1;
  let i = 1;

  while (l < r) {
    const home = list[l];
    const away = list[r];

    out.push({
      md: `${competitionCode}-${roundCode}-${i}`,
      round: roundCode,
      date: '',
      homeTeam: clean(home?.[teamNameKey]),
      awayTeam: clean(away?.[teamNameKey]),
      hg: '',
      ag: '',
      result: '',
      homeShort: clean(home?.[shortNameKey]),
      awayShort: clean(away?.[shortNameKey]),
      status: 'Upcoming'
    });

    l++;
    r--;
    i++;
  }

  return out;
}

function advanceKnockoutRound(fixtures = [], options = {}) {
  const { nextRoundCode = 'SF', competitionCode = 'FA' } = options;

  const winners = (Array.isArray(fixtures) ? fixtures : [])
    .filter(m => clean(m?.status).toLowerCase() === 'done')
    .map(m => {
      const hg = toNumber(m?.hg);
      const ag = toNumber(m?.ag);

      if (hg > ag) return { teamName: clean(m?.homeTeam), shortName: clean(m?.homeShort) };
      if (ag > hg) return { teamName: clean(m?.awayTeam), shortName: clean(m?.awayShort) };
      return null;
    })
    .filter(Boolean);

  const next = [];

  for (let i = 0; i < winners.length; i += 2) {
    const a = winners[i];
    const b = winners[i + 1];
    if (!a || !b) continue;

    next.push({
      md: `${competitionCode}-${nextRoundCode}-${Math.floor(i / 2) + 1}`,
      round: nextRoundCode,
      date: '',
      homeTeam: clean(a.teamName),
      awayTeam: clean(b.teamName),
      hg: '',
      ag: '',
      result: '',
      homeShort: clean(a.shortName),
      awayShort: clean(b.shortName),
      status: 'Upcoming'
    });
  }

  return next;
}

/* -----------------------------
 * ROUND ROBIN FIXTURES
 * ----------------------------- */

function generateRoundRobinFixtures(teams = [], options = {}) {
  const {
    competitionCode = 'L',
    doubleRoundRobin = false,
    includeGroupInId = false,
    groupName = '',
    teamNameKey = 'teamName',
    shortNameKey = 'shortName',
    randomizeHomeAway = true,
    shuffleRounds = false
  } = options;

  const shuffled = shuffleArray(
    (Array.isArray(teams) ? teams : []).map(t => ({ ...t }))
  );

  if (shuffled.length < 2) return [];

  const list = [...shuffled];

  if (list.length % 2 !== 0) {
    list.push({ [teamNameKey]: 'BYE', [shortNameKey]: 'BYE' });
  }

  const rounds = [];
  const rotation = [...list];
  const totalRounds = rotation.length - 1;
  const half = rotation.length / 2;

  const realTeams = list
    .map(t => clean(t?.[teamNameKey]))
    .filter(n => n && n.toUpperCase() !== 'BYE');

  const homeMax = Math.ceil((realTeams.length - 1) / 2);

  const homeCount = new Map();
  const streak = new Map(realTeams.map(t => [t, { last: '', count: 0 }]));

  const penaltyStreak = (team, side) => {
    const s = streak.get(team) || { last: '', count: 0 };
    if (s.last !== side) return 0;
    if (s.count >= 2) return 100;
    if (s.count === 1) return 10;
    return 0;
  };

  const penaltyHome = team => {
    const c = homeCount.get(team) || 0;
    if (c >= homeMax) return 1000;
    return c * 5;
  };

  const updateStreak = (team, side) => {
    const s = streak.get(team) || { last: '', count: 0 };
    if (s.last === side) streak.set(team, { last: side, count: s.count + 1 });
    else streak.set(team, { last: side, count: 1 });
  };

  const chooseSides = (a, as, b, bs, r, i) => {
    if (!randomizeHomeAway) {
      return { homeTeam: a, awayTeam: b, homeShort: as, awayShort: bs };
    }

    const optA = {
      homeTeam: a,
      awayTeam: b,
      homeShort: as,
      awayShort: bs,
      penalty: penaltyHome(a) + penaltyStreak(a, 'H') + penaltyStreak(b, 'A')
    };

    const optB = {
      homeTeam: b,
      awayTeam: a,
      homeShort: bs,
      awayShort: as,
      penalty: penaltyHome(b) + penaltyStreak(b, 'H') + penaltyStreak(a, 'A')
    };

    if (optA.penalty !== optB.penalty) return optA.penalty < optB.penalty ? optA : optB;

    return (i === 0 ? r % 2 === 0 : (r + i) % 2 === 1) ? optB : optA;
  };

  for (let r = 0; r < totalRounds; r++) {
    const pairings = [];

    for (let i = 0; i < half; i++) {
      const A = rotation[i];
      const B = rotation[rotation.length - 1 - i];

      const aName = clean(A?.[teamNameKey]);
      const bName = clean(B?.[teamNameKey]);

      if (aName.toUpperCase() === 'BYE' || bName.toUpperCase() === 'BYE') continue;

      const chosen = chooseSides(
        aName,
        clean(A?.[shortNameKey]),
        bName,
        clean(B?.[shortNameKey]),
        r,
        i
      );

      homeCount.set(chosen.homeTeam, (homeCount.get(chosen.homeTeam) || 0) + 1);
      updateStreak(chosen.homeTeam, 'H');
      updateStreak(chosen.awayTeam, 'A');

      pairings.push({
        homeTeam: chosen.homeTeam,
        awayTeam: chosen.awayTeam,
        homeShort: chosen.homeShort,
        awayShort: chosen.awayShort,
        round: r + 1
      });
    }

    rounds.push(pairings);

    const fixed = rotation[0];
    const moved = rotation.pop();
    rotation.splice(1, 0, moved);
    rotation[0] = fixed;
  }

  const first = shuffleRounds ? shuffleArray(rounds) : rounds;

  const second = doubleRoundRobin
    ? first.map(r => r.map(m => ({
        ...m,
        homeTeam: m.awayTeam,
        awayTeam: m.homeTeam,
        homeShort: m.awayShort,
        awayShort: m.homeShort
      })))
    : [];

  const all = [...first, ...second];

  const fixtures = [];

  all.forEach((round, ri) => {
    round.forEach((m, mi) => {
      const md = ri + 1;
      const id = includeGroupInId && groupName
        ? `${competitionCode}-GS-${groupName}-${md}-${mi + 1}`
        : `${competitionCode}-${md}-${mi + 1}`;

      fixtures.push({
        md: id,
        date: '',
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        hg: '',
        ag: '',
        result: '',
        homeShort: m.homeShort,
        awayShort: m.awayShort,
        status: 'Upcoming'
      });
    });
  });

  return fixtures;
}

module.exports = {
  clean,
  toNumber,
  cleanLower,
  shuffleArray,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn,
  assignSequentialValues,
  assignUclPots,
  drawGroupsFromPots,
  generateSeededKnockoutPairings,
  advanceKnockoutRound,
  generateRoundRobinFixtures
};
