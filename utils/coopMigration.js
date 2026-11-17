const crypto = require('crypto');

const COMPETITIONS = {
  league: { name: 'Coop / League', aliases: ['coop', 'league', 'coop / league'] },
  fa_cup: { name: 'FA Cup', aliases: ['fa', 'fa cup'] },
  carabao_cup: { name: 'Carabao Cup', aliases: ['carabao', 'carabao cup'] },
  ucl: { name: 'UCL', aliases: ['ucl', 'uefa champions league'] }
};

const PLAYER_TITLES = [
  [18, 'league', 'League Title', 'winner'],
  [19, 'league', 'League Runner-Up', 'runner_up'],
  [20, 'fa_cup', 'FA Cup', 'winner'],
  [21, 'fa_cup', 'FA Cup Runner-Up', 'runner_up'],
  [22, 'carabao_cup', 'Carabao Cup', 'winner'],
  [23, 'carabao_cup', 'Carabao Cup Runner-Up', 'runner_up'],
  [24, 'ucl', 'UCL', 'winner'],
  [25, 'ucl', 'UCL Runner-Up', 'runner_up']
];

const TEAM_TITLES = [
  [10, 'league', 'League Title', 'winner'],
  [11, 'league', 'League Runner-Up', 'runner_up'],
  [12, 'fa_cup', 'FA Cup', 'winner'],
  [13, 'fa_cup', 'FA Cup Runner-Up', 'runner_up'],
  [14, 'carabao_cup', 'Carabao Cup', 'winner'],
  [15, 'carabao_cup', 'Carabao Cup Runner-Up', 'runner_up'],
  [16, 'ucl', 'UCL', 'winner']
];

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function clean(value) {
  return String(value ?? '').trim();
}

