const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
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

function getAllPlayerIds(teamRow) {
  const ids = new Set();

  const captain = cleanId(teamRow?.[4]);
  if (captain) ids.add(captain);

  String(teamRow?.[5] || '')
    .split(',')
    .map(id => cleanId(id))
    .filter(Boolean)
    .forEach(id => ids.add(id));

  return [...ids];
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

function getAuditLogChannelId(interaction) {
  const guildId = String(interaction?.guild?.id || '').trim();
  const mappedChannels = String(process.env.AUDIT_LOG_CHANNELS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  for (const item of mappedChannels) {
    const [mappedGuildId, mappedChannelId] = item.split(':').map(value => String(value || '').trim());

    if (mappedGuildId && mappedChannelId && mappedGuildId === guildId) {
      return mappedChannelId;
    }
  }

  return process.env.DISCORD_AUDIT_LOG_CHANNEL_ID || process.env.AUDIT_LOG_CHANNEL_ID || '';
}

async function sendAuditLog(interaction, payload = {}) {
  const channelId = getAuditLogChannelId(interaction);
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

function getFixtureMatchday(matchNo) {
  const id = String(matchNo || '').trim().toUpperCase();

  // League: L-1-1 -> L-1
  const league = id.match(/^L-(\d+)-\d+$/);
  if (league) {
    return `L-${league[1]}`;
  }

  // FA Cup: FA-R1-1 -> FA-R1
  const fa = id.match(/^FA-(.+?)-\d+$/);
  if (fa) {
    return `FA-${fa[1]}`;
  }

  // Carabao Cup: CB-R1-1 -> CB-R1
  const carabao = id.match(/^CB-(.+?)-\d+$/);
  if (carabao) {
    return `CB-${carabao[1]}`;
  }

  // UCL Group Stage: UCL-GS-A-1-1 -> UCL-GS-1
  const uclGroup = id.match(/^UCL-GS-[A-H]-(\d+)-\d+$/);
  if (uclGroup) {
    return `UCL-GS-${uclGroup[1]}`;
  }

  // UCL Knockout: UCL-R16-1 -> UCL-R16
  const uclKnockout = id.match(/^UCL-(R16|QF|SF|F)-\d+$/);
  if (uclKnockout) {
    return `UCL-${uclKnockout[1]}`;
  }

  return id;
}

function getAllowedMatchday() {
  return null;
}

function getCompetitionConfig(matchNo) {
  const id = String(matchNo || '').trim().toUpperCase();

  if (id.startsWith('L-')) {
    return {
      key: 'league',
      label: 'League',
      fixturesRange: 'Fixtures!A:I',
      resultsRange: 'Matches_Entry!A:S'
    };
  }

  if (id.startsWith('FA-')) {
    return {
      key: 'fa',
      label: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      resultsRange: 'FA_Cup_Coop_Results!A:S'
    };
  }

  if (id.startsWith('CB-')) {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      resultsRange: 'Carabao_Coop_Results!A:S'
    };
  }

  if (id.startsWith('UCL-GS-')) {
    return {
      key: 'ucl',
      label: 'UCL Group Stage',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      resultsRange: 'UCL_Coop_Results!A:S'
    };
  }

  if (
    id.startsWith('UCL-R16-') ||
    id.startsWith('UCL-QF-') ||
    id.startsWith('UCL-SF-') ||
    id.startsWith('UCL-F-')
  ) {
    return {
      key: 'ucl',
      label: 'UCL Knockout',
      fixturesRange: 'UCL_Coop_Knockout_Fixtures!A:L',
      resultsRange: 'UCL_Coop_Results!A:S'
    };
  }

  return null;
}

function createPaginationButtons({
  prefix,
  page,
  totalPages,
  targetType,
  targetValue,
  ownerId
}) {
  const encodedType = encodeURIComponent(targetType || 'self');
  const encodedValue = encodeURIComponent(targetValue || '');

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev_${page}_${encodedType}_${encodedValue}_${ownerId}`)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId(`${prefix}_refresh_${page}_${encodedType}_${encodedValue}_${ownerId}`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`${prefix}_next_${page}_${encodedType}_${encodedValue}_${ownerId}`)
      .setLabel('Next')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

function createCompetitionDropdown({
  prefix,
  selectedCompetition,
  targetType,
  targetValue,
  ownerId
}) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        `${prefix}_comp_${targetType}_${targetValue}_${ownerId}`
      )
      .setPlaceholder('Select Competition')
      .addOptions([
        {
          label: 'League',
          value: 'league',
          default: selectedCompetition === 'league'
        },
        {
          label: 'FA Cup',
          value: 'fa',
          default: selectedCompetition === 'fa'
        },
        {
          label: 'Carabao Cup',
          value: 'carabao',
          default: selectedCompetition === 'carabao'
        },
        {
          label: 'UCL',
          value: 'ucl',
          default: selectedCompetition === 'ucl'
        }
      ])
  );
}

function safeEmoji(customEmoji, fallback = '') {
  return customEmoji || fallback;
}

module.exports = {
  normalize,
  cleanId,
  getAllPlayerIds,
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
  getAuditLogChannelId,
  sendAuditLog,
  getFixtureMatchday,
  getAllowedMatchday,
  getCompetitionConfig,
  createPaginationButtons,
  createCompetitionDropdown,
  safeEmoji,
};
