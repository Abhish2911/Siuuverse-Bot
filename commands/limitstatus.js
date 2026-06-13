const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData } = require('../utils/sheets');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getSubmittedDateKey(value) {
  const text = clean(value);
  if (!text) return '';

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return getTodayKey(date);
}

function sameTeam(a, b) {
  return normalize(a) === normalize(b);
}

function getCompetitionDailyLimit(key) {
  if (key === 'league') return envNumber('MAX_LEAGUE_RESULTS_PER_TEAM_PER_DAY', 4);
  if (key === 'ucl') return envNumber('MAX_UCL_RESULTS_PER_TEAM_PER_DAY', 2);
  return envNumber('MAX_CUP_RESULTS_PER_TEAM_PER_DAY', 2);
}

function getTotalDailyLimit() {
  return envNumber('MAX_TOTAL_RESULTS_PER_TEAM_PER_DAY', 4);
}

function getLimitEmoji(count, limit) {
  if (!limit || limit <= 0) return safeEmoji(E.correct, '✅');
  if (count >= limit) return safeEmoji(E.lock, '🔒');
  if (count === limit - 1) return '⚠️';
  return safeEmoji(E.correct, '✅');
}

const SUBMITTED_AT_INDEX = 18;
const TEAMS_PER_PAGE = 3;

const RESULT_SOURCES = [
  { key: 'league', label: 'League', range: 'Matches_Entry!A:S' },
  { key: 'ucl', label: 'UCL', range: 'UCL_Coop_Results!A:S' },
  { key: 'fa', label: 'FA Cup', range: 'FA_Cup_Coop_Results!A:S' },
  { key: 'carabao', label: 'Carabao Cup', range: 'Carabao_Coop_Results!A:S' }
];

async function readTodayCounts() {
  const today = getTodayKey();
  const teamMap = new Map();

  const sources = await Promise.all(
    RESULT_SOURCES.map(source =>
      getData(source.range)
        .then(rows => ({ ...source, rows: Array.isArray(rows) ? rows.slice(1) : [] }))
        .catch(() => ({ ...source, rows: [] }))
    )
  );

  const ensureTeam = team => {
    const name = clean(team);
    if (!name) return null;

    const key = normalize(name);
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        name,
        total: 0,
        league: 0,
        ucl: 0,
        fa: 0,
        carabao: 0
      });
    }

    return teamMap.get(key);
  };

  for (const source of sources) {
    for (const row of source.rows) {
      const submittedAt = row[SUBMITTED_AT_INDEX];
      if (getSubmittedDateKey(submittedAt) !== today) continue;

      const home = ensureTeam(row[1]);
      const away = ensureTeam(row[2]);

      if (home) {
        home.total += 1;
        home[source.key] += 1;
      }

      if (away && !sameTeam(row[1], row[2])) {
        away.total += 1;
        away[source.key] += 1;
      }
    }
  }

  return [...teamMap.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function formatTeamLimitLine(team) {
  const leagueLimit = getCompetitionDailyLimit('league');
  const uclLimit = getCompetitionDailyLimit('ucl');
  const cupLimit = getCompetitionDailyLimit('fa');
  const totalLimit = getTotalDailyLimit();

  return (
    `**${team.name}**\n` +
    `> ${getLimitEmoji(team.total, totalLimit)} Total: **${team.total}/${totalLimit}**\n` +
    `> ${getLimitEmoji(team.league, leagueLimit)} League: **${team.league}/${leagueLimit}** • ` +
    `${getLimitEmoji(team.ucl, uclLimit)} UCL: **${team.ucl}/${uclLimit}**\n` +
    `> ${getLimitEmoji(team.fa, cupLimit)} FA: **${team.fa}/${cupLimit}** • ` +
    `${getLimitEmoji(team.carabao, cupLimit)} Carabao: **${team.carabao}/${cupLimit}**`
  );
}

function chunkLines(lines, maxChars = 950) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length > maxChars) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildPageButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`limitstatus_prev_${page}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`limitstatus_next_${page}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

async function buildLimitStatusPage(teamQuery = '', page = 0) {
  const today = getTodayKey();
  const counts = await readTodayCounts();
  const filtered = teamQuery
    ? counts.filter(team => normalize(team.name).includes(normalize(teamQuery)))
    : counts;

  const totalPages = Math.max(1, Math.ceil(filtered.length / TEAMS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageTeams = filtered.slice(
    safePage * TEAMS_PER_PAGE,
    safePage * TEAMS_PER_PAGE + TEAMS_PER_PAGE
  );

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.lock, '🔒')} Daily Result Limit Status`)
    .setDescription(
      `${safeEmoji(E.calendar, '📅')} **Date:** ${today} IST\n` +
      `${safeEmoji(E.played, '🎮')} **Limits:** League **${getCompetitionDailyLimit('league')}** • UCL **${getCompetitionDailyLimit('ucl')}** • Cups **${getCompetitionDailyLimit('fa')}** • Total **${getTotalDailyLimit()}**\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Page ${safePage + 1}/${totalPages} • ${filtered.length} Teams` })
    .setTimestamp();

  if (!filtered.length) {
    embed.addFields({
      name: teamQuery ? 'No matching team found' : 'No results submitted today',
      value: teamQuery
        ? `No team matched **${teamQuery}** in today result logs.`
        : 'No submitted results found for today yet.',
      inline: false
    });

    return { embeds: [embed], components: [] };
  }

  const fieldValue = pageTeams.map(formatTeamLimitLine).join('\n\n');

  embed.addFields({
    name: 'Teams',
    value: fieldValue.length > 1024
      ? `${fieldValue.slice(0, 1000)}\n...`
      : fieldValue,
    inline: false
  });

  return {
    embeds: [embed],
    components: teamQuery ? [] : [buildPageButtons(safePage, totalPages)]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('limitstatus')
    .setDescription('Show today result submission limits for all teams')
    .addStringOption(option =>
      option
        .setName('team')
        .setDescription('Optional team name to check')
        .setRequired(false)
    ),

  async execute(interaction) {
    const teamQuery = clean(interaction.options.getString('team'));
    return buildLimitStatusPage(teamQuery, 0);
  },

  async buttonHandler(interaction, action, value) {
    const currentPage = Number(value || 0);

    if (action === 'prev') {
      return buildLimitStatusPage('', Math.max(0, currentPage - 1));
    }

    if (action === 'next') {
      return buildLimitStatusPage('', currentPage + 1);
    }

    return null;
  }
};
