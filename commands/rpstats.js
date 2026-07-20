const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

const STAT_OPTIONS = [
  {
    label: 'Goals',
    value: 'goals',
    range: 'Stats_Ranking!A:C',
    title: `${safeEmoji(E.goldenBoot,'👟')} Golden Boot`,
    emoji: '⚽',
    color: 0xF1C40F,
  },
  {
    label: 'Assists',
    value: 'assists',
    range: 'Stats_Ranking!E:G',
    title: `${safeEmoji(E.playmaker,'🎯')} Playmakers`,
    emoji: '🎯',
    color: 0x3498DB,
  },
  {
    label: 'GK Saves',
    value: 'gksaves',
    range: 'Stats_Ranking!I:K',
    title: `${safeEmoji(E.save,'🧤')} GK Saves`,
    emoji: '🧤',
    color: 0x2ECC71,
  },
  {
    label: 'Clean Sheets',
    value: 'cleansheets',
    range: 'Stats_Ranking!M:O',
    title: `${safeEmoji(E.save,'🛡️')} Clean Sheets`,
    emoji: '🛡️',
    color: 0x27AE60,
  },
];

const ALL_TIME_OPTIONS = [
  {
    label: 'Goals',
    value: 'alltime_goals',
    range: 'All_Time_Ranking!A:C',
    title: '🏆 All-Time Goals',
    emoji: '⚽',
    color: 0xF1C40F,
  },
  {
    label: 'Assists',
    value: 'alltime_assists',
    range: 'All_Time_Ranking!E:G',
    title: '🏆 All-Time Assists',
    emoji: '🎯',
    color: 0x3498DB,
  },
  {
    label: 'GK Saves',
    value: 'alltime_gksaves',
    range: 'All_Time_Ranking!I:K',
    title: '🏆 All-Time GK Saves',
    emoji: '🧤',
    color: 0x2ECC71,
  },
  {
    label: 'Clean Sheets',
    value: 'alltime_cleansheets',
    range: 'All_Time_Ranking!M:O',
    title: '🏆 All-Time Clean Sheets',
    emoji: '🛡️',
    color: 0x27AE60,
  },
];

const getOptions = statType => statType.startsWith('alltime_') ? ALL_TIME_OPTIONS : STAT_OPTIONS;

const VIEW_BUTTONS = [
  { id: 'current', label: 'Current Season' },
  { id: 'alltime', label: 'All Time' },
];

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpstats')
    .setDescription('View RP stats leaderboards.'),
  async execute(interaction) {
    return sendStatsLeaderboard(interaction, 'goals', 0);
  },
  async buttonHandler(interaction, action, value) {
    if (action === 'view') {
      const [view, ownerId] = String(value || '').split('__');
      if (ownerId && ownerId !== interaction.user.id) {
        return { content: '❌ You cannot use another user\'s RP stats menu.', ephemeral: true };
      }
      if (view === 'current') {
        return sendStatsLeaderboard(interaction, 'goals', 0);
      }
      if (view === 'alltime') {
        return sendStatsLeaderboard(interaction, 'alltime_goals', 0);
      }
      return;
    }

    const firstUnderscore = String(value || '').indexOf('_');

    let page = '0';
    let typeData = 'goals__';

    if (firstUnderscore !== -1) {
      page = value.slice(0, firstUnderscore);
      typeData = value.slice(firstUnderscore + 1);
    }

    const [statType = 'goals', ownerId] = typeData.split('__');

    if (ownerId && ownerId !== interaction.user.id) {
      return { content: '❌ You cannot use another user\'s RP stats menu.', ephemeral: true };
    }

    let newPage = Number(page) || 0;
    if (action === 'prev') newPage--;
    if (action === 'next') newPage++;

    return sendStatsLeaderboard(interaction, statType, newPage);
  },
  async selectHandler(interaction) {
    const statType = String(interaction.values?.[0] || 'goals').split('__')[0];
    return sendStatsLeaderboard(interaction, statType, 0);
  }
};