function numberAt(row, index) {
  const value = Number(String(row[index] ?? '').replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : 0;
}

function dateAt(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function seasonDetails(label) {
  const seasonLabel = clean(label);
  if (!seasonLabel) return null;
  const key = normalizeKey(seasonLabel);
  return {
    seasonLabel,
    seasonKey: key.startsWith('season-') ? key : `season-${key}`
  };
}

function competitionDetails(value) {
  const key = normalize(value);
  const entry = Object.entries(COMPETITIONS).find(([, competition]) =>
    competition.aliases.some(alias => normalize(alias) === key)
  );
  return entry ? { competitionKey: entry[0], ...entry[1] } : null;
}

function hasData(row) {
  return Array.isArray(row) && row.some(value => clean(value) !== '');
}

function tableMap(tables) {
  return new Map(tables.map(table => [normalize(table.name), table]));
}

function sourceRows(tables, name) {
  const table = tableMap(tables).get(normalize(name));
  return table ? (table.rows || []).filter(hasData) : [];
}

function makeStableId(parts) {
  return parts.map(normalizeKey).join('|');
}

function extractDiscordId(value) {
  const text = clean(value);
  const mention = text.match(/<@!?(\d{15,25})>/);
  if (mention) return mention[1];
  const raw = text.match(/\b\d{15,25}\b/);
  return raw ? raw[0] : null;
}

function buildTeamDirectory(rows) {
  const byName = new Map();
  const byShort = new Map();
  const byId = new Map();

  for (const row of rows.filter(hasData)) {
    const shortName = clean(row[0]).toUpperCase();
    const teamKey = clean(row[1]).toUpperCase();
    const name = clean(row[2]);
    const previousName = clean(row[3]);
    const previousShortName = clean(row[4]).toUpperCase();
    if (!teamKey) continue;

    const team = { teamKey, name: name || previousName || shortName, shortName };
    byId.set(normalize(teamKey), team);
    for (const alias of [shortName, previousShortName]) {
      if (alias) byShort.set(normalize(alias), team);
    }
    for (const alias of [name, previousName]) {
      if (alias) byName.set(normalize(alias), team);
    }
  }

  return { byId, byName, byShort };
}

function findTeam(teamDirectory, teamName, teamId = '') {
  return teamDirectory.byId.get(normalize(teamId))
    || teamDirectory.byName.get(normalize(teamName))
    || teamDirectory.byShort.get(normalize(teamName))
    || null;
}

function addSeason(seasons, label) {
  const details = seasonDetails(label);
  if (details && !seasons.has(details.seasonKey)) {
    seasons.set(details.seasonKey, {
      ...details,
      status: 'completed',
      source: 'google_sheets'
    });
  }
  return details;
}

function buildMigrationPayload(tables) {
  const archiveRows = sourceRows(tables, 'Season_Archive');
  const playerRows = sourceRows(tables, 'All_Time_Player_Stats');
  const teamRows = sourceRows(tables, 'All_Time_Team_Stats');
  const awardRows = sourceRows(tables, 'Awards');
  const teamMapRows = tableMap(tables).get('teamidmap')?.rows || [];
  const teamDirectory = buildTeamDirectory(teamMapRows);

  const seasons = new Map();
  const competitions = new Map();
  const teamSeasons = new Map();
  const playerSeasons = new Map();
  const awards = new Map();
  const trophies = new Map();
  const warnings = [];
  const blockingErrors = [];
  const playerIdsByName = new Map();

  for (const row of playerRows) {
    const playerName = clean(row[0]);
    const discordId = extractDiscordId(row[1]);
    if (playerName && discordId) {
      playerIdsByName.set(normalize(playerName), discordId);
      playerIdsByName.set(normalize(playerName.split('-').slice(1).join('-')), discordId);
    }
  }

  function ensureCompetition(season, competition, archivedAt = null) {
    if (!season || !competition) return null;
    addSeason(seasons, season.seasonLabel);
    const competitionId = makeStableId([season.seasonKey, competition.competitionKey]);
    if (!competitions.has(competitionId)) {
      competitions.set(competitionId, {
        competitionId,
        seasonKey: season.seasonKey,
        competitionKey: competition.competitionKey,
        name: competition.name,
        status: 'completed',
        champion: null,
        runnerUp: null,
        archivedAt: dateAt(archivedAt),
        source: 'google_sheets'
      });
    }
    return competitions.get(competitionId);
  }

  for (const row of archiveRows) {
    const season = addSeason(seasons, row[0]);
    const competition = competitionDetails(row[10] || 'Coop / League');
    if (!season || !competition) {
      warnings.push('A Season_Archive row has no usable season or competition label.');
      continue;
    }
    const record = ensureCompetition(season, competition, row[11]);
    const championName = clean(row[1]);
    const runnerUpName = clean(row[2]);
    record.champion = championName
      ? { teamKey: findTeam(teamDirectory, championName)?.teamKey || '', name: championName }
      : null;
    record.runnerUp = runnerUpName
      ? { teamKey: findTeam(teamDirectory, runnerUpName)?.teamKey || '', name: runnerUpName }
      : null;
    record.archivedAt = dateAt(row[11]) || record.archivedAt;
  }

  for (const row of teamRows) {
    const season = addSeason(seasons, row[1]);
    const competition = competitionDetails(row[18] || 'Coop / League');
    const teamName = clean(row[0]);
    if (!season || !competition || !teamName) {
      warnings.push('An All_Time_Team_Stats row has no usable season, competition, or team name.');
      continue;
    }
    ensureCompetition(season, competition, row[19]);
    const team = findTeam(teamDirectory, teamName, row[20] || row[21]);
    const teamKey = team?.teamKey || normalizeKey(teamName);
    const recordId = makeStableId([season.seasonKey, competition.competitionKey, teamKey]);
    const record = {
      recordId,
      seasonKey: season.seasonKey,
      competitionKey: competition.competitionKey,
      teamKey,
      legacyName: teamName,
      shortName: team?.shortName || '',
      stats: {
        matches: numberAt(row, 2),
        wins: numberAt(row, 3),
        draws: numberAt(row, 4),
        losses: numberAt(row, 5),
        goalsFor: numberAt(row, 6),
        goalsAgainst: numberAt(row, 7),
        goalDifference: numberAt(row, 8),
        points: numberAt(row, 9)
      },
      honours: [],
      source: 'google_sheets'
    };

    for (const [index, competitionKey, title, placement] of TEAM_TITLES) {
      if (!numberAt(row, index)) continue;
      record.honours.push({ competitionKey, title, placement });
      const trophyId = makeStableId([
        season.seasonKey, competitionKey, 'team', teamKey, title, placement
      ]);
      trophies.set(trophyId, {
        trophyId,
        seasonKey: season.seasonKey,
        competitionKey,
        recipientType: 'team',
        recipientName: teamName,
        teamKey,
        trophyName: title,
        placement,
        awardedAt: dateAt(row[19]),
        source: 'google_sheets'
      });
    }
    teamSeasons.set(recordId, record);
  }

  for (const row of playerRows) {
    const season = addSeason(seasons, row[3]);
    const competition = competitionDetails(row[29] || 'Coop / League');
    const playerName = clean(row[0]);
    if (!season || !competition || !playerName) {
      warnings.push('An All_Time_Player_Stats row has no usable season, competition, or player name.');
      continue;
    }
    ensureCompetition(season, competition, row[30]);
    const discordId = extractDiscordId(row[1]);
    const team = findTeam(teamDirectory, row[2], row[31] || row[32]);
    const teamKey = team?.teamKey || normalizeKey(row[2] || '');
    const playerKey = discordId
      ? `discord:${discordId}`
      : `legacy:${normalizeKey(playerName)}:${teamKey}`;
    const recordId = makeStableId([
      season.seasonKey, competition.competitionKey, playerKey, teamKey
    ]);
    const record = {
      recordId,
      seasonKey: season.seasonKey,
      competitionKey: competition.competitionKey,
      playerKey,
      discordId,
      legacyName: playerName,
      teamKey,
      legacyTeamName: clean(row[2]),
      stats: {
        matches: numberAt(row, 4),
        wins: numberAt(row, 5),
        draws: numberAt(row, 6),
        losses: numberAt(row, 7),
        goals: numberAt(row, 8),
        assists: numberAt(row, 9),
        goalContributions: numberAt(row, 10),
        mvps: numberAt(row, 11),
        tackles: numberAt(row, 12),
        interceptions: numberAt(row, 13),
        saves: numberAt(row, 14),
        yellowCards: numberAt(row, 15),
        redCards: numberAt(row, 16),
        legacyTrophyCount: numberAt(row, 17),
        cleanSheets: numberAt(row, 28),
        awards: numberAt(row, 26)
      },
      honours: [],
      source: 'google_sheets'
    };

    for (const [index, competitionKey, title, placement] of PLAYER_TITLES) {
      if (!numberAt(row, index)) continue;
      record.honours.push({ competitionKey, title, placement });
      const trophyId = makeStableId([
        season.seasonKey, competitionKey, 'player', playerKey, title, placement
      ]);
      trophies.set(trophyId, {
        trophyId,
        seasonKey: season.seasonKey,
        competitionKey,
        recipientType: 'player',
        playerKey,
        discordId,
        recipientName: playerName,
        teamKey,
        trophyName: title,
        placement,
        awardedAt: dateAt(row[30]),
        source: 'google_sheets'
      });
    }
    playerSeasons.set(recordId, record);
  }

  for (const row of awardRows) {
    const season = addSeason(seasons, row[0]);
    const competition = competitionDetails(row[4] || 'Coop / League');
    const recipientName = clean(row[1]);
    const awardName = clean(row[2]);
    if (!season || !competition || !recipientName || !awardName) {
      warnings.push('An Awards row has no usable season, competition, recipient, or award name.');
      continue;
    }
    ensureCompetition(season, competition, row[5]);
    const team = findTeam(teamDirectory, recipientName);
    const discordId = playerIdsByName.get(normalize(recipientName))
      || playerIdsByName.get(normalize(recipientName.split('-').slice(1).join('-')))
      || null;
    const recipientType = team ? 'team' : discordId ? 'player' : 'legacy';
    const playerKey = discordId
      ? `discord:${discordId}`
      : recipientType === 'legacy'
        ? `legacy:${normalizeKey(recipientName)}`
        : '';
    const awardId = makeStableId([
      season.seasonKey, competition.competitionKey, recipientType,
      discordId || team?.teamKey || recipientName, awardName
    ]);

    if (!awards.has(awardId)) {
      awards.set(awardId, {
        awardId,
        seasonKey: season.seasonKey,
        competitionKey: competition.competitionKey,
        recipientType,
        playerKey,
        discordId,
        recipientName,
        teamKey: team?.teamKey || '',
        awardName,
        value: clean(row[3]) || null,
        awardedAt: dateAt(row[5]),
        source: 'google_sheets'
      });
    }
  }

  if (!archiveRows.length && !playerRows.length && !teamRows.length && !awardRows.length) {
    blockingErrors.push('No historical archive rows were found in the source Sheets.');
  }

  const requiredArchiveTabs = [
    'season_archive',
    'all_time_player_stats',
    'all_time_team_stats',
    'awards'
  ];
  const availableTabs = new Set(tables.map(table => normalize(table.name)));
  const missingArchiveTabs = requiredArchiveTabs.filter(name => !availableTabs.has(name));
  if (missingArchiveTabs.length) {
    blockingErrors.push(`Missing required archive tabs: ${missingArchiveTabs.join(', ')}.`);
  }
  if (warnings.length) {
    blockingErrors.push('Some historical rows could not be normalized; review the warnings before importing.');
  }

  const sourceFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(tables.map(table => [table.name, table.headers, table.rows])))
    .digest('hex');

  return {
    tables,
    seasons: [...seasons.values()],
    competitions: [...competitions.values()],
    teamSeasons: [...teamSeasons.values()],
    playerSeasons: [...playerSeasons.values()],
    awards: [...awards.values()],
    trophies: [...trophies.values()],
    warnings: [...new Set(warnings)],
    blockingErrors,
    sourceFingerprint
  };
}

module.exports = {
  buildMigrationPayload,
  competitionDetails,
  normalizeKey,
  seasonDetails
};
