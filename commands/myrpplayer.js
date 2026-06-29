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
      'Player_Data!A:Q',
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
      club: playerRow[5] || 'Free Agent',
      shooting: Number(playerRow[6] || 0),
      passing: Number(playerRow[7] || 0),
      dribbling: Number(playerRow[8] || 0),
      dexterity: Number(playerRow[9] || 0),
      lowerBody: Number(playerRow[10] || 0),
      aerial: Number(playerRow[11] || 0),
      defending: Number(playerRow[12] || 0),
      gk1: Number(playerRow[13] || 0),
      gk2: Number(playerRow[14] || 0),
      gk3: Number(playerRow[15] || 0),
      tp: Number(playerRow[16] || 0)
    };

    let discordUsername = 'Unknown User';

    try {
      const discordUser = await interaction.client.users.fetch(player.discordId);
      discordUsername = discordUser.username;
    } catch {
      discordUsername = 'Unknown User';
    }

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`⚽ ${player.playerName}`)
      .setDescription([
        `**OVR:** ${player.ovr} • **MV:** ${player.marketValue}`,
        `**Club:** ${player.club}`,
        `**Positions:** ${player.positions}`,
        `**Total TP:** ${player.tp}`
      ].join('\n'))
      .addFields(
        {
          name: `${emojis.profile} Player`,
          value: `**${player.playerName}**`,
          inline: true
        },
        {
          name: 'Discord Username',
          value: `**${discordUsername}**`,
          inline: true
        },
        {
          name: '‎',
          value: '‎',
          inline: true
        },
        {
          name: `${emojis.Stats} Training Points (1/2)`,
          value: [
            `**SHT:** ${player.shooting}`,
            `**PAS:** ${player.passing}`,
            `**DEX:** ${player.dexterity}`,
            `**DRI:** ${player.dribbling}`,
            `**LBS:** ${player.lowerBody}`
          ].join('\n'),
          inline: true
        },
        {
          name: `${emojis.Stats} Training Points (2/2)`,
          value: [
            `**AER:** ${player.aerial}`,
            `**DEF:** ${player.defending}`,
            `**GK1:** ${player.gk1}`,
            `**GK2:** ${player.gk2}`,
            `**GK3:** ${player.gk3}`
          ].join('\n'),
          inline: true
        }
      )
      .setFooter({ text: `Roleplay Player Profile • Requested by ${interaction.user.username}` })
      .setAuthor({
        name: `${player.playerName} Profile`
      })
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.reply({ embeds: [embed] });
  }
};