

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const PER_PAGE = 10;

function buildButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rplb_prev_${page}`)
      .setEmoji(E.leftArrow || '⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),

    new ButtonBuilder()
      .setCustomId(`rplb_refresh_${page}`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`rplb_next_${page}`)
      .setEmoji(E.rightArrow || '➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpleaderboard')
    .setDescription('View RP economy leaderboard')
    .addIntegerOption(option =>
      option
        .setName('page')
        .setDescription('Leaderboard page')
        .setMinValue(1)
    ),

  async execute(interaction) {
    const page = interaction.options.getInteger('page') || 1;

    const economy = await cachedGetData('Economy!A:D', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    const players = economy
      .slice(1)
      .map(row => ({
        club: String(row[0] || 'Unknown'),
        userId: String(row[1] || ''),
        player: String(row[2] || 'Unknown'),
        balance: Number(String(row[3] || '0').replace(/,/g, '')) || 0
      }))
      .sort((a, b) => b.balance - a.balance);

    const totalPages = Math.max(1, Math.ceil(players.length / PER_PAGE));
    const currentPage = Math.min(Math.max(page, 1), totalPages);

    const start = (currentPage - 1) * PER_PAGE;
    const pageData = players.slice(start, start + PER_PAGE);

    const lines = pageData.map((p, index) => {
      const rank = start + index + 1;

      let medal = E.rank;
      if (rank === 1) medal = E.winner || '🥇';
      else if (rank === 2) medal = E.runnerUp || '🥈';
      else if (rank === 3) medal = '🥉';

      return `${medal} **#${rank}** • ${p.player}\n${E.team} ${p.club} • <@${p.userId}>\n${E.money || '💰'} **${p.balance.toLocaleString()} SiuuCoins**`;
    });

    const richest = players[0];

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`${E.trophy || E.Trophy_icon || '🏆'} RP Money Leaderboard`)
      .setDescription(lines.join('\n\n') || 'No economy data found.')
      .addFields({
        name: `${E.money || '💰'} Richest Player`,
        value: richest
          ? `**${richest.player}** • ${richest.balance.toLocaleString()} SiuuCoins`
          : 'No data'
      })
      .setFooter({
        text: `Page ${currentPage}/${totalPages} • ${players.length} Players`
      });

    return {
      embeds: [embed],
      components: [buildButtons(currentPage, totalPages)]
    };
  }
};

module.exports.handleButton = async interaction => {
  const parts = interaction.customId.split('_');
  const action = parts[1];
  const currentPage = Number(parts[2]) || 1;

  let page = currentPage;

  if (action === 'prev') page--;
  if (action === 'next') page++;

  interaction.options = {
    getInteger: () => page
  };

  const result = await module.exports.execute(interaction);
  return interaction.update(result);
};
