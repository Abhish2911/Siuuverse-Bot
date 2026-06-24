const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrpplayer')
    .setDescription('View an RP player profile')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('View another user\'s RP player profile')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Search by RP player name')
        .setRequired(false)
    ),

  async execute(interaction) {
    const rows = await getData(
      'Player_Data!A:F',
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    const targetUser = interaction.options.getUser('user');
    const playerNameSearch = interaction.options.getString('player');

    let playerRow;

    if (playerNameSearch) {
      const search = playerNameSearch.trim().toLowerCase();

      playerRow = rows
        .slice(1)
        .find(row => {
          const playerName = String(row[1] || '').trim().toLowerCase();

          return (
            playerName === search ||
            playerName.includes(search) ||
            search.includes(playerName)
          );
        });
    } else {
      const lookupUser = targetUser || interaction.user;

      playerRow = rows
        .slice(1)
        .find(row => String(row[0] || '').trim() === lookupUser.id);
    }

    if (!playerRow) {
      return interaction.editReply({
        content: `❌ RP player not found.`
      });
    }

    const player = {
      discordId: playerRow[0] || 'N/A',
      playerName: playerRow[1] || 'N/A',
      ovr: playerRow[2] || '0',
      marketValue: playerRow[3] || '0',
      positions: playerRow[4] || 'N/A',
      club: playerRow[5] || 'Free Agent'
    };

    const embed = new EmbedBuilder()
      .setTitle(`${emojis.profile} ${player.playerName}`)
      .setDescription([
        `${emojis.rank} **OVR:** ${player.ovr}`,
        `${emojis.trophy} **Market Value:** ${player.marketValue}`,
        `${emojis.team} **Club:** ${player.club}`,
        `${emojis.defense} **Positions:** ${player.positions}`
      ].join('\n'))
      .addFields(
        {
          name: `${emojis.profile} Player` ,
          value: player.playerName,
          inline: true
        },
        {
          name: `${emojis.rank} Rating`,
          value: String(player.ovr),
          inline: true
        },
        {
          name: `${emojis.trophy} Value`,
          value: player.marketValue,
          inline: true
        },
        {
          name: `${emojis.team} Club`,
          value: player.club,
          inline: true
        },
        {
          name: `${emojis.defense} Positions`,
          value: player.positions,
          inline: true
        },
        {
          name: '👤 Discord User',
          value: `<@${player.discordId}>`,
          inline: true
        }
      )
      .setFooter({ text: `Roleplay Player Profile • Requested by ${interaction.user.username}` })
      .setAuthor({
        name: player.playerName
      })
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.reply({ embeds: [embed] });
  }
};