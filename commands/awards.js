const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const PAGE_SIZE = 6;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getSeasonNumberLabel(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+)/);
  return match ? match[1] : text || '?';
}

function getAwardEmoji(awardName) {
  const award = String(awardName || '').toLowerCase();

  if (award.includes('golden') || award.includes('boot')) return safeEmoji(E.goldenBoot || E.goal, '⚽');
  if (award.includes('playmaker')) return safeEmoji(E.playmaker || E.assist, '🎯');
  if (award.includes('mvp')) return safeEmoji(E.mvp, '⭐');
  if (award.includes('defender')) return safeEmoji(E.bestDefender || E.defense || E.tackle, '🛡️');
  if (award.includes('gk') || award.includes('keeper') || award.includes('glove')) return safeEmoji(E.goalkeeper || E.save, '🧤');
  if (award.includes('fair play') || award.includes('fairplay')) return safeEmoji(E.fairplay || E.fairPlay, '🕊️');
  if (award.includes('runner')) return safeEmoji(E.runnerUp || E.leagueRunnerUp, '🥈');
  if (award.includes('winner') || award.includes('champion') || award.includes('title')) return safeEmoji(E.winner || E.leagueWinner, '👑');
  if (award.includes('relegated')) return safeEmoji(E.relegated || E.down || E.lose, '🔻');

  return safeEmoji(E.badge || E.Badge, '🏅');
}

function getTypeEmoji(type) {
  const t = normalize(type);
  if (t.includes('duel')) return safeEmoji(E.duel || E.vs, '⚔️');
  return safeEmoji(E.coop || E.team, '🤝');
}

function joinLeaders(items = [], formatter, empty = 'N/A') {
  if (!items.length) return empty;
  return items.map(formatter).join(' / ');
}

function getTopValue(items = [], accessor) {
  if (!items.length) return 0;
  return Math.max(...items.map(accessor));
}

function getLeaders(items = [], accessor) {
  const top = getTopValue(items, accessor);
  if (!top) return [];
  return items.filter(item => accessor(item) === top);
}

function buildAwardsSummary(rows = []) {
  const mapped = rows.map(row => ({
    season: String(row[0] || 'N/A').trim(),
    player: String(row[1] || 'N/A').trim(),
    award: String(row[2] || 'Award').trim(),
    type: String(row[4] || 'N/A').trim()
  }));

  const playerLeaders = getLeaders(
    mapped.filter(item => item.player !== 'N/A'),
    item => mapped.filter(row => row.player === item.player).length
  );

  const awardLeaders = getLeaders(
    mapped.filter(item => item.award !== 'Award' && item.award !== 'N/A'),
    item => mapped.filter(row => row.award === item.award).length
  );

  return {
    total: rows.length,
    latestSeason: rows[0] ? `S${getSeasonNumberLabel(rows[0][0])}` : 'N/A',
    topWinner: playerLeaders.length
      ? `${joinLeaders(playerLeaders.map(item => item.player).filter((value, index, arr) => arr.indexOf(value) === index), value => value)} (${mapped.filter(row => row.player === playerLeaders[0].player).length})`
      : 'N/A',
    topAwardType: awardLeaders.length
      ? `${joinLeaders(awardLeaders.map(item => item.award).filter((value, index, arr) => arr.indexOf(value) === index), value => value)} (${mapped.filter(row => row.award === awardLeaders[0].award).length})`
      : 'N/A'
  };
}

function buildAwardsDescription(summary, filter, coopCount, duelCount, currentPage, totalPages) {
  return (
    `${safeEmoji(E.badge || E.Badge, '🏅')} **Archived award history**\n` +
    `SiuuVerse seasonal award records across coop and duel competitions.\n\n` +
    `${safeEmoji(E.badge || E.Badge, '🏅')} **All Awards:** ${summary.total}\n` +
    `${safeEmoji(E.coop || E.team, '🤝')} **Coop Awards:** ${coopCount}\n` +
    `${safeEmoji(E.duel || E.vs, '⚔️')} **Duel Awards:** ${duelCount}\n` +
    `${safeEmoji(E.calendar, '📅')} **Latest Season:** ${summary.latestSeason}\n` +
    `${safeEmoji(E.profile, '👤')} **Most Award Wins:** ${summary.topWinner}\n` +
    `${safeEmoji(E.rank, '🏅')} **Most Repeated Award:** ${summary.topAwardType}\n` +
    `${safeEmoji(E.page || E.calendar, '📄')} **Filter:** ${filter.toUpperCase()} • **Page:** ${currentPage + 1}/${totalPages}`
  );
}

