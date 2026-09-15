const { AsyncLocalStorage } = require('node:async_hooks');

const hfContext = new AsyncLocalStorage();

function cleanId(value) {
  return String(value || '').replace(/[<@!>&]/g, '').trim();
}

function cleanList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanId).filter(Boolean))];
}

function pick(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return undefined;
}

function defaultTournament() {
  return {
    sheetId: String(process.env.HF_SHEET_ID || '').trim(),
    leagueName: String(process.env.HF_LEAGUE_NAME || 'HandFootball League').trim(),
    resultRoleIds: cleanList([
      ...String(process.env.HF_RESULT_ROLE_ID || '').split(','),
      ...String(process.env.HF_RESULT_ROLE_IDS || '').split(',')
    ]),
    captainRoleIds: cleanList([
      ...String(process.env.HF_CAPTAIN_ROLE_ID || '').split(','),
      ...String(process.env.HF_CAPTAIN_ROLE_IDS || '').split(',')
    ]),
    playerRoleId: cleanId(process.env.HF_PLAYER_ROLE_ID || process.env.HF_TOURNAMENT_ROLE_ID),
    lockRoleId: cleanId(process.env.HF_LOCK_ROLE_ID || process.env.HF_CHANNEL_LOCK_ROLE_ID),
    fixturesRoleId: cleanId(process.env.HF_FIXTURES_ROLE_ID),
    freeAgentRoleIds: cleanList([
      ...String(process.env.HF_FREE_AGENT_ROLE_ID || '').split(','),
      ...String(process.env.HF_FREE_AGENT_ROLE_IDS || '').split(',')
    ]),
    timezone: String(process.env.HF_TIMEZONE || 'UTC').trim() || 'UTC'
  };
}

function parseTournamentMap() {
  const raw = String(process.env.HF_TOURNAMENTS || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('HF_TOURNAMENTS must be valid JSON.');
  }

  const entries = Array.isArray(parsed)
    ? parsed.map(item => [item?.guildId || item?.serverId, item])
    : Object.entries(parsed || {});
  const map = new Map();
  for (const [guildId, config] of entries) {
    const id = cleanId(guildId);
    if (id && config && typeof config === 'object') map.set(id, config);
  }
  return map;
}

function normalizeTournament(guildId, input = {}) {
  const defaults = defaultTournament();
  const resultRoles = pick(input, 'resultRoleIds', 'refereeRoleIds', 'resultRoleId', 'refereeRoleId');
  const captainRoles = pick(input, 'captainRoleIds', 'captainRoleId');
  const freeAgentRoles = pick(input, 'freeAgentRoleIds', 'freeAgentRoleId', 'playerRoleIds', 'playerRoleId');

  return {
    guildId: cleanId(guildId),
    sheetId: String(pick(input, 'sheetId', 'spreadsheetId', 'hfSheetId') ?? defaults.sheetId).trim(),
    leagueName: String(pick(input, 'leagueName', 'name') ?? defaults.leagueName).trim() || 'HandFootball League',
    resultRoleIds: resultRoles === undefined ? defaults.resultRoleIds : cleanList(resultRoles),
    captainRoleIds: captainRoles === undefined ? defaults.captainRoleIds : cleanList(captainRoles),
    playerRoleId: cleanId(pick(input, 'playerRoleId', 'hfPlayerRoleId', 'tournamentRoleId', 'hfPlayerId') ?? defaults.playerRoleId),
    lockRoleId: cleanId(pick(input, 'lockRoleId', 'hfLockId', 'channelLockRoleId') ?? defaults.lockRoleId),
    fixturesRoleId: cleanId(pick(input, 'fixturesRoleId', 'fixtureRoleId', 'hfFixtureRoleId') ?? defaults.fixturesRoleId),
    freeAgentRoleIds: freeAgentRoles === undefined ? defaults.freeAgentRoleIds : cleanList(freeAgentRoles),
    timezone: String(pick(input, 'timezone', 'hfTimezone') ?? defaults.timezone).trim() || 'UTC'
  };
}

function getTournament(guildOrId) {
  const guildId = cleanId(typeof guildOrId === 'object' ? guildOrId?.id : guildOrId) || hfContext.getStore()?.guildId || '';
  const tournamentMap = parseTournamentMap();

  if (tournamentMap) {
    const config = tournamentMap.get(guildId);
    if (!config) {
      throw new Error(`HandFootball is not configured for this server (${guildId || 'unknown guild'}).`);
    }
    return normalizeTournament(guildId, config);
  }

  return normalizeTournament(guildId, {});
}

function runWithHFTournament(guildOrId, callback) {
  const tournament = getTournament(guildOrId);
  return hfContext.run(tournament, callback);
}

function getActiveHFTournament() {
  return hfContext.getStore() || getTournament();
}

function getHFStatsScope(guildOrId) {
  return { guildId: getTournament(guildOrId).guildId };
}

function getLegacyStatsMigrationGuildId() {
  const tournamentMap = parseTournamentMap();
  if (!tournamentMap) return '';

  const matches = [...tournamentMap.entries()]
    .filter(([, config]) => config?.migrateLegacyStats === true)
    .map(([guildId]) => guildId);

  if (matches.length > 1) {
    throw new Error('Only one HF_TOURNAMENTS server may set migrateLegacyStats to true.');
  }

  return matches[0] || '';
}

module.exports = {
  cleanId,
  cleanList,
  getTournament,
  getActiveHFTournament,
  getHFStatsScope,
  getLegacyStatsMigrationGuildId,
  runWithHFTournament
};
