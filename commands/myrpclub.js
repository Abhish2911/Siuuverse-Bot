const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrpclub')
    .setDescription('Shows your RP club profile and roster.'),
  async execute(interaction) {
    const userId = interaction.user.id;
    let managerRows;
    let rows;
    try {
      rows = await getData(
        'Player_Data!A:F',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
      managerRows = await getData(
        'Managers!A:C',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
    } catch (err) {
      return interaction.editReply('❌ Failed to fetch RP data.');
    }
    // Find player row first, then manager row as fallback
    const playerRow = rows.slice(1).find(
      row => String(row[0] || '').trim() === userId
    );

    const managerAccessRow = managerRows
      .slice(1)
      .find(row => String(row[0] || '').trim() === userId);

    let clubName;

    if (playerRow) {
      clubName = playerRow[5];
    } else if (managerAccessRow) {
      clubName = managerAccessRow[2];
    } else {
      return interaction.editReply('❌ You are not registered as an RP player or manager.');
    }

    if (!clubName) {
      return interaction.editReply('❌ Club roster not found.');
    }

    const normalizeClubName = value => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[._-]/g, '');

    const clubPlayers = rows.slice(1).filter(row => {
      const playerClub = normalizeClubName(row[5]);
      const targetClub = normalizeClubName(clubName);

      return (
        playerClub === targetClub ||
        playerClub.includes(targetClub) ||
        targetClub.includes(playerClub)
      );
    });

    if (!clubPlayers || clubPlayers.length === 0) {
      return interaction.editReply('❌ Club roster not found.');
    }

    const normalizedClub = normalizeClubName(clubName);

    const managerRow = managerRows
      .slice(1)
      .find(row => {
        const managerClub = normalizeClubName(row[2]);

        return (
          managerClub === normalizedClub ||
          managerClub.includes(normalizedClub) ||
          normalizedClub.includes(managerClub)
        );
      });

    if (!managerRow) {
      console.log(`[MYRPCLUB] Manager not found for club: ${clubName}`);
    }

    const managerMention = managerRow
      ? `<@${managerRow[0]}>`
      : 'Unknown';

    const managerName = managerRow?.[1] || 'Unknown';

    const playerMentions = clubPlayers
      .map(row => `• ${row[1] || 'Unknown'} (<@${row[0]}>)`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle(`${emojis.team} ${clubName}`)
      .setDescription([
        `${emojis.captain} **Manager:** ${managerMention}`,
        `${emojis.coop} **Squad Size:** ${clubPlayers.length} Players`,
        `${emojis.league} **Club:** ${clubName}`
      ].join('\n'))
      .addFields(
        {
          name: `${emojis.captain} Manager Name`,
          value: managerName,
          inline: true
        },
        {
          name: `${emojis.team} Club`,
          value: clubName,
          inline: true
        },
        {
          name: `${emojis.profile} Squad List`,
          value: playerMentions || 'No Players Found'
        }
      )
      .setFooter({
        text: `Roleplay Club Profile • ${clubPlayers.length} Players`
      })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};