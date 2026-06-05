const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getData } = require('./sheets');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'liveStandings.json');

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();

  if (value === 'ucl') return 'ucl';
  if (value === 'league') return 'coop_league';
  if (value === 'coop_league') return 'coop_league';

  return 'coop_league';
}

function normalizeTeamKey(value) {
  return String(value || '').trim().toLowerCase();
}

function clean(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const num = Number(String(value ?? '').replace('+', '').trim());
  return Number.isFinite(num) ? num : 0;
}

function formatGD(value) {
  const num = toNumber(value);
  return num > 0 ? `+${num}` : String(num);
}

function rankIcon(index, total) {
  if (index === 0) return '👑';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  if (index >= total - 2) return '🔻';
  return '▫️';
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({}, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Live standings store read error:', error);
    return {};
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data || {}, null, 2));
}

function saveLiveStandingsConfig(guildId, config, type = 'coop_league') {
  const normalizedType = normalizeType(type);
  const key = String(guildId || '').trim();
  if (!key) return false;

  const store = readStore();
  const existing = store[key];

  if (!existing || !existing.types) {
    const legacyConfig = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing }
      : null;

    store[key] = {
      types: {
        ...(legacyConfig?.channelId && legacyConfig?.messageId
          ? { [normalizeType(legacyConfig.type)]: { ...legacyConfig, type: normalizeType(legacyConfig.type) } }
          : {}),
        [normalizedType]: { ...config, type: normalizedType }
      }
    };
  } else {
    store[key].types[normalizedType] = {
      ...config,
      type: normalizedType
    };
  }

  writeStore(store);
  return true;
}

function getLiveStandingsConfig(guildId, type = 'coop_league') {
  const normalizedType = normalizeType(type);
  const key = String(guildId || '').trim();
  if (!key) return null;

  const store = readStore();
  const entry = store[key] || null;
  if (!entry) return null;

  if (entry.types && typeof entry.types === 'object') {
    const config = entry.types[normalizedType] || null;
    if (!config) return null;

    return {
      ...config,
      type: normalizedType
    };
  }

  const legacyConfig = { ...entry };
  if (!legacyConfig.type || legacyConfig.type === 'league') {
    legacyConfig.type = 'coop_league';
  }

  if (normalizedType && legacyConfig.type !== normalizedType) return null;
  return legacyConfig;
}

function readLiveStandingsConfig(guildId, type = 'coop_league') {
  return getLiveStandingsConfig(guildId, type);
}

