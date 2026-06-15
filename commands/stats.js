const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

const STAT_DEFS = {
  goals: {
    title: `${safeEmoji(E.goldenBoot, '👟')} Golden Boot`,
    color: 0xF1C40F,
    valueLabel: 'Goals',
    icon: '⚽',
    columns: 'A:C'
  },
  assists: {
    title: `${safeEmoji(E.playmaker, '🎯')} Playmakers`,
    color: 0x3498DB,
    valueLabel: 'Assists',
    icon: '🎯',
    columns: 'D:F'
  },
  yellow: {
    title: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`,
    color: 0xF39C12,
    valueLabel: 'Cards',
    icon: '🟨',
    columns: 'G:I'
  },
  red: {
    title: `${safeEmoji(E.redCard, '🟥')} Red Cards`,
    color: 0xE74C3C,
    valueLabel: 'Cards',
    icon: '🟥',
    columns: 'J:L'
  },
  mvp: {
    title: `${safeEmoji(E.mvp, '⭐')} MVP Rankings`,
    color: 0x9B59B6,
    valueLabel: 'MVP',
    icon: '⭐',
    columns: 'M:O'
  },
  ga: {
    title: `${safeEmoji(E.fire, '🔥')} Goal Contributions`,
    color: 0xE67E22,
    valueLabel: 'G+A',
    icon: '🔥',
    columns: 'P:R'
  },
  tackles: {
    title: `${safeEmoji(E.tackle, '🛡️')} Tackles`,
    color: 0x3498DB,
    valueLabel: 'Tackles',
    icon: '🛡️',
    columns: 'S:U'
  },
  interceptions: {
    title: `${safeEmoji(E.interception, '✂️')} Interceptions`,
    color: 0x9B59B6,
    valueLabel: 'INT',
    icon: '✂️',
    columns: 'V:X'
  },
  saves: {
    title: `${safeEmoji(E.save, '🧤')} Saves`,
    color: 0x2ECC71,
    valueLabel: 'Saves',
    icon: '🧤',
    columns: 'Y:AA'
  }
};

function getCompetitionConfig(key) {
  const normalized = String(key || 'league').trim().toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      rankingSheet: 'FA_Cup_Coop_Ranking'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      rankingSheet: 'Carabao_Coop_Ranking'
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      rankingSheet: 'UCL_Coop_Ranking'
    };
  }

  return {
    key: 'league',
    label: 'League',
    rankingSheet: 'Ranking'
  };
}

function getStatConfig(type, competitionKey = 'league') {
  const stat = STAT_DEFS[type] || STAT_DEFS.goals;
  const competition = getCompetitionConfig(competitionKey);

  return {
    ...stat,
    competition,
    range: `${competition.rankingSheet}!${stat.columns}`
  };
}

function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripPrefix(name) {
  const text = String(name || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function formatPlayerWithTag(name) {
  const text = String(name || '').trim();
  if (!text) return 'Unknown';

  if (!text.includes('-')) {
    return text;
  }

  const [tag, ...rest] = text.split('-');
  const player = rest.join('-').trim();
  const cleanTag = tag.trim().toUpperCase();

  if (!player) {
    return text;
  }

  return `\`${cleanTag}\` **${player}**`;
}

async function findMemberMention(interaction, rawName, discordIdMap = new Map()) {
  const playerName = stripPrefix(rawName);
  const target = normalize(playerName);
  const rawTarget = normalize(rawName);
  const mappedId = discordIdMap.get(target) || discordIdMap.get(rawTarget);

  if (mappedId) {
    return `<@${mappedId}>`;
  }

  if (!target || !interaction?.guild?.members) {
    return playerName || 'Unknown';
  }

  const cachedMember = interaction.guild.members.cache.find(m => {
    return (
      normalize(m.user?.username) === target ||
      normalize(m.user?.globalName) === target ||
      normalize(m.displayName) === target ||
      normalize(m.nickname) === target
    );
  });

  if (cachedMember) {
    return `<@${cachedMember.id}>`;
  }

  try {
    const searchedMembers = await interaction.guild.members.fetch({
      query: playerName,
      limit: 10
    });

    const searchedMember = searchedMembers.find(m => {
      return (
        normalize(m.user?.username) === target ||
        normalize(m.user?.globalName) === target ||
        normalize(m.displayName) === target ||
        normalize(m.nickname) === target ||
        normalize(m.user?.username).includes(target) ||
        normalize(m.displayName).includes(target)
      );
    });

    if (searchedMember) {
      return `<@${searchedMember.id}>`;
    }
  } catch (error) {
    console.warn(`⚠️ Could not search Discord member for ${playerName}:`, error.message);
  }

  return playerName || 'Unknown';
}

function cleanTitle(title) {
  return String(title || '').replace(/<a?:\w+:\d+>/g, '').trim();
}

function getViewerNames(interaction) {
  return new Set([
    normalize(interaction?.user?.username),
    normalize(interaction?.user?.globalName),
    normalize(interaction?.member?.displayName)
  ].filter(Boolean));
}

function medal(rank) {
  if (Number(rank) === 1) return '🥇';
  if (Number(rank) === 2) return '🥈';
  if (Number(rank) === 3) return '🥉';
  return '▫️';
}

function buildAnsiTable(pageData, valueLabel, viewerNames) {
  const ansi = {
    reset: '\u001b[0m',
    bold: '\u001b[1m',
    yellow: '\u001b[33m',
    cyan: '\u001b[36m',
    magenta: '\u001b[35m',
    green: '\u001b[32m'
  };

  const colorLine = (text, color) => `${ansi.bold}${color}${text}${ansi.reset}`;
  const pad = (str, len) => String(str).padEnd(len, ' ');
  const header = ` # PLAYER          ${valueLabel}`;

  const body = pageData.map(p => {
    const rankNum = Number(p.rank);
    const rank = String(p.rank).padStart(2);
    const name = pad(String(p.name || '').slice(0, 15), 15);
    const value = String(p.value).padStart(3);
    const line = `${rank} ${name} ${value}`;

    const isViewer = viewerNames.has(normalize(p.name)) || viewerNames.has(normalize(stripPrefix(p.name)));
    if (isViewer) return colorLine(`${line}   ← YOU`, ansi.green);
    if (rankNum === 1) return colorLine(line, ansi.yellow);
    if (rankNum === 2) return colorLine(line, ansi.cyan);
    if (rankNum === 3) return colorLine(line, ansi.magenta);
    return line;
  }).join('\n');

  return `\`\`\`ansi\n${header}\n${body || 'No data'}\n\`\`\``;
}

async function buildTopFive(players, config, interaction, playerMap = new Map()) {
  const top = players.slice(0, 5);
  if (!top.length) return 'No data';

  const lines = await Promise.all(top.map(async (p, index) => {
    const rawName = String(p.name || '').trim();
    const enteredName = stripPrefix(rawName);
    const playerInfo = playerMap.get(normalize(enteredName));

    const teamShort = playerInfo?.teamShort || 'N/A';
    const mention = playerInfo?.discordId
      ? `<@${playerInfo.discordId}>`
      : await findMemberMention(interaction, rawName);

    return `${index + 1}. ${teamShort}-${enteredName.toUpperCase()} ${mention} - **${p.value}** ${config.icon}`;
  }));

  return lines.join('\n');
}

function buildStatsSummary(players, config, type, page, totalPages) {
  const leader = players[0];
  const second = players[1];
  const third = players[2];

  return {
    category: cleanTitle(config.title),
    competition: config.competition.label,
    entries: players.length,
    page: `${page + 1}/${totalPages}`,
    leader: leader ? `\`${stripPrefix(leader.name)}\` • ${leader.value}` : 'N/A',
    second: second ? `\`${stripPrefix(second.name)}\` • ${second.value}` : 'N/A',
    third: third ? `\`${stripPrefix(third.name)}\` • ${third.value}` : 'N/A',
    type
  };
}

function buildStatsDescription(summary) {
  return (
    `${safeEmoji(E.rank, '🏅')} **Category:** ${summary.category}\n` +
    `${safeEmoji(E.trophy_animated || E.calendar, '🏆')} **Competition:** ${summary.competition}\n` +
    `${safeEmoji(E.played, '🎮')} **Entries:** ${summary.entries}\n` +
    `${safeEmoji(E.page || E.calendar, '📄')} **Page:** ${summary.page}\n\n` +
    `${safeEmoji(E.goldenBoot || E.goal, '🥇')} **Leader:** ${summary.leader}\n` +
    `${safeEmoji(E.runnerUp || E.medal, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show player stats leaderboard')
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription('Competition to show stats for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const competitionKey = interaction.options.getString('competition') || 'league';
    return buildStats(interaction, 'goals', 0, competitionKey);
  },

  async buttonHandler(interaction, action, page, type) {
    let newPage = Number.parseInt(page, 10);
    if (Number.isNaN(newPage)) newPage = 0;

    if (action === 'prev') newPage--;
    if (action === 'next') newPage++;

    const [resolvedType = 'goals', competitionKey = 'league'] = String(type || 'goals_league').split('__');
    return buildStats(interaction, resolvedType, newPage, competitionKey);
  },

  async selectHandler(interaction) {
    const [resolvedType = 'goals', competitionKey = 'league'] = String(interaction.values[0] || 'goals__league').split('__');
    return buildStats(interaction, resolvedType, 0, competitionKey);
  }
};

async function buildStats(interaction, type, page, competitionKey = 'league') {
  const config = getStatConfig(type, competitionKey);
  const raw = await cachedGetData(config.range).catch(() => []);

  const players = Array.isArray(raw)
    ? raw
        .slice(2)
        .filter(row => row[0] && row[1] && row[2] !== '')
        .map(row => ({
          rank: row[0],
          name: row[1],
          value: row[2]
        }))
    : [];

  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(players.length / perPage));
  page = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));

  const start = page * perPage;
  const pageData = players.slice(start, start + perPage);
  const viewerNames = getViewerNames(interaction);
  const playerMap = await cachedGetData('Players!A:Z').then(data => {
    if (!Array.isArray(data)) return new Map();

    const map = new Map();

    for (const row of data.slice(1)) {
      const playerName = row[0];
      const teamShort = row[1];
      const discordId = row[2];

      if (!playerName) continue;

      map.set(normalize(playerName), {
        teamShort: teamShort || 'N/A',
        discordId: discordId || null
      });
    }

    return map;
  });
  const topFiveText = await buildTopFive(players, config, interaction, playerMap);
  const summary = buildStatsSummary(players, config, type, page, totalPages);

  const embed = new EmbedBuilder()
    .setTitle(`${config.title} • ${config.competition.label}`)
    .setDescription(buildStatsDescription(summary))
    .addFields(
      { name: `${safeEmoji(E.stats || E.rank, '📊')} Leaderboard`, value: buildAnsiTable(pageData, config.valueLabel, viewerNames), inline: false },
      { name: `${safeEmoji(E.fire, '🔥')} Top 5`, value: topFiveText, inline: false },
      { name: `${safeEmoji(E.calendar, '📅')} Page`, value: `${page + 1}/${totalPages}`, inline: true },
      { name: `${safeEmoji(E.played, '🎮')} Entries`, value: String(players.length), inline: true },
      { name: '📊 Category', value: cleanTitle(config.title), inline: true },
      { name: '🏆 Competition', value: config.competition.label, inline: true }
    )
    .setFooter({ text: `${config.competition.label} Stats • Buttons = pages • Dropdown = stat type • Top 3 colored • Your line highlighted` })
    .setColor(config.color);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats_prev_${page}_${type}__${competitionKey}`)
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`stats_refresh_${page}_${type}__${competitionKey}`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`stats_next_${page}_${type}__${competitionKey}`)
      .setLabel('Next')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  const dropdown = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('stats_select')
      .setPlaceholder(cleanTitle(config.title))
      .addOptions(Object.entries(STAT_DEFS).map(([key, value]) => ({
        label: cleanTitle(value.title).slice(0, 100),
        value: `${key}__${competitionKey}`,
        description: `View ${value.valueLabel} • ${config.competition.label}`.slice(0, 100),
        emoji: value.icon,
        default: key === type
      })))
  );

  return {
    embeds: [embed],
    components: [buttons, dropdown]
  };
}
