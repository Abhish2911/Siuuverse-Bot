/****
 * competitionHelpers.js
 *
 * Shared helper functions for competition systems such as:
 * - power ranking
 * - seed generation
 * - UCL pot assignment
 * - group draws
 * - fixture generation
 */

/**
 * Clean any incoming value into a trimmed string.
 * Belongs to: general shared competition helpers.
 */
function clean(value) {
  return String(value || '').trim();
}

/**
 * Convert any value into a safe number.
 * Belongs to: ranking, seeding, standings, and fixture sorting helpers.
 */
function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function cleanLower(value) {
  return clean(value).toLowerCase();
}

/**
 * Shuffle an array using Fisher-Yates.
 * Belongs to: draw helpers (cup draws, UCL draws, knockout draws).
 */
function shuffleArray(arr) {
  if (!Array.isArray(arr)) return [];

  const copy = [...arr];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/**
 * Build a column map from the Teams sheet header row.
 * Belongs to: team / competition metadata helpers.
 */
function getTeamsHeaderMap(header = []) {
  const lowered = Array.isArray(header) ? header.map(col => cleanLower(col)) : [];

  const indexOf = (...names) => {
    for (const name of names) {
      const index = lowered.indexOf(String(name).toLowerCase());
      if (index !== -1) return index;
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

/**
 * Return only active teams for a requested competition.
 * Belongs to: competition team filtering helpers.
 */
function getActiveTeamsByCompetition(teamRows = [], headerMap = {}, competition = 'league') {
  const normalizedCompetition = cleanLower(competition);
  const rows = Array.isArray(teamRows) ? teamRows : [];

  return rows.filter(row => {
    const teamName = clean(row?.[headerMap.teamName]);
    if (!teamName) return false;

    if (normalizedCompetition === 'league') return true;
    if (normalizedCompetition === 'fa') return cleanLower(row?.[headerMap.faStatus]) === 'active';
    if (normalizedCompetition === 'carabao') return cleanLower(row?.[headerMap.carabaoStatus]) === 'active';
    if (normalizedCompetition === 'ucl') return cleanLower(row?.[headerMap.uclStatus]) === 'active';

    return false;
  });
}

/**
 * Sort teams by a numeric column ascending.
 * Belongs to: seed and rank ordering helpers.
 */
function sortTeamsByColumn(teamRows = [], columnIndex = -1, fallbackNameIndex = 0) {
  const rows = Array.isArray(teamRows) ? [...teamRows] : [];

  return rows.sort((a, b) => {
    if (columnIndex >= 0) {
      const aValue = toNumber(a?.[columnIndex]);
      const bValue = toNumber(b?.[columnIndex]);
      if (aValue !== bValue) return aValue - bValue;
    }

    return clean(a?.[fallbackNameIndex]).localeCompare(clean(b?.[fallbackNameIndex]));
  });
}

/**
 * Write sequential values (1..N) into a target column based on the given sorted rows.
 * Belongs to: seed generation and rank assignment helpers.
 */
function assignSequentialValues(teamRows = [], headerMap = {}, sortedRows = [], targetColumn = -1) {
  if (targetColumn < 0 || headerMap.teamName < 0) {
    return Array.isArray(teamRows) ? teamRows.map(row => [...row]) : [];
  }

  const valueMap = new Map();

  sortedRows.forEach((row, index) => {
    const teamName = cleanLower(row?.[headerMap.teamName]);
    if (!teamName) return;
    valueMap.set(teamName, index + 1);
  });

  return teamRows.map(row => {
    const next = [...row];
    const teamName = cleanLower(row?.[headerMap.teamName]);
    next[targetColumn] = valueMap.get(teamName) || '';
    return next;
  });
}

/**
 * Assign UCL pots based on already sorted team rows.
 * Belongs to: UCL pot generation helpers.
 */
function assignUclPots(sortedTeams = [], headerMap = {}, potColumn = -1) {
  if (potColumn < 0) {
    return Array.isArray(sortedTeams) ? sortedTeams.map(row => [...row]) : [];
  }

  const totalTeams = sortedTeams.length;
  let potSize = 4;

  if (totalTeams === 8) potSize = 4;
  else if (totalTeams === 12) potSize = 4;
  else if (totalTeams === 16) potSize = 4;
  else if (totalTeams > 0) potSize = Math.ceil(totalTeams / Math.ceil(totalTeams / 4));

  return sortedTeams.map((row, index) => {
    const next = [...row];
    next[potColumn] = Math.floor(index / potSize) + 1;
    return next;
  });
}

/**
 * Draw groups from teams already assigned into pots.
 * Belongs to: UCL group draw helpers.
 */
function drawGroupsFromPots(teamRows = [], headerMap = {}, groupNames = []) {
  if (headerMap.teamName < 0 || headerMap.uclPot < 0 || headerMap.uclGroup < 0) {
    return Array.isArray(teamRows) ? teamRows.map(row => [...row]) : [];
  }

  const normalizedGroupNames = Array.isArray(groupNames)
    ? groupNames.map(name => clean(name)).filter(Boolean)
    : [];

  if (!normalizedGroupNames.length) {
    return Array.isArray(teamRows) ? teamRows.map(row => [...row]) : [];
  }

  const potMap = new Map();

  teamRows.forEach(row => {
    const pot = clean(row?.[headerMap.uclPot]);
    if (!pot) return;
    if (!potMap.has(pot)) potMap.set(pot, []);
    potMap.get(pot).push(row);
  });

  const drawnRows = teamRows.map(row => [...row]);
  const teamAssignments = new Map();

  [...potMap.keys()]
    .sort((a, b) => toNumber(a) - toNumber(b))
    .forEach(potKey => {
      const shuffledPot = shuffleArray(potMap.get(potKey) || []);
      shuffledPot.forEach((row, index) => {
        const groupName = normalizedGroupNames[index % normalizedGroupNames.length] || '';
        const teamName = cleanLower(row?.[headerMap.teamName]);
        if (!teamName) return;
        teamAssignments.set(teamName, groupName);
      });
    });

  return drawnRows.map(row => {
    const next = [...row];
    const teamName = cleanLower(row?.[headerMap.teamName]);
    next[headerMap.uclGroup] = teamAssignments.get(teamName) || '';
    return next;
  });
}

/**
 * Pair teams for knockout fixtures using seeded bracket order.
 * Belongs to: domestic cup and knockout bracket generation helpers.
 */
function generateSeededKnockoutPairings(teams = [], options = {}) {
  const {
    teamNameKey = 'teamName',
    shortNameKey = 'shortName',
    roundCode = 'QF',
    competitionCode = 'FA'
  } = options;

  const filteredTeams = (Array.isArray(teams) ? teams : [])
    .map(team => ({ ...team }))
    .filter(team => clean(team?.[teamNameKey]));

  const pairings = [];
  let left = 0;
  let right = filteredTeams.length - 1;
  let matchIndex = 1;

  while (left < right) {
    const home = filteredTeams[left];
    const away = filteredTeams[right];

    pairings.push({
      md: `${competitionCode} ${roundCode}${matchIndex}`,
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

    left += 1;
    right -= 1;
    matchIndex += 1;
  }

  return pairings;
}

/**
 * Build the next knockout round from the winners of a finished fixture list.
 * Belongs to: advance-knockout helpers.
 */
function advanceKnockoutRound(fixtures = [], options = {}) {
  const {
    nextRoundCode = 'SF',
    competitionCode = 'FA'
  } = options;

  const winners = (Array.isArray(fixtures) ? fixtures : [])
    .filter(match => clean(match?.status).toLowerCase() === 'done')
    .map(match => {
      const homeGoals = toNumber(match?.hg);
      const awayGoals = toNumber(match?.ag);

      if (homeGoals > awayGoals) {
        return {
          teamName: clean(match?.homeTeam),
          shortName: clean(match?.homeShort)
        };
      }

      if (awayGoals > homeGoals) {
        return {
          teamName: clean(match?.awayTeam),
          shortName: clean(match?.awayShort)
        };
      }

      return null;
    })
    .filter(Boolean);

  const nextFixtures = [];

  for (let i = 0; i < winners.length; i += 2) {
    const home = winners[i];
    const away = winners[i + 1];
    if (!home || !away) continue;

    nextFixtures.push({
      md: `${competitionCode} ${nextRoundCode}${Math.floor(i / 2) + 1}`,
      round: nextRoundCode,
      date: '',
      homeTeam: clean(home.teamName),
      awayTeam: clean(away.teamName),
      hg: '',
      ag: '',
      result: '',
      homeShort: clean(home.shortName),
      awayShort: clean(away.shortName),
      status: 'Upcoming'
    });
  }

  return nextFixtures;
}

/**
 * Generate round-robin fixtures.
 * Belongs to: league and UCL fixture generation helpers.
 */
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

  const inputTeams = shuffleArray((Array.isArray(teams) ? teams : []).map(team => ({ ...team })));
  if (inputTeams.length < 2) return [];

  const teamList = [...inputTeams];
  const isOdd = teamList.length % 2 !== 0;
  if (isOdd) {
    teamList.push({ [teamNameKey]: 'BYE', [shortNameKey]: 'BYE' });
  }

  const rounds = [];
  const rotation = [...teamList];
  const totalRounds = rotation.length - 1;
  const half = rotation.length / 2;

  const realTeams = teamList
    .map(team => clean(team?.[teamNameKey]))
    .filter(name => name && name.toUpperCase() !== 'BYE');

  const targetHomeMax = Math.ceil((realTeams.length - 1) / 2);

  const homeCounts = new Map();
  const streaks = new Map();

  realTeams.forEach(teamName => {
    homeCounts.set(teamName, 0);
    streaks.set(teamName, { last: '', streak: 0 });
  });

  function getStreakPenalty(teamName, side) {
    const state = streaks.get(teamName) || { last: '', streak: 0 };
    if (state.last !== side) return 0;
    if (state.streak >= 2) return 100;
    if (state.streak === 1) return 10;
    return 0;
  }

  function getHomeQuotaPenalty(teamName) {
    const count = homeCounts.get(teamName) || 0;
    if (count >= targetHomeMax) return 1000;
    return count * 5;
  }

  function chooseSides(teamAName, teamAShort, teamBName, teamBShort, round, pairIndex) {
    if (!randomizeHomeAway) {
      return {
        homeTeam: teamAName,
        awayTeam: teamBName,
        homeShort: teamAShort,
        awayShort: teamBShort
      };
    }

    const optionA = {
      homeTeam: teamAName,
      awayTeam: teamBName,
      homeShort: teamAShort,
      awayShort: teamBShort,
      penalty:
        getHomeQuotaPenalty(teamAName) +
        getStreakPenalty(teamAName, 'H') +
        getStreakPenalty(teamBName, 'A')
    };

    const optionB = {
      homeTeam: teamBName,
      awayTeam: teamAName,
      homeShort: teamBShort,
      awayShort: teamAShort,
      penalty:
        getHomeQuotaPenalty(teamBName) +
        getStreakPenalty(teamBName, 'H') +
        getStreakPenalty(teamAName, 'A')
    };

    if (optionA.penalty < optionB.penalty) return optionA;
    if (optionB.penalty < optionA.penalty) return optionB;

    const shouldSwap = pairIndex === 0
      ? round % 2 === 0
      : (round + pairIndex) % 2 === 1;

    return shouldSwap ? optionB : optionA;
  }

  function updateStreak(teamName, side) {
    const state = streaks.get(teamName) || { last: '', streak: 0 };
    if (state.last === side) {
      streaks.set(teamName, { last: side, streak: state.streak + 1 });
    } else {
      streaks.set(teamName, { last: side, streak: 1 });
    }
  }

  for (let round = 0; round < totalRounds; round++) {
    const pairings = [];

    for (let i = 0; i < half; i++) {
      const teamA = rotation[i];
      const teamB = rotation[rotation.length - 1 - i];

      const teamAName = clean(teamA?.[teamNameKey]);
      const teamBName = clean(teamB?.[teamNameKey]);
      const teamAShort = clean(teamA?.[shortNameKey]);
      const teamBShort = clean(teamB?.[shortNameKey]);

      if (teamAName.toUpperCase() === 'BYE' || teamBName.toUpperCase() === 'BYE') {
        continue;
      }

      const chosen = chooseSides(teamAName, teamAShort, teamBName, teamBShort, round, i);

      homeCounts.set(chosen.homeTeam, (homeCounts.get(chosen.homeTeam) || 0) + 1);
      updateStreak(chosen.homeTeam, 'H');
      updateStreak(chosen.awayTeam, 'A');

      pairings.push({
        homeTeam: chosen.homeTeam,
        awayTeam: chosen.awayTeam,
        homeShort: chosen.homeShort,
        awayShort: chosen.awayShort,
        round: round + 1
      });
    }

    rounds.push(pairings);

    const fixed = rotation[0];
    const moved = rotation.pop();
    rotation.splice(1, 0, moved);
    rotation[0] = fixed;
  }

  const firstLegRounds = shuffleRounds ? shuffleArray(rounds) : rounds;

  const secondLegRounds = doubleRoundRobin
    ? firstLegRounds.map(pairings => pairings.map(match => ({
        ...match,
        homeTeam: match.awayTeam,
        awayTeam: match.homeTeam,
        homeShort: match.awayShort,
        awayShort: match.homeShort
      })))
    : [];

  const allRounds = [...firstLegRounds, ...secondLegRounds];
  const fixtures = [];

  allRounds.forEach((pairings, roundIndex) => {
    pairings.forEach((match, matchIndex) => {
      const mdNumber = roundIndex + 1;
      const matchNumber = matchIndex + 1;
      const matchId = includeGroupInId && groupName
        ? `${competitionCode} GS-${groupName}-MD${mdNumber}.${matchNumber}`
        : `${competitionCode} MD${mdNumber}.${matchNumber}`;

      fixtures.push({
        md: matchId,
        date: '',
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        hg: '',
        ag: '',
        result: '',
        homeShort: match.homeShort,
        awayShort: match.awayShort,
        status: 'Upcoming'
      });
    });
  });

  return fixtures;
}

module.exports = {
  clean,
  toNumber,
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