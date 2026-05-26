const { EmbedBuilder } = require('discord.js');
const { getData, clearCache, clearCacheByPrefixes, registerCacheInvalidator } = require('./sheets');

const sheetCache = new Map();

function cloneSheetValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map(row => (Array.isArray(row) ? [...row] : row));
}

function clearHelperSheetCacheByPrefixes(prefixes = []) {
  const activePrefixes = Array.isArray(prefixes) ? prefixes.filter(Boolean) : [];

  if (!activePrefixes.length) {
    sheetCache.clear();
    return;
  }

  for (const key of [...sheetCache.keys()]) {
    if (activePrefixes.some(prefix => key.startsWith(prefix))) {
      sheetCache.delete(key);
    }
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanId(value) {
  return String(value || '').replace(/[<@!>]/g, '').trim();
}

function parseHexColor(value, fallback = 0x5865F2) {
  const color = String(value || '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return fallback;
  return parseInt(color.replace('#', ''), 16);
}

function getTeamColor(teams = [], teamName, fallback = 0x5865F2) {
  if (!Array.isArray(teams)) return fallback;
  const key = normalize(teamName);
  const row = teams.slice(1).find(r => normalize(r[0]) === key || normalize(r[2]) === key);
  return parseHexColor(row?.[7], fallback);
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function splitPlayers(value) {
  return splitList(value).map(stripTeamPrefix).filter(Boolean);
}

function hasPlayer(listValue, playerName) {
  const target = normalize(stripTeamPrefix(playerName));
  if (!target) return false;
  return splitPlayers(listValue).some(player => normalize(player) === target);
}

function formatList(input) {
  return splitList(input).join(', ');
}

function buildMixedPrefixList(input, homePlayers, awayPlayers, homeShort, awayShort) {
  const names = splitList(input).map(stripTeamPrefix).filter(Boolean);

  const normalizedHomeShort = String(homeShort || '').trim().toUpperCase();
  const normalizedAwayShort = String(awayShort || '').trim().toUpperCase();
  const homeSet = new Set(splitPlayers(homePlayers).map(p => normalize(p)).filter(Boolean));
  const awaySet = new Set(splitPlayers(awayPlayers).map(p => normalize(p)).filter(Boolean));

  return names.map(name => {
    const key = normalize(name);
    if (homeSet.has(key) && normalizedHomeShort) return `${normalizedHomeShort}-${name}`;
    if (awaySet.has(key) && normalizedAwayShort) return `${normalizedAwayShort}-${name}`;
    return name;
  }).join(', ');
}

async function cachedGetData(range, ttlMs = 15000) {
  const now = Date.now();
  const hit = sheetCache.get(range);

  if (hit && now - hit.ts < ttlMs) {
    return cloneSheetValues(hit.data);
  }

  const data = await getData(range, { cache: false });
  const snapshot = cloneSheetValues(data);

  sheetCache.set(range, { data: snapshot, ts: now });
  return cloneSheetValues(snapshot);
}

function invalidateSheetCache(prefixes = []) {
  if (!Array.isArray(prefixes) || !prefixes.length) {
    sheetCache.clear();
    clearCache();
    return;
  }

  clearHelperSheetCacheByPrefixes(prefixes);
  clearCacheByPrefixes(prefixes);
}

registerCacheInvalidator(payload => {
  if (!payload || payload.type === 'all') {
    sheetCache.clear();
    return;
  }

  if (payload.type === 'exact' && payload.range) {
    sheetCache.delete(payload.range);
    return;
  }

  if (payload.type === 'prefixes') {
    clearHelperSheetCacheByPrefixes(payload.prefixes || []);
  }
});

async function sendAuditLog(interaction, payload = {}) {
  const channelId = process.env.DISCORD_AUDIT_LOG_CHANNEL_ID || process.env.AUDIT_LOG_CHANNEL_ID;
  if (!channelId || !interaction?.client) return false;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') return false;

    const actorTag = interaction?.user?.tag || 'Unknown User';
    const actorId = interaction?.user?.id || 'Unknown ID';
    const guildName = interaction?.guild?.name || 'Unknown';
    const extraFields = Array.isArray(payload.fields) ? payload.fields.filter(Boolean) : [];

    const embed = new EmbedBuilder()
      .setTitle(payload.title || '📋 Audit Log')
      .setDescription(payload.description || 'Action logged')
      .setColor(payload.color || 0x5865F2)
      .addFields(
        { name: '👤 By', value: `${actorTag} (${actorId})`, inline: false },
        { name: '🏠 Server', value: guildName, inline: true },
        { name: '🕒 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        ...extraFields
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.error('Audit log send error:', error);
    return false;
  }
}

function getAllowedMatchday(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length <= 1) {
    return null;
  }

  const rows = fixtures.slice(1).filter(r => r && r[0]);
  const grouped = new Map();

  rows.forEach(row => {
    const md = String(row[0] || '').split('.')[0].trim();
    if (!md) return;
    if (!grouped.has(md)) grouped.set(md, []);
    grouped.get(md).push(row);
  });

  for (const [md, matches] of grouped.entries()) {
    const played = matches.filter(r => r[4] !== '' && r[4] !== undefined && r[5] !== '' && r[5] !== undefined);
    const unplayed = matches.filter(r => r[4] === '' || r[4] === undefined || r[5] === '' || r[5] === undefined);

    if (played.length > 0 && unplayed.length > 0) {
      return md;
    }
  }

  for (const [md, matches] of grouped.entries()) {
    const unplayed = matches.filter(r => r[4] === '' || r[4] === undefined || r[5] === '' || r[5] === undefined);
    if (unplayed.length > 0) return md;
  }

  return null;
}

module.exports = {
  normalize,
  cleanId,
  parseHexColor,
  getTeamColor,
  splitList,
  stripTeamPrefix,
  splitPlayers,
  hasPlayer,
  formatList,
  buildMixedPrefixList,
  cachedGetData,
  invalidateSheetCache,
  sendAuditLog,
  getAllowedMatchday
};
