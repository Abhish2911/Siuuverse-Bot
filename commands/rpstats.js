

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
    range: 'Stats_Ranking!D:F',
    title: `${safeEmoji(E.playmaker,'🎯')} Playmakers`,
    emoji: '🎯',
    color: 0x3498DB,
  },
  {
    label: 'Clean Sheets',
    value: 'cleansheets',
    range: 'Stats_Ranking!G:I',
    title: `${safeEmoji(E.save,'🧤')} Clean Sheets`,
    emoji: '🧤',
    color: 0x2ECC71,
  },
];

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpstats')
    .setDescription('View RP stats leaderboards.'),
  async execute(interaction) {
    // Default to goals
    await sendStatsLeaderboard(interaction, 'goals', 0, true);
  },
  async handleComponent(interaction) {
    // Custom IDs: 'rpstats_statselect', 'rpstats_prev', 'rpstats_next', 'rpstats_refresh'
    const [id, stat, page] = interaction.customId.split(':');
    let currentStat = stat || 'goals';
    let currentPage = parseInt(page || '0', 10);
    if (interaction.isStringSelectMenu()) {
      currentStat = interaction.values[0];
      currentPage = 0;
      await sendStatsLeaderboard(interaction, currentStat, currentPage, false, true);
    } else if (interaction.isButton()) {
      if (id === 'rpstats_prev') {
        currentPage = Math.max(currentPage - 1, 0);
      } else if (id === 'rpstats_next') {
        currentPage = currentPage + 1;
      } else if (id === 'rpstats_refresh') {
        // no change
      }
      await sendStatsLeaderboard(interaction, currentStat, currentPage, false, id === 'rpstats_refresh');
    }
  }
};

async function sendStatsLeaderboard(interaction, statType, page, initial, ephemeral) {
  const stat = STAT_OPTIONS.find(s => s.value === statType) || STAT_OPTIONS[0];
  // Always use RP sheet
  const sheetId = process.env.RP_SHEET_ID;
  let data;
  try {
    data = await cachedGetData(stat.range, {
      spreadsheetId: process.env.RP_SHEET_ID
    });
  } catch (e) {
    await (initial ? interaction.reply : interaction.update)({
      content: 'Failed to fetch the stats leaderboard.',
      ephemeral: true,
    });
    return;
  }
  // data is 2d array, skip header
  const leaderboard = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const player = row[0];
    const value = row[1];
    if (player && value !== undefined && value !== '') {
      leaderboard.push({ player, value });
    }
  }
  leaderboard.sort((a, b) => Number(b.value) - Number(a.value));
  const totalPages = Math.ceil(leaderboard.length / PAGE_SIZE);
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
    .setCustomId('rpstats_statselect')
    .setPlaceholder(`Selected: ${stat.title.replace(/<a?:\w+:\d+>/g, '').trim()}`)
    .addOptions(
      STAT_OPTIONS.map(opt => ({
        label: opt.label,
        value: opt.value,
        emoji: opt.emoji,
        default: statType === opt.value,
      }))
    );
  const statRow = new ActionRowBuilder().addComponents(statSelect);

  // Pagination buttons
  const prevButton = new ButtonBuilder()
    .setCustomId(`rpstats_prev:${statType}:${page}`)
    .setLabel('Previous')
    .setEmoji('⬅️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);
  const refreshButton = new ButtonBuilder()
    .setCustomId(`rpstats_refresh:${statType}:${page}`)
    .setLabel('Refresh')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Primary);
  const nextButton = new ButtonBuilder()
    .setCustomId(`rpstats_next:${statType}:${page}`)
    .setLabel('Next')
    .setEmoji('➡️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page + 1 >= totalPages);
  const pageRow = new ActionRowBuilder().addComponents(prevButton, refreshButton, nextButton);

  const payload = {
    embeds: [embed],
    components: [statRow, pageRow],
    ephemeral: !!ephemeral,
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(payload);
  } else if (initial) {
    await interaction.reply(payload);
  } else {
    await interaction.update(payload);
  }
}