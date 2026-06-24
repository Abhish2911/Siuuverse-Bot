const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpfalist')
    .setDescription('Show all RP free agents'),

  async execute(interaction) {
    const rows = await getData(
      'Player_Data!A:F',
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    const freeAgents = rows
      .slice(1)
      .filter(row =>
        String(row[5] || '').trim().toLowerCase() === 'free agent'
      );

    if (!freeAgents.length) {
      return interaction.editReply({
        content: '❌ No free agents found.'
      });
    }
    
    const PAGE_SIZE = 10;
    let page = 0;
    const totalPages = Math.ceil(freeAgents.length / PAGE_SIZE);

    const buildEmbed = (currentPage) => {
      const start = currentPage * PAGE_SIZE;
      const pagePlayers = freeAgents.slice(start, start + PAGE_SIZE);

      const playersList = pagePlayers
        .map((row, index) => {
          const playerName = row[1] || 'Unknown';
          const ovr = row[2] || '0';
          const value = row[3] || '0';
          const positions = row[4] || 'N/A';

          return `\`${start + index + 1}.\` **${playerName}** • ${ovr} OVR\n<@${row[0]}> • ${positions} • ${value}`;
        })
        .join('\n\n');

      return new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`${emojis.team} Roleplay Free Agent Market`)
        .setDescription([
          `${emojis.profile} **Available Players:** ${freeAgents.length}`,
          `${emojis.trophy} Sign free agents to strengthen your squad.`,
          `${emojis.league} Players listed below currently have no club.`
        ].join('\n'))
        .addFields({
          name: `${emojis.profile} Free Agent Pool`,
          value: playersList || 'No Players Found'
        })
        .setFooter({
          text: `Page ${currentPage + 1}/${totalPages} • ${freeAgents.length} Free Agents`
        })
        .setTimestamp();
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('fa_prev')
        .setEmoji(emojis.leftArrow.match(/\d+/)?.[0])
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('fa_next')
        .setEmoji(emojis.rightArrow.match(/\d+/)?.[0])
        .setStyle(ButtonStyle.Secondary)
    );

    const message = await interaction.editReply({
      embeds: [buildEmbed(page)],
      components: totalPages > 1 ? [row] : []
    });

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
      time: 300000
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({
          content: '❌ Only the command user can use these buttons.',
          ephemeral: true
        });
      }

      if (i.customId === 'fa_prev') {
        page = page <= 0 ? totalPages - 1 : page - 1;
      }

      if (i.customId === 'fa_next') {
        page = page >= totalPages - 1 ? 0 : page + 1;
      }

      await i.update({
        embeds: [buildEmbed(page)],
        components: [row]
      });
    });
  }
};