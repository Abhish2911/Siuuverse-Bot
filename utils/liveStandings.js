const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const E = require('./emojis');
const { getData } = require('./sheets');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'liveStandings.json');

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();

  if (value === 'ucl') return 'ucl';
  if (value === 'league') return 'league';
  if (value === 'coop_league') return 'league';

  return 'league';
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

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function buildStandingsSummary(rows) {
  const leader = rows[0];
  const second = rows[1];
  const third = rows[2];
  const bottom = rows[rows.length - 1];

  const formatTeamLine = row => {
    if (!row) return 'N/A';
    return `\`${clean(row[1])}\` • ${row[9] || 0} pts`;
  };

  return {
    teams: rows.length,
    leader: formatTeamLine(leader),
    second: formatTeamLine(second),
    third: formatTeamLine(third),
    bottom: formatTeamLine(bottom)
  };
}

function buildStandingsDescription(summary) {
  return (
    `${safeEmoji(E.trophy_animated, E.PL || '🏆')} **League Table Overview**\n` +
    `Current coop league standings sorted by points, goal difference and goals scored.\n\n` +
    `${safeEmoji(E.team, '👥')} **Teams:** ${summary.teams}\n` +
    `${safeEmoji(E.winner, '👑')} **Leader:** ${summary.leader}\n` +
    `${safeEmoji(E.runnerUp, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}\n` +
    `🔻 **Bottom:** ${summary.bottom}`
  );
}

function rankIcon(index, total, isUcl = false) {
  if (index === 0) return '👑';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';

  if (isUcl) {
    if (index === total - 3) return '▫️';
  } else {
    if (index >= total - 3) return '🔻';
  }

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

function saveLiveStandingsConfig(guildId, config, type = 'league') {
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

function getLiveStandingsConfig(guildId, type = 'league') {
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
  if (!legacyConfig.type || legacyConfig.type === 'coop_league') {
    legacyConfig.type = 'league';
  }

  if (normalizedType && legacyConfig.type !== normalizedType) return null;
  return legacyConfig;
}

function readLiveStandingsConfig(guildId, type = 'league') {
  return getLiveStandingsConfig(guildId, type);
}

async function buildLiveStandingsEmbed(type = 'league') {
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
          ? `${E.UCL || '🏆'} UCL Group Standings`
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
          ? `${E.UCL || '🏆'} UCL Group Standings`
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

      if (sorted[0]) qualifiedTeams.add(clean(sorted[0][2]));
      if (sorted[1]) qualifiedTeams.add(clean(sorted[1][2]));

      if (sorted[2]) {
        thirdPlaced.push({
          teamName: clean(sorted[2][2]),
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
      .forEach(team => qualifiedTeams.add(team.teamName));
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
          const line = `${rankIcon(i, groupRows.length, true)} ${pos} ${tm} ${p} ${w} ${d} ${l} ${gd} ${pts}`;

          return qualifiedTeams.has(clean(r?.[2]))
            ? `+ ${line}`
            : `  ${line}`;
        }).join('\n');

        return `**Group ${group}**\n\`\`\`diff\n  📈  # TEAM    P  W  D  L   GD  PTS\n${lines}\n\`\`\``;
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
      if (i >= rows.length - 3) return `- ${line}`;
      return `  ${line}`;
    }).join('\n');
  }

  const header = normalizedType === 'ucl'
    ? '  📈  # TEAM    P  W  D  L   GD  PTS'
    : '  📈  # TEAM    P  W  D  L   GD  PTS';

  if (normalizedType === 'ucl') {
    return new EmbedBuilder()
      .setTitle(`${E.UCL || '🏆'} UCL Group Standings`)
      .setDescription(
        `${E.goal || '⚽'} UCL Group Stage Standings\n\n${E.winner || '👑'} Group Winners qualify automatically\n${E.runnerUp || '🥈'} Group Runner-ups qualify automatically\n${E.correct || '✅'} Best 2 third-place teams qualify\n\n${table}`
      )
      .addFields({
        name: `${E.correct || '✅'} Qualification`,
        value: `${E.correct || '✅'} Qualified Teams: **${qualifiedTeams.size}**\n${E.winner || '👑'} Group Winners • ${E.runnerUp || '🥈'} Group Runner-ups • ${E.correct || '✅'} Best 2 Third-Place Teams`,
        inline: false
      })
      .setColor(0x5865F2)
      .setFooter({
        text: 'UCL Group Standings • 👑 Group Winner • 🥈 Runner-up • ✅ Qualified'
      })
      .setTimestamp();
  }

  const summary = buildStandingsSummary(rows);
  const bottomZone = rows
    .slice(-3)
    .map(row => clean(row?.[1]))
    .filter(Boolean)
    .join('\n') || 'N/A';

  return new EmbedBuilder()
    .setTitle(`${safeEmoji(E.trophy_animated, E.PL || '🏆')} Coop League Table`)
    .setDescription(buildStandingsDescription(summary))
    .addFields(
      {
        name: `${safeEmoji(E.stats || E.rank, '📊')} Table`,
        value: `\`\`\`diff\n${header}\n${table}\n\`\`\``,
        inline: false
      },
      {
        name: '🔻 Bottom Zone',
        value: bottomZone,
        inline: false
      }
    )
    .setColor(0x5865F2)
    .setFooter({
      text: 'Coop league standings • 👑 Leader • 🥈 2nd • 🥉 3rd • 🔻 Bottom 3'
    })
    .setTimestamp();
}

async function refreshLiveStandings(client, guildId, type = 'league') {
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

function startLiveStandingsUpdater(client, guildId, type = 'league') {
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
