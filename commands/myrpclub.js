const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrpclub')
    .setDescription('Shows an RP club profile and roster.')
    .addStringOption(option =>
      option
        .setName('club')
        .setDescription('Search for a club by name')
        .setRequired(false)
    ),
  async execute(interaction) {
    const userId = interaction.user.id;
    const clubSearch = interaction.options.getString('club');
    let managerRows;
    let rows;
    try {
      rows = await getData(
        'Player_Data!A:Q',
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

    if (clubSearch) {
      const search = clubSearch.trim().toLowerCase();

      const matchedPlayer = rows.slice(1).find(row => {
        const club = String(row[5] || '').trim().toLowerCase();

        return (
          club === search ||
          club.includes(search) ||
          search.includes(club)
        );
      });

      const matchedManager = managerRows.slice(1).find(row => {
        const club = String(row[2] || '').trim().toLowerCase();

        return (
          club === search ||
          club.includes(search) ||
          search.includes(club)
        );
      });

      clubName = matchedPlayer?.[5] || matchedManager?.[2];

      if (!clubName) {
        return interaction.editReply('❌ Club not found.');
      }
    } else if (playerRow) {
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

    const totalOVR = clubPlayers.reduce((sum, row) => sum + Number(row[2] || 0), 0);
    const avgOVR = clubPlayers.length
      ? (totalOVR / clubPlayers.length).toFixed(1)
      : '0';

    const playerMentions = clubPlayers
      .sort((a, b) => Number(b[2] || 0) - Number(a[2] || 0))
      .map(row => {
        const name = row[1] || 'Unknown';
        const ovr = row[2] || '0';

        return `• **${name}** (<@${row[0]}>)\n   OVR: **${ovr}**`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`${emojis.team} ${clubName}`)
      .setDescription([
        `${emojis.captain} **Manager:** ${managerMention}`,
        `${emojis.league} **Club:** ${clubName}`,
        '',
        `**${emojis.profile} Squad Roster**`,
        playerMentions || 'No Players Found'
      ].join('\n'))
      .addFields(
        {
          name: '📊 Club Stats',
          value: [
            `**Squad Size:** ${clubPlayers.length}`,
            `**Average OVR:** ${avgOVR}`
          ].join('\n'),
          inline: true
        },
        {
          name: `${emojis.captain} Manager Name`,
          value: `**${managerName}**`,
          inline: true
        }
      )
      .setFooter({
        text: `Roleplay Club Profile • ${clubPlayers.length} Players`
      })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};