async function sendStatsLeaderboard(interaction, statType, page) {
  const options = getOptions(statType);
  const stat = options.find(s => s.value === statType) || options[0];
  let data;
  try {
    console.time(`rpstats:${statType}`);
    data = await cachedGetData(stat.range, {
      cache: false,
      spreadsheetId: process.env.RP_SHEET_ID
    });
    console.timeEnd(`rpstats:${statType}`);
    if (!Array.isArray(data)) {
      throw new Error('Stats_Ranking did not return an array');
    }
  } catch (e) {
    console.error('RP Stats Error:', e);
    return {
      content: 'Failed to fetch the stats leaderboard.',
      ephemeral: true
    };
  }
  // Every selected range has the format: USER | Players | Stat.
  // data is 2d array, skip header
  const leaderboard = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const userCell = String(row[0] || '').trim();
    let player = String(row[1] || '').trim();
    const value = row[2];

    // If the Players column contains a Discord ID and the USER column contains
    // the actual player name, use the USER column as the display name.
    if (/^\d{17,20}$/.test(player) && userCell) {
      player = userCell;
    }

    if (player && value !== undefined && value !== '') {
      leaderboard.push({ player, value });
    }
  }
  leaderboard.sort((a, b) => Number(b.value) - Number(a.value));
  const totalPages = Math.max(1, Math.ceil(leaderboard.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageStart = page * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pageLeaderboard = leaderboard.slice(pageStart, pageEnd);

  const embed = new EmbedBuilder()
    .setTitle(`${stat.emoji} ${stat.title} Leaderboard`)
    .setColor(stat.color)
    .setFooter({ text: `Page ${page + 1} of ${Math.max(totalPages, 1)}` })
    .setTimestamp();

  let desc = '';
  for (let i = 0; i < pageLeaderboard.length; i++) {
    const rank = pageStart + i + 1;
    desc += `**${rank}.** ${pageLeaderboard[i].player} — \`${pageLeaderboard[i].value}\`\n`;
  }
  if (!desc) desc = '*No data found.*';
  embed.setDescription(desc);

  // Stat selector
  const statSelect = new StringSelectMenuBuilder()
    .setCustomId(`rpstats_select_${interaction.user.id}`)
    .setPlaceholder(`Selected: ${stat.title.replace(/<a?:\w+:\d+>/g, '').trim()}`)
    .addOptions(
      options.map(opt => ({
        label: opt.label,
        value: `${opt.value}__${interaction.user.id}`,
        emoji: opt.emoji,
        default: statType === opt.value,
      }))
    );
  const statRow = new ActionRowBuilder().addComponents(statSelect);

  const currentView = statType.startsWith('alltime_') ? 'alltime' : 'current';

  const viewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rpstats_view_current__${interaction.user.id}`)
      .setLabel('Current Season')
      .setStyle(currentView === 'current' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rpstats_view_alltime__${interaction.user.id}`)
      .setLabel('All Time')
      .setStyle(currentView === 'alltime' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  // Pagination buttons
  const prevButton = new ButtonBuilder()
    .setCustomId(`rpstats_prev_${page}_${statType}__${interaction.user.id}`)
    .setLabel('Previous')
    .setEmoji('⬅️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);
  const refreshButton = new ButtonBuilder()
    .setCustomId(`rpstats_refresh_${page}_${statType}__${interaction.user.id}`)
    .setLabel('Refresh')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Primary);
  const nextButton = new ButtonBuilder()
    .setCustomId(`rpstats_next_${page}_${statType}__${interaction.user.id}`)
    .setLabel('Next')
    .setEmoji('➡️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page + 1 >= totalPages);
  const pageRow = new ActionRowBuilder().addComponents(prevButton, refreshButton, nextButton);

  const payload = {
    embeds: [embed],
    components: [viewRow, statRow, pageRow],
  };
  return payload;
}