function createButtons(page, totalPages, filter = 'all') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`awards_prev_${page}_${filter}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`awards_filter_all_${page}`)
      .setLabel('All')
      .setStyle(filter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`awards_filter_coop_${page}`)
      .setLabel('Coop')
      .setStyle(filter === 'coop' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`awards_filter_duel_${page}`)
      .setLabel('Duel')
      .setStyle(filter === 'duel' ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`awards_next_${page}_${filter}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

function formatAwardField(row) {
  const season = String(row[0] || 'N/A').trim();
  const player = String(row[1] || 'N/A').trim();
  const award = String(row[2] || 'Award').trim();
  const value = String(row[3] || '').trim();
  const type = String(row[4] || 'N/A').trim();
  const date = String(row[5] || '').trim();

  const seasonShort = `S${getSeasonNumberLabel(season)}`;

  return {
    name: `${getAwardEmoji(award)} ${award} • ${seasonShort}`,
    value:
      `${safeEmoji(E.profile, '👤')} **Winner:** ${player}\n` +
      `${getTypeEmoji(type)} **Type:** ${type || 'N/A'}\n` +
      `${value ? `${safeEmoji(E.rank, '🏅')} **Value:** ${value}\n` : ''}` +
      `${safeEmoji(E.calendar, '📅')} **Season:** ${season}`,
    inline: false
  };
}

async function buildPage(page = 0, filter = 'all') {
  const data = await cachedGetData('Awards!A:F');
  const rows = cleanRows(data);

  const filtered = rows.filter(row => {
    const type = normalize(row[4]);
    if (filter === 'coop') return type.includes('coop');
    if (filter === 'duel') return type.includes('duel');
    return true;
  });

  const sorted = filtered.sort((a, b) => {
    const aSeason = Number((String(a[0] || '').match(/(\d+)/) || [0, 0])[1]);
    const bSeason = Number((String(b[0] || '').match(/(\d+)/) || [0, 0])[1]);
    return bSeason - aSeason;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const currentRows = sorted.slice(start, start + PAGE_SIZE);

  const coopCount = rows.filter(row => normalize(row[4]).includes('coop')).length;
  const duelCount = rows.filter(row => normalize(row[4]).includes('duel')).length;
  const summary = buildAwardsSummary(sorted);

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.badge || E.Badge, '🏅')} SIUUVERSE AWARDS GALLERY`)
    .setDescription(buildAwardsDescription(summary, filter, coopCount, duelCount, currentPage, totalPages))
    .setColor(0xF39C12)
    .setFooter({ text: `Awards Gallery • Archived season awards • Page ${currentPage + 1}/${totalPages}` })
    .setTimestamp();

  if (currentRows.length) {
    embed.addFields(
      {
        name: `${safeEmoji(E.badge || E.Badge, '🏅')} Award Entries`,
        value: 'Archived award entries for the current page are shown below.',
        inline: false
      },
      ...currentRows.map(formatAwardField)
    );
  } else {
    embed.addFields({
      name: `${safeEmoji(E.wrong, '❌')} No awards found`,
      value: 'There are no archived season awards for this filter yet.',
      inline: false
    });
  }

  return {
    embeds: [embed],
    components: [createButtons(currentPage, totalPages, filter)]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('awards')
    .setDescription('Show archived season awards')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Filter by competition type')
        .setRequired(false)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Coop / League', value: 'coop' },
          { name: 'Duel / 1v1', value: 'duel' }
        )
    ),

  async execute(interaction) {
    const filter = interaction.options.getString('type') || 'all';
    return buildPage(0, filter);
  },

  async buttonHandler(interaction, action, page = '0', filter = 'all') {
    if (action === 'filter') {
      return buildPage(0, page || 'all');
    }

    const currentPage = Number(page) || 0;
    const currentFilter = filter || 'all';
    const nextPage = action === 'next' ? currentPage + 1 : currentPage - 1;
    return buildPage(nextPage, currentFilter);
  }
};