async function buildLiveStandingsEmbed(type = 'coop_league') {
  const normalizedType = normalizeType(type);
  const standingsSheet = normalizedType === 'ucl'
    ? 'UCL_Coop_Group_Standings!A:K'
    : 'Standings!A:J';

  const standings = await getData(standingsSheet);
  const teams = await getData('Teams!A:H');

  if (!Array.isArray(standings) || standings.length <= 1) {
    return new EmbedBuilder()
      .setTitle(
        normalizedType === 'ucl'
          ? '🏆 UCL Live Standings'
          : '🏆 COOP Live Standings'
      )
      .setDescription('```ini\nNo standings data found.\n```')
      .setColor(0x5865F2)
      .setFooter({ text: 'Live Standings • No standings data available' });
  }

  const shortMap = {};
  if (Array.isArray(teams) && teams.length > 1) {
    teams.slice(1).forEach(row => {
      const teamName = row?.[0];
      const shortName = row?.[2];
      if (teamName && shortName) {
        shortMap[normalizeTeamKey(teamName)] = String(shortName).trim().toUpperCase();
      }
    });
  }

  let rows;

  if (normalizedType === 'ucl') {
    rows = standings
      .slice(1)
      .filter(r => {
        const team = String(r?.[2] || '').trim();
        if (!team) return false;
        if (/removed|delete|blank|tbd/i.test(team)) return false;
        return true;
      })
      .sort((a, b) =>
        toNumber(b?.[10]) - toNumber(a?.[10]) ||
        toNumber(b?.[9]) - toNumber(a?.[9]) ||
        toNumber(b?.[7]) - toNumber(a?.[7])
      );
  } else {
    rows = standings
      .slice(1)
      .filter(r => {
        const team = String(r?.[1] || '').trim();
        if (!team) return false;
        if (/removed|delete|blank|tbd/i.test(team)) return false;
        return true;
      })
      .sort((a, b) =>
        toNumber(b?.[9]) - toNumber(a?.[9]) ||
        toNumber(b?.[8]) - toNumber(a?.[8]) ||
        toNumber(b?.[6]) - toNumber(a?.[6]) ||
        String(a?.[1] || '').localeCompare(String(b?.[1] || ''))
      );
  }

  if (!rows.length) {
    return new EmbedBuilder()
      .setTitle(
        normalizedType === 'ucl'
          ? '🏆 UCL Live Standings'
          : '🏆 COOP Live Standings'
      )
      .setDescription('```ini\nNo valid standings rows found.\n```')
      .setColor(0x5865F2)
      .setFooter({ text: 'Live Standings • No valid teams found' });
  }

  const pad = (value, len, dir = 'end') => {
    const str = String(value ?? '');
    return dir === 'start' ? str.padStart(len, ' ') : str.padEnd(len, ' ');
  };

  let qualifiedTeams = new Set();

  if (normalizedType === 'ucl') {
    const groups = {};

    rows.forEach(row => {
      const group = clean(row?.[0]).toUpperCase();
      if (!groups[group]) groups[group] = [];
      groups[group].push(row);
    });

    const thirdPlaced = [];

    Object.values(groups).forEach(groupRows => {
      const sorted = [...groupRows].sort((a, b) =>
        toNumber(b?.[10]) - toNumber(a?.[10]) ||
        toNumber(b?.[9]) - toNumber(a?.[9]) ||
        toNumber(b?.[7]) - toNumber(a?.[7])
      );

      if (sorted[0]) qualifiedTeams.add(clean(sorted[0][1]));
      if (sorted[1]) qualifiedTeams.add(clean(sorted[1][1]));

      if (sorted[2]) {
        thirdPlaced.push({
          shortName: clean(sorted[2][1]),
          pts: toNumber(sorted[2][10]),
          gd: toNumber(sorted[2][9]),
          gf: toNumber(sorted[2][7])
        });
      }
    });

    thirdPlaced
      .sort((a, b) =>
        b.pts - a.pts ||
        b.gd - a.gd ||
        b.gf - a.gf
      )
      .slice(0, 2)
      .forEach(team => qualifiedTeams.add(team.shortName));
  }

  let table;

  if (normalizedType === 'ucl') {
    const groups = {};

    rows.forEach(row => {
      const group = clean(row?.[0]).toUpperCase();
      if (!groups[group]) groups[group] = [];
      groups[group].push(row);
    });

    table = Object.keys(groups)
      .sort()
      .map(group => {
        const groupRows = groups[group].sort((a, b) =>
          toNumber(b?.[10]) - toNumber(a?.[10]) ||
          toNumber(b?.[9]) - toNumber(a?.[9]) ||
          toNumber(b?.[7]) - toNumber(a?.[7])
        );

        const lines = groupRows.map((r, i) => {
          const pos = pad(i + 1, 2, 'start');
          const fullTeam = normalizeTeamKey(r?.[2]);
          const tm = pad(shortMap[fullTeam] || String(r?.[1] || '').slice(0, 6).toUpperCase(), 6);
          const p = pad(toNumber(r?.[3]), 2, 'start');
          const w = pad(toNumber(r?.[4]), 2, 'start');
          const d = pad(toNumber(r?.[5]), 2, 'start');
          const l = pad(toNumber(r?.[6]), 2, 'start');
          const gd = pad(formatGD(r?.[9]), 4, 'start');
          const pts = pad(toNumber(r?.[10]), 3, 'start');
          const line = `${rankIcon(i, groupRows.length)} ${pos} ${tm} ${p} ${w} ${d} ${l} ${gd} ${pts}`;

          return qualifiedTeams.has(clean(r?.[1]))
            ? `+ ${line}`
            : `  ${line}`;
        }).join('\n');

        return `**Group ${group}**\n\`\`\`diff\n      # TEAM    P  W  D  L   GD  PTS\n${lines}\n\`\`\``;
      })
      .join('\n\n');
  } else {
    table = rows.map((r, i) => {
      const pos = pad(i + 1, 2, 'start');
      const fullTeam = normalizeTeamKey(r?.[1]);
      const tm = pad(shortMap[fullTeam] || String(r?.[1] || '').slice(0, 6).toUpperCase() || 'N/A', 6);
      const p = pad(toNumber(r?.[2]), 2, 'start');
      const w = pad(toNumber(r?.[3]), 2, 'start');
      const d = pad(toNumber(r?.[4]), 2, 'start');
      const l = pad(toNumber(r?.[5]), 2, 'start');
      const gd = pad(formatGD(r?.[8]), 4, 'start');
      const pts = pad(toNumber(r?.[9]), 3, 'start');
      const line = `${rankIcon(i, rows.length)} ${pos} ${tm} ${p} ${w} ${d} ${l} ${gd} ${pts}`;

      if (i < 3) return `+ ${line}`;
      if (i >= rows.length - 2) return `- ${line}`;
      return `  ${line}`;
    }).join('\n');
  }

  const header = normalizedType === 'ucl'
    ? '      # TEAM    P  W  D  L   GD  PTS'
    : '      # TEAM    P  W  D  L   GD  PTS';
  const leaderName = clean(normalizedType === 'ucl' ? rows[0]?.[2] : rows[0]?.[1]) || 'N/A';
  const leaderPts = toNumber(normalizedType === 'ucl' ? rows[0]?.[10] : rows[0]?.[9]);
  const bottomZone = rows.slice(-2).map(row => clean(normalizedType === 'ucl' ? row?.[2] : row?.[1])).filter(Boolean).join('\n') || 'N/A';
  const boardLabel = normalizedType === 'ucl'
    ? 'UCL auto-updated board'
    : 'COOP auto-updated board';

  return new EmbedBuilder()
    .setTitle(
      normalizedType === 'ucl'
        ? '🏆 UCL Live Standings'
        : '🏆 COOP Live Standings'
    )
    .setDescription(
      normalizedType === 'ucl'
        ? table
        : `\`\`\`diff\n${header}\n${table}\n\`\`\``
    )
    .addFields(
      { name: '👥 Teams', value: String(rows.length), inline: true },
      { name: '👑 Leader', value: `${leaderName}\n**${leaderPts} pts**`, inline: true },
      { name: '🔻 Bottom Zone', value: bottomZone, inline: true }
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Live Standings • 👑 Leader • 🥈 2nd • 🥉 3rd • 🔻 Bottom 2 • ${boardLabel}` })
    .setTimestamp();
}

async function refreshLiveStandings(client, guildId, type = 'coop_league') {
  const normalizedType = normalizeType(type);
  const config = getLiveStandingsConfig(guildId, normalizedType);
  if (config && normalizeType(config.type) !== normalizedType) {
    return {
      ok: false,
      reason: `Type mismatch. Expected ${normalizedType}, got ${config.type}`
    };
  }
  if (!config) {
    return {
      ok: false,
      reason: 'No live standings configured. Run /setlivestandings first.'
    };
  }

  try {
    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return { ok: false, reason: 'Saved channel not found or bot cannot access it' };
    }

    const message = await channel.messages.fetch(config.messageId).catch(() => null);
    if (!message) {
      return { ok: false, reason: 'Saved standings message not found' };
    }

    const embed = await buildLiveStandingsEmbed(normalizedType);
    await message.edit({ embeds: [embed] });

    return { ok: true, reason: 'Live standings refreshed successfully' };
  } catch (error) {
    console.error('Live standings refresh error:', error);
    return { ok: false, reason: error?.message || 'Unknown live standings refresh error' };
  }
}

function startLiveStandingsUpdater(client, guildId, type = 'coop_league') {
  const normalizedType = normalizeType(type);
  const config = getLiveStandingsConfig(guildId, normalizedType);

  if (config && normalizeType(config.type) !== normalizedType) {
    return false;
  }

  if (!config) {
    return false;
  }

  if (!client.liveStandingsIntervals) {
    client.liveStandingsIntervals = new Map();
  }

  const intervalKey = `${guildId}:${normalizedType}`;
  const existingInterval = client.liveStandingsIntervals.get(intervalKey);
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  refreshLiveStandings(client, guildId, normalizedType).catch(error => {
    console.error('❌ Live standings initial refresh error:', error);
  });

  const interval = setInterval(() => {
    refreshLiveStandings(client, guildId, normalizedType).catch(error => {
      console.error('❌ Live standings auto refresh error:', error);
    });
  }, 60 * 1000);

  client.liveStandingsIntervals.set(intervalKey, interval);
  return true;
}

module.exports = {
  saveLiveStandingsConfig,
  getLiveStandingsConfig,
  readLiveStandingsConfig,
  buildLiveStandingsEmbed,
  refreshLiveStandings,
  startLiveStandingsUpdater
};
