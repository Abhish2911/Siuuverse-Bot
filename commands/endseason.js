const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData, addSheetIfMissing } = require('../utils/sheets');
const { sendAuditLog } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

const UI = {
  archive: safeEmoji(E.archive || E.Stats, '🗃️'),
  season: safeEmoji(E.calendar, '📅'),
  champion: safeEmoji(E.leagueWinner || E.winner || E.trophy_animated, '👑'),
  runnerUp: safeEmoji(E.leagueRunnerUp || E.runnerUp || E.rank, '🥈'),
  goldenBoot: safeEmoji(E.goldenBoot || E.goal, '🥾'),
  playmaker: safeEmoji(E.playmaker || E.assist, '🎯'),
  mvp: safeEmoji(E.mvp, '⭐'),
  defender: safeEmoji(E.bestDefender || E.defense || E.tackle, '🛡️'),
  goalkeeper: safeEmoji(E.goalkeeper || E.save, '🧤'),
  fairPlay: safeEmoji(E.fairplay || E.fairPlay, '🕊️'),
  relegated: safeEmoji(E.relegated || E.down || E.lose, '🔻'),
  coop: safeEmoji(E.coop || E.team, '🤝'),
  players: safeEmoji(E.profile, '👤'),
  teams: safeEmoji(E.team, '👥'),
  awards: safeEmoji(E.badge || E.Badge, '🏅'),
  correct: safeEmoji(E.correct, '✅'),
  wrong: safeEmoji(E.wrong, '❌'),
  lock: safeEmoji(E.lock, '🚫'),
  played: safeEmoji(E.played, '🎮')
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function extractDiscordId(value) {
  const text = String(value || '').trim();
  const mentionMatch = text.match(/<@!?(\d{15,25})>/);
  if (mentionMatch) return mentionMatch[1];

  const rawIdMatch = text.match(/\b\d{15,25}\b/);
  return rawIdMatch ? rawIdMatch[0] : '';
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function nowStamp() {
  return new Date().toISOString();
}

function getCompetitionConfig(type) {
  const key = String(type || 'coop').trim().toLowerCase();

  if (key === 'fa') {
    return {
      key: 'fa',
      typeLabel: 'FA Cup',
      archiveType: 'FA Cup',
      standingsRange: 'Standings!A:J',
      rankingRange: 'FA_Cup_Coop_Ranking!A:AA',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      resultsRange: 'FA_Cup_Coop_Results!A:R',
      teamsRange: 'Teams!A:Z',
      fairPlaySource: 'Teams!A:Z',
      teamIdMapRange: 'Team_ID_Map!A:C',
      championLabel: 'FA Cup Winner',
      runnerUpLabel: 'FA Cup Runner Up',
      awardWinnerName: 'Winner',
      awardRunnerUpName: 'Runner Up'
    };
  }

  if (key === 'carabao') {
    return {
      key: 'carabao',
      typeLabel: 'Carabao Cup',
      archiveType: 'Carabao Cup',
      standingsRange: 'Standings!A:J',
      rankingRange: 'Carabao_Coop_Ranking!A:AA',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      resultsRange: 'Carabao_Coop_Results!A:R',
      teamsRange: 'Teams!A:Z',
      fairPlaySource: 'Teams!A:Z',
      teamIdMapRange: 'Team_ID_Map!A:C',
      championLabel: 'Carabao Winner',
      runnerUpLabel: 'Carabao Runner Up',
      awardWinnerName: 'Winner',
      awardRunnerUpName: 'Runner Up'
    };
  }

  if (key === 'ucl') {
    return {
      key: 'ucl',
      typeLabel: 'UCL',
      archiveType: 'UCL',
      standingsRange: 'UCL_Coop_Group_Standings!A:K',
      rankingRange: 'UCL_Coop_Ranking!A:AA',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      resultsRange: 'UCL_Coop_Results!A:R',
      teamsRange: 'Teams!A:Z',
      fairPlaySource: 'Teams!A:Z',
      teamIdMapRange: 'Team_ID_Map!A:C',
      championLabel: 'UCL Winner',
      runnerUpLabel: 'UCL Runner Up',
      awardWinnerName: 'Winner',
      awardRunnerUpName: 'Runner Up'
    };
  }

  return {
    key: 'coop',
    typeLabel: 'Coop / League',
    archiveType: 'Coop / League',
    standingsRange: 'Standings!A:J',
    rankingRange: 'Ranking!A:AA',
    fixturesRange: 'Fixtures!A:J',
    resultsRange: 'Matches_Entry!A:R',
    teamsRange: 'Teams!A:Z',
    fairPlaySource: 'All_Time_Team_Stats!A:U',
    teamIdMapRange: 'Team_ID_Map!A:C',
    championLabel: 'League Winner',
    runnerUpLabel: 'League Runner Up',
    awardWinnerName: 'Winner',
    awardRunnerUpName: 'Runner Up'
  };
}

function getFixtureScoreIndexes(config) {
  if (config.key === 'fa' || config.key === 'carabao') {
    return { hg: 5, ag: 6 };
  }

  if (config.key === 'ucl') {
    return { hg: 4, ag: 5 };
  }

  return { hg: 4, ag: 5 };
}

function getChampionFromFixtures(fixtures, config) {
  const rows = cleanRows(fixtures);
  if (!rows.length) return null;

  const lastPlayed = [...rows]
    .filter(row => row[getFixtureScoreIndexes(config).hg] !== '' && row[getFixtureScoreIndexes(config).hg] !== undefined && row[getFixtureScoreIndexes(config).ag] !== '' && row[getFixtureScoreIndexes(config).ag] !== undefined)
    .pop();

  if (!lastPlayed) return null;

  const homeIndex = config.key === 'fa' || config.key === 'carabao' ? 3 : config.key === 'ucl' ? 2 : 2;
  const awayIndex = config.key === 'fa' || config.key === 'carabao' ? 4 : config.key === 'ucl' ? 3 : 3;
  const scoreIndexes = getFixtureScoreIndexes(config);
  const hg = toNumber(lastPlayed[scoreIndexes.hg]);
  const ag = toNumber(lastPlayed[scoreIndexes.ag]);

  return {
    team: hg >= ag ? String(lastPlayed[homeIndex] || '').trim() : String(lastPlayed[awayIndex] || '').trim(),
    points: '',
    gd: ''
  };
}

function getRunnerUpFromFixtures(fixtures, config) {
  const rows = cleanRows(fixtures);
  if (!rows.length) return 'N/A';

  const lastPlayed = [...rows]
    .filter(row => row[getFixtureScoreIndexes(config).hg] !== '' && row[getFixtureScoreIndexes(config).hg] !== undefined && row[getFixtureScoreIndexes(config).ag] !== '' && row[getFixtureScoreIndexes(config).ag] !== undefined)
    .pop();

  if (!lastPlayed) return 'N/A';

  const homeIndex = config.key === 'fa' || config.key === 'carabao' ? 3 : config.key === 'ucl' ? 2 : 2;
  const awayIndex = config.key === 'fa' || config.key === 'carabao' ? 4 : config.key === 'ucl' ? 3 : 3;
  const scoreIndexes = getFixtureScoreIndexes(config);
  const hg = toNumber(lastPlayed[scoreIndexes.hg]);
  const ag = toNumber(lastPlayed[scoreIndexes.ag]);

  return hg >= ag
    ? String(lastPlayed[awayIndex] || '').trim() || 'N/A'
    : String(lastPlayed[homeIndex] || '').trim() || 'N/A';
}

function getSeasonLabel(interaction) {
  return String(interaction.options.getString('season') || '').trim();
}

function isAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasRole = interaction.member?.roles?.cache?.some(role => adminRoleIds.includes(role.id));
  return isOwner || hasRole;
}

async function ensureArchiveSheets() {
  await Promise.all([
    addSheetIfMissing('Season_Archive'),
    addSheetIfMissing('All_Time_Player_Stats'),
    addSheetIfMissing('All_Time_Team_Stats'),
    addSheetIfMissing('Awards')
  ]);
}

async function writePlainRows(range, values) {
  if (!values.length) return;

  const [sheetName, columns] = range.split('!');
  const [startCol, endCol] = columns.split(':');
  const existing = await getData(`${sheetName}!${startCol}:${endCol}`, { cache: false }).catch(() => []);
  const startRow = Math.max(2, existing.length + 1);
  const targetRange = `${sheetName}!${startCol}${startRow}:${endCol}${startRow + values.length - 1}`;

  await updateData(targetRange, values);
}

function topValue(rows, nameIndex = 1, valueIndex = 2, requirePositive = true) {
  const badNames = new Set(['user', 'users', 'player', 'players', 'team', 'teams', 'name', 'n/a', '-']);

  const sorted = cleanRows(rows)
    .filter(row => row[nameIndex])
    .filter(row => !badNames.has(String(row[nameIndex] || '').trim().toLowerCase()))
    .filter(row => !requirePositive || toNumber(row[valueIndex]) > 0)
    .sort((a, b) => toNumber(b[valueIndex]) - toNumber(a[valueIndex]));

  if (!sorted.length) return null;

  return {
    name: String(sorted[0][nameIndex] || '').trim(),
    value: toNumber(sorted[0][valueIndex])
  };
}

function getStandingsRows(standings) {
  return cleanRows(standings)
    .filter(row => row[1])
    .sort((a, b) =>
      toNumber(b[9]) - toNumber(a[9]) ||
      toNumber(b[8]) - toNumber(a[8]) ||
      toNumber(b[6]) - toNumber(a[6])
    );
}

function getChampion(standings) {
  const rows = getStandingsRows(standings);
  if (!rows.length) return null;

  return {
    team: rows[0][1],
    points: toNumber(rows[0][9]),
    gd: toNumber(rows[0][8])
  };
}

function getRunnerUp(standings, config = getCompetitionConfig('coop'), fixtures = []) {
  if (config.key === 'fa' || config.key === 'carabao' || config.key === 'ucl') {
    return getRunnerUpFromFixtures(fixtures, config);
  }

  return getStandingsRows(standings)[1]?.[1] || 'N/A';
}

function getRunnerUpPoints(standings, config = getCompetitionConfig('coop')) {
  if (config.key === 'fa' || config.key === 'carabao' || config.key === 'ucl') {
    return '';
  }

  return toNumber(getStandingsRows(standings)[1]?.[9]);
}


function getRelegatedTeams(standings) {
  const rows = getStandingsRows(standings);
  const relegated = rows.slice(-2).map(row => row[1]).filter(Boolean);
  return relegated.length ? relegated.join(', ') : 'N/A';
}

function getFairPlayTeamName(fairPlayRows) {
  const rows = cleanRows(fairPlayRows);
  if (!rows.length) return 'N/A';

  const valid = rows
    .map(row => ({
      team: String(row[0] || '').trim(),
      value: String(row[18] || '').trim()
    }))
    .filter(item => item.team);

  if (!valid.length) return 'N/A';

  const numeric = valid
    .map(item => ({ ...item, score: Number(item.value) }))
    .filter(item => Number.isFinite(item.score));

  if (numeric.length) {
    numeric.sort((a, b) => a.score - b.score);
    return numeric[0].team || 'N/A';
  }

  const preferred = valid.find(item => normalize(item.value) !== 'na' && normalize(item.value) !== 'n/a');
  return preferred?.team || valid[0].team || 'N/A';
}

function getPlayersForTeam(teams, teamName) {
  if (!teamName || teamName === 'N/A') return [];

  const row = cleanRows(teams).find(team =>
    normalize(team[0]) === normalize(teamName) ||
    normalize(team[2]) === normalize(teamName)
  );

  if (!row) return [];

  const shortName = String(row[2] || '').trim().toUpperCase() || String(row[0] || '').trim();
  return String(row[1] || '')
    .split(',')
    .map(player => stripTeamPrefix(player))
    .map(player => player.trim())
    .filter(Boolean)
    .map(player => `${shortName}-${player}`);
}

function buildTeamIdMap(teamIdRows) {
  const map = new Map();

  cleanRows(teamIdRows).forEach(row => {
    const shortName = String(row[0] || '').trim().toUpperCase();
    const teamId = String(row[1] || '').trim();
    const fullName = String(row[2] || '').trim();

    if (!teamId) return;

    if (shortName) map.set(normalize(shortName), teamId);
    if (fullName) map.set(normalize(fullName), teamId);
  });

  return map;
}

function getTeamId(teamIdMap, value) {
  if (!value || !teamIdMap) return '';
  return teamIdMap.get(normalize(value)) || '';
}

function buildPlayerDirectory(teams) {
  const map = new Map();

  cleanRows(teams).forEach(team => {
    const teamName = String(team[0] || '').trim();
    const players = String(team[1] || '')
      .split(',')
      .map(player => player.trim())
      .filter(Boolean);
    const shortName = String(team[2] || '').trim().toUpperCase() || teamName;
    const captainId = extractDiscordId(team[4]);
    const userIds = String(team[5] || '')
      .split(',')
      .map(extractDiscordId)
      .filter(Boolean);

    players.forEach((player, index) => {
      const embeddedId = extractDiscordId(player);
      const cleanPlayer = stripTeamPrefix(player);
      const discordId = embeddedId || (index === 0 ? captainId : userIds[index - 1]) || '';

      const info = {
        player: cleanPlayer,
        discordId,
        team: shortName,
        teamName,
        shortName
      };

      [
        normalize(player),
        normalize(cleanPlayer),
        normalize(`${shortName}-${cleanPlayer}`),
        normalize(`${teamName}-${cleanPlayer}`)
      ]
        .filter(Boolean)
        .forEach(key => map.set(key, info));
    });
  });

  return map;
}

function findPlayerInfo(directory, name) {
  const keys = [
    normalize(name),
    normalize(stripTeamPrefix(name))
  ].filter(Boolean);

  for (const key of keys) {
    if (directory.has(key)) return directory.get(key);
  }

  return null;
}

function getTeamRecordForPlayer(standings, playerInfo) {
  if (!playerInfo) {
    return { matches: 0, wins: 0, draws: 0, losses: 0 };
  }

  const row = cleanRows(standings).find(item =>
    normalize(item[1]) === normalize(playerInfo.teamName) ||
    normalize(item[1]) === normalize(playerInfo.shortName)
  );

  if (!row) {
    return { matches: 0, wins: 0, draws: 0, losses: 0 };
  }

  return {
    matches: toNumber(row[2]),
    wins: toNumber(row[3]),
    draws: toNumber(row[4]),
    losses: toNumber(row[5])
  };
}

function buildPlayerArchiveRows(season, ranking, teams, standings, archivedAt, type = 'Coop / League', config = getCompetitionConfig('coop'), fixtures = [], teamIdRows = []) {
  const directory = buildPlayerDirectory(teams);
  const playerMap = new Map();
  const teamIdMap = buildTeamIdMap(teamIdRows);

  const topStandingTeam = config.key === 'coop' ? getChampion(standings) : getChampionFromFixtures(fixtures, config);

  const championAliases = new Set();
  if (topStandingTeam?.team) {
    championAliases.add(normalize(topStandingTeam.team));

    cleanRows(teams).forEach(team => {
      const teamName = String(team[0] || '').trim();
      const shortName = String(team[2] || '').trim().toUpperCase();

      if (
        normalize(teamName) === normalize(topStandingTeam.team) ||
        normalize(shortName) === normalize(topStandingTeam.team)
      ) {
        championAliases.add(normalize(teamName));
        championAliases.add(normalize(shortName));
      }
    });
  }

  // 1) Seed ALL players from Teams first
  cleanRows(teams).forEach(team => {
    const teamName = String(team[0] || '').trim();
    const shortName = String(team[2] || '').trim().toUpperCase() || teamName;
    const captainId = extractDiscordId(team[4]);
    const userIds = String(team[5] || '')
      .split(',')
      .map(extractDiscordId)
      .filter(Boolean);

    const players = String(team[1] || '')
      .split(',')
      .map(player => player.trim())
      .filter(Boolean);

    const teamRow = cleanRows(standings).find(row =>
      normalize(row[1]) === normalize(teamName) ||
      normalize(row[1]) === normalize(shortName)
    );

    const record = teamRow
      ? {
          matches: toNumber(teamRow[2]),
          wins: toNumber(teamRow[3]),
          draws: toNumber(teamRow[4]),
          losses: toNumber(teamRow[5])
        }
      : {
          matches: 0,
          wins: 0,
          draws: 0,
          losses: 0
        };

    players.forEach((player, index) => {
      const cleanPlayer = stripTeamPrefix(player);
      const discordId =
        extractDiscordId(player) ||
        (index === 0 ? captainId : userIds[index - 1]) ||
        '';

      const key = normalize(`${shortName}-${cleanPlayer}`);

      if (!playerMap.has(key)) {
        playerMap.set(key, {
          player: `${shortName}-${cleanPlayer}`,
          discordId,
          team: shortName,
          teamName,
          shortName,
          matches: record.matches,
          wins: record.wins,
          draws: record.draws,
          losses: record.losses,
          goals: 0,
          assists: 0,
          ga: 0,
          mvp: 0,
          tackles: 0,
          interceptions: 0,
          saves: 0,
          yellow: 0,
          red: 0,
          trophies: 0,
          awards: 0,
          motm: 0,
          cleanSheets: 0
        });
      }
    });
  });

  // 2) Overlay stats from Ranking
  const sections = [
    { start: 0, stat: 'goals' },
    { start: 3, stat: 'assists' },
    { start: 12, stat: 'mvp' },
    { start: 18, stat: 'tackles' },
    { start: 21, stat: 'interceptions' },
    { start: 24, stat: 'saves' }
  ];

  sections.forEach(section => {
    cleanRows(ranking).forEach(row => {
      const rawPlayer = String(row[section.start + 1] || '').trim();
      const value = toNumber(row[section.start + 2]);
      const info = findPlayerInfo(directory, rawPlayer);

      if (!rawPlayer || !info) return;

      const key = normalize(`${info.shortName}-${info.player}`);

      if (!playerMap.has(key)) {
        const record = getTeamRecordForPlayer(standings, info);

        playerMap.set(key, {
          player: `${info.shortName}-${info.player}`,
          discordId: info.discordId,
          team: info.shortName,
          teamName: info.teamName,
          shortName: info.shortName,
          matches: record.matches,
          wins: record.wins,
          draws: record.draws,
          losses: record.losses,
          goals: 0,
          assists: 0,
          ga: 0,
          mvp: 0,
          tackles: 0,
          interceptions: 0,
          saves: 0,
          yellow: 0,
          red: 0,
          trophies: 0,
          awards: 0,
          motm: 0,
          cleanSheets: 0
        });
      }

      const data = playerMap.get(key);
      data[section.stat] = Math.max(data[section.stat], value);
    });
  });

  playerMap.forEach(data => {
    data.ga = data.goals + data.assists;
    data.motm = data.mvp;
    data.trophies = 0;
  });

  const championTeam = config.key === 'coop' ? (getChampion(standings)?.team || '') : (getChampionFromFixtures(fixtures, config)?.team || '');
  const runnerUpTeam = getRunnerUp(standings, config, fixtures);

  return [...playerMap.values()].map(data => {
    const isChampionPlayer =
      normalize(data.teamName) === normalize(championTeam) ||
      normalize(data.shortName) === normalize(championTeam);

    const isRunnerUpPlayer =
      normalize(data.teamName) === normalize(runnerUpTeam) ||
      normalize(data.shortName) === normalize(runnerUpTeam);

    const teamId = getTeamId(teamIdMap, data.shortName) || getTeamId(teamIdMap, data.teamName);

    return [
      data.player,
      data.discordId,
      data.team,
      season,
      data.matches,
      data.wins,
      data.draws,
      data.losses,
      data.goals,
      data.assists,
      data.ga,
      data.mvp,
      data.tackles,
      data.interceptions,
      data.saves,
      data.yellow,
      data.red,
      data.trophies,
      isChampionPlayer ? 1 : 0,
      isRunnerUpPlayer ? 1 : 0,
      0,
      0,
      0,
      0,
      0,
      0,
      data.awards || 0,
      data.motm,
      data.cleanSheets,
      type,
      archivedAt,
      teamId
    ];
  });
}

function buildTeamArchiveRows(season, standings, archivedAt, type = 'Coop / League', config = getCompetitionConfig('coop'), fixtures = [], teams = [], teamIdRows = []) {
  const topStandingTeam = config.key === 'coop' ? getChampion(standings) : getChampionFromFixtures(fixtures, config);
  const runnerUpTeam = getRunnerUp(standings, config, fixtures);
  const teamIdMap = buildTeamIdMap(teamIdRows);

  const sourceRows = config.key === 'coop'
    ? cleanRows(standings).filter(row => row[1])
    : cleanRows(teams).filter(row => {
        if (config.key === 'fa') return normalize(row[8]) === 'active';
        if (config.key === 'carabao') return normalize(row[9]) === 'active';
        if (config.key === 'ucl') return normalize(row[10]) === 'active';
        return false;
      }).map(row => {
        const teamName = String(row[0] || '').trim();
        return [
          '',
          teamName,
          0, 0, 0, 0, 0, 0, 0, 0
        ];
      });

  return sourceRows.map(row => {
    const teamName = String(row[1] || '').trim();
    const isChampion = normalize(teamName) === normalize(topStandingTeam?.team);
    const isRunnerUp = normalize(teamName) === normalize(runnerUpTeam);

    return [
      teamName,
      season,
      toNumber(row[2]),
      toNumber(row[3]),
      toNumber(row[4]),
      toNumber(row[5]),
      toNumber(row[6]),
      toNumber(row[7]),
      toNumber(row[8]),
      toNumber(row[9]),
      config.key === 'coop' && isChampion ? 1 : 0,
      config.key === 'coop' && isRunnerUp ? 1 : 0,
      config.key === 'fa' && isChampion ? 1 : 0,
      config.key === 'fa' && isRunnerUp ? 1 : 0,
      config.key === 'carabao' && isChampion ? 1 : 0,
      config.key === 'carabao' && isRunnerUp ? 1 : 0,
      config.key === 'ucl' && isChampion ? 1 : 0,
      'N/A',
      type,
      archivedAt,
      getTeamId(teamIdMap, teamName)
    ];
  });
}

function buildAwardRows(season, standings, ranking, teams, fairPlayRows, archivedAt, type = 'Coop / League', config = getCompetitionConfig('coop'), fixtures = []) {
  const topStandingTeam = config.key === 'coop' ? getChampion(standings) : getChampionFromFixtures(fixtures, config);
  const runnerUp = getRunnerUp(standings, config, fixtures);
  const topScorer = topValue(ranking, 1, 2, true);
  const topAssister = topValue(ranking.map(row => [row[3], row[4], row[5]]), 1, 2, true);
  const mvp = topValue(ranking.map(row => [row[12], row[13], row[14]]), 1, 2, true);
  const tackles = topValue(ranking.map(row => [row[18], row[19], row[20]]), 1, 2, true);
  const saves = topValue(ranking.map(row => [row[24], row[25], row[26]]), 1, 2, true);
  const relegated = getRelegatedTeams(standings);

  const fairPlayTeam = getFairPlayTeamName(fairPlayRows);
  const fairPlayPlayers = getPlayersForTeam(teams, fairPlayTeam);

  const rows = [];

  if (topStandingTeam?.team) rows.push([season, topStandingTeam.team, config.awardWinnerName, topStandingTeam.points || '', type, archivedAt]);
  // Runner Up award removed as per instructions
  // if (runnerUp && runnerUp !== 'N/A') rows.push([season, runnerUp, config.awardRunnerUpName, getRunnerUpPoints(standings, config) || '', type, archivedAt]);
  if (topScorer?.name) rows.push([season, topScorer.name, 'Golden Boot', topScorer.value || '', type, archivedAt]);
  if (topAssister?.name) rows.push([season, topAssister.name, 'Playmaker', topAssister.value || '', type, archivedAt]);
  if (mvp?.name) rows.push([season, mvp.name, 'MVP', mvp.value || '', type, archivedAt]);
  if (tackles?.name) rows.push([season, tackles.name, 'Best Defender', tackles.value || '', type, archivedAt]);
  if (saves?.name) rows.push([season, saves.name, 'Best GK', saves.value || '', type, archivedAt]);
  fairPlayPlayers.forEach(player => {
    rows.push([season, player, 'Fair Play', 4, type, archivedAt]);
  });
  if (relegated && relegated !== 'N/A') rows.push([season, relegated, 'Relegated Teams', '', type, archivedAt]);

  return rows;
}


async function archiveCompetitionSeason(season, type) {
  const archivedAt = nowStamp();
  const config = getCompetitionConfig(type);

  const [standings, ranking, fixtures, matchesEntry, teams, fairPlayRows, teamIdRows] = await Promise.all([
    getData(config.standingsRange, { cache: false }).catch(() => []),
    getData(config.rankingRange, { cache: false }).catch(() => []),
    getData(config.fixturesRange, { cache: false }).catch(() => []),
    getData(config.resultsRange, { cache: false }).catch(() => []),
    getData(config.teamsRange, { cache: false }).catch(() => []),
    getData(config.fairPlaySource, { cache: false }).catch(() => []),
    getData(config.teamIdMapRange, { cache: false }).catch(() => [])
  ]);

  const teamRows = buildTeamArchiveRows(season, standings, archivedAt, config.archiveType, config, fixtures, teams, teamIdRows);
  const playerRows = buildPlayerArchiveRows(season, ranking, teams, standings, archivedAt, config.archiveType, config, fixtures, teamIdRows);
  const awardRows = buildAwardRows(season, standings, ranking, teams, fairPlayRows, archivedAt, config.archiveType, config, fixtures);
  const champion = config.key === 'coop' ? getChampion(standings) : getChampionFromFixtures(fixtures, config);
  const runnerUp = getRunnerUp(standings, config, fixtures);

  const scoreIndexes = getFixtureScoreIndexes(config);
  const matchesPlayed = cleanRows(fixtures).filter(row => row[scoreIndexes.hg] !== '' && row[scoreIndexes.hg] !== undefined && row[scoreIndexes.ag] !== '' && row[scoreIndexes.ag] !== undefined).length;
  const resultsSubmitted = cleanRows(matchesEntry).length;

  await ensureArchiveSheets();

  await writePlainRows('Season_Archive!A:K', [[
    season,
    champion?.team || 'N/A',
    runnerUp,
    topValue(ranking, 1, 2, true)?.name || 'N/A',
    topValue(ranking.map(row => [row[3], row[4], row[5]]), 1, 2, true)?.name || 'N/A',
    topValue(ranking.map(row => [row[12], row[13], row[14]]), 1, 2, true)?.name || 'N/A',
    'N/A',
    'N/A',
    config.key === 'coop' ? getFairPlayTeamName(fairPlayRows) : 'N/A',
    config.key === 'coop' ? getRelegatedTeams(standings) : 'N/A',
    config.archiveType
  ]]);

  if (teamRows.length) await writePlainRows('All_Time_Team_Stats!A:V', teamRows);
  if (playerRows.length) await writePlainRows('All_Time_Player_Stats!A:AF', playerRows);
  if (awardRows.length) await writePlainRows('Awards!A:F', awardRows);

  return {
    champion,
    runnerUp,
    matchesPlayed,
    resultsSubmitted,
    teamRows,
    playerRows,
    awardRows,
    config
  };
}

function buildEndSeasonSummary(season, result) {
  const typeLabel = result?.config?.typeLabel || 'Season';
  const championName = result?.champion?.team || result?.champion || 'N/A';
  const championRecord = result?.champion?.points
    ? `${result.champion.points} pts • GD ${result.champion.gd || 0}`
    : 'Cup winner archived';

  return {
    season,
    typeLabel,
    championName,
    championRecord,
    runnerUp: result?.runnerUp || 'N/A',
    matchesPlayed: result?.matchesPlayed || 0,
    resultsSubmitted: result?.resultsSubmitted || 0,
    teamRows: result?.teamRows?.length || 0,
    playerRows: result?.playerRows?.length || 0,
    awardRows: result?.awardRows?.length || 0
  };
}

function buildEndSeasonDescription(summary) {
  return (
    `# ${summary.season}\n` +
    `${UI.correct} **${summary.typeLabel}** archive completed successfully.\n\n` +
    `${UI.champion} **Champion:** ${summary.championName}\n` +
    `${UI.runnerUp} **Runner Up:** ${summary.runnerUp}\n` +
    `${UI.played} **Matches Played:** ${summary.matchesPlayed}\n` +
    `${UI.archive} **Results Submitted:** ${summary.resultsSubmitted}\n` +
    `${UI.awards} **Awards Archived:** ${summary.awardRows}`
  );
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('endseason')
    .setDescription('Archive current season stats and awards')
    .addStringOption(option =>
      option
        .setName('season')
        .setDescription('Season name, example: Season 2')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Choose which season type to archive')
        .setRequired(true)
        .addChoices(
          { name: 'Coop / League', value: 'coop' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    )
    .addBooleanOption(option =>
      option
        .setName('confirm')
        .setDescription('Set true to confirm archiving')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: `${UI.lock} Admin only command.` };
    }

    const season = getSeasonLabel(interaction);
    const type = interaction.options.getString('type');
    const confirm = interaction.options.getBoolean('confirm');

    if (!confirm) {
      return {
        content: `${UI.wrong} Archive cancelled. Use \`/endseason season:${season} type:${type} confirm:true\`.`
      };
    }

    try {
      const result = await archiveCompetitionSeason(season, type);
      const typeLabel = result.config.typeLabel;
      const summary = buildEndSeasonSummary(season, result);

      const embed = new EmbedBuilder()
        .setTitle(`${UI.archive} Season Archived`)
        .setDescription(buildEndSeasonDescription(summary))
        .addFields(
          {
            name: `${UI.champion} Champion`,
            value: `**${summary.championName}**\n${summary.championRecord}`,
            inline: true
          },
          {
            name: `${UI.runnerUp} Runner Up`,
            value: summary.runnerUp,
            inline: true
          },
          {
            name: `${UI.played} Matches`,
            value: `Played: **${summary.matchesPlayed}**\nSubmitted: **${summary.resultsSubmitted}**`,
            inline: true
          },
          {
            name: `${UI.teams} Team Archive`,
            value: `Archived team rows: **${summary.teamRows}**`,
            inline: true
          },
          {
            name: `${UI.players} Player Archive`,
            value: `Archived player rows: **${summary.playerRows}**`,
            inline: true
          },
          {
            name: `${UI.awards} Awards Archive`,
            value: `Archived award rows: **${summary.awardRows}**`,
            inline: true
          }
        )
        .setColor(0x2ECC71)
        .setFooter({ text: `End Season • ${typeLabel} • ${season}` })
        .setTimestamp();

      sendAuditLog(interaction, {
        title: 'Season Archived',
        description: `**${season}** ${typeLabel} archive completed by ${interaction.user}.`,
        color: 0x2ECC71,
        fields: [
          { name: 'Type', value: typeLabel, inline: true },
          { name: 'Champion', value: result.champion?.team || result.champion || 'N/A', inline: true },
          { name: 'Awards', value: String(result.awardRows ? result.awardRows.length : 0), inline: true }
        ]
      });

      return { embeds: [embed] };
    } catch (error) {
      console.error('❌ End season error:', error);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${UI.wrong} End Season Failed`)
            .setDescription(
              `${UI.archive} The season archive process could not be completed.\n\n` +
              `\`\`\`ini\n${error.message || 'Unknown error'}\n\`\`\``
            )
            .setColor(0xE74C3C)
            .setFooter({ text: 'End Season • Archive failed' })
        ]
      };
    }
  }
};
