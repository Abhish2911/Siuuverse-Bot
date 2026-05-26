// utils/statsHelper.js

const { registerCacheInvalidator } = require('./sheets');

let playerStatCache = new WeakMap();
let teamPlayersCache = new WeakMap();
let teamShortCache = new WeakMap();

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function safeRows(dataset, skipHeader = true) {
  if (!Array.isArray(dataset)) return [];
  const rows = skipHeader ? dataset.slice(1) : dataset;
  return rows.filter(row => Array.isArray(row));
}

function findTeamRow(teams, teamName) {
  const key = normalize(teamName);
  if (!key || !Array.isArray(teams)) return null;

  return teams.find(team =>
    normalize(team?.[0]) === key ||
    normalize(team?.[2]) === key
  ) || null;
}

function getDatasetCache(store, dataset) {
  if (!Array.isArray(dataset)) {
    return null;
  }

  let scopedCache = store.get(dataset);
  if (!scopedCache) {
    scopedCache = new Map();
    store.set(dataset, scopedCache);
  }

  return scopedCache;
}

function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function splitPlayerNames(value) {
  if (Array.isArray(value)) {
    return value.map(name => stripTeamPrefix(name).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(name => stripTeamPrefix(name).trim())
    .filter(Boolean);
}

// 📊 get player stat
function getPlayerStat(data, name) {
  const scopedCache = getDatasetCache(playerStatCache, data);
  const cacheKey = normalize(name);

  if (!cacheKey) {
    return { value: 0, rank: '-' };
  }

  if (scopedCache?.has(cacheKey)) {
    return scopedCache.get(cacheKey);
  }

  const rows = safeRows(data).filter(r => r[0] && r[1] !== undefined && r[1] !== '');
  const normalizedName = normalize(name);

  const index = rows.findIndex(r => {
    const players = splitPlayerNames(r[0]);
    return players.some(player => normalize(player) === normalizedName);
  });

  const result = index === -1
    ? { value: 0, rank: '-' }
    : {
        value: safeNumber(rows[index][1]),
        rank: index + 1
      };

  scopedCache?.set(cacheKey, result);
  return result;
}

// 👥 get team players
function getTeamPlayers(teams, teamName) {
  const scopedCache = getDatasetCache(teamPlayersCache, teams);
  const cacheKey = normalize(teamName);

  if (!cacheKey) return [];

  if (scopedCache?.has(cacheKey)) {
    return [...scopedCache.get(cacheKey)];
  }

  const team = findTeamRow(teams, teamName);

  const result = !team
    ? []
    : String(team[1] || '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

  scopedCache?.set(cacheKey, result);
  return [...result];
}

// 🏟️ get team short name
function getTeamShort(teams, teamName) {
  const scopedCache = getDatasetCache(teamShortCache, teams);
  const cacheKey = normalize(teamName);

  if (!cacheKey) return null;

  if (scopedCache?.has(cacheKey)) {
    return scopedCache.get(cacheKey);
  }

  const team = findTeamRow(teams, teamName);
  const result = team ? String(team[2] || '').trim().toUpperCase() : null;

  scopedCache?.set(cacheKey, result);
  return result;
}

// 🔢 sum stats for team
function sumStatsByPlayers(data, players) {
  if (!Array.isArray(data) || !Array.isArray(players) || !players.length) {
    return 0;
  }

  const playerSet = new Set(
    players
      .flatMap(player => splitPlayerNames(player))
      .map(player => normalize(player))
      .filter(Boolean)
  );

  if (!playerSet.size) return 0;

  let total = 0;

  for (const row of safeRows(data)) {
    const rowPlayers = splitPlayerNames(row[0]).map(player => normalize(player));

    if (rowPlayers.some(player => playerSet.has(player))) {
      total += safeNumber(row[1]);
    }
  }

  return total;
}

// 🟨🟥 cards using prefix
function sumStatsByPrefix(data, shortName) {
  const normalizedShort = String(shortName || '').trim().toLowerCase();

  if (!Array.isArray(data) || !normalizedShort) {
    return 0;
  }

  let total = 0;
  const prefix = `${normalizedShort}-`;

  for (const row of safeRows(data)) {
    const players = String(row[0] || '')
      .split(',')
      .map(player => normalize(player.trim()))
      .filter(Boolean);

    if (players.some(player => player.startsWith(prefix))) {
      total += safeNumber(row[1]);
    }
  }

  return total;
}

function clearStatsHelperCache() {
  playerStatCache = new WeakMap();
  teamPlayersCache = new WeakMap();
  teamShortCache = new WeakMap();
}

registerCacheInvalidator(() => {
  clearStatsHelperCache();
});

module.exports = {
  getPlayerStat,
  stripTeamPrefix,
  splitPlayerNames,
  getTeamPlayers,
  getTeamShort,
  sumStatsByPlayers,
  sumStatsByPrefix,
  clearStatsHelperCache
};
