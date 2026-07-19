const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('paywages')
    .setDescription('Pay wages to every player in your club.'),
  async execute(interaction) {
    const MANAGERS_SHEET = 'Managers';
    const WAGES_SHEET = 'Wages';
    const ECONOMY_SHEET = 'Economy';

    const normalizeClubName = value => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[._-]/g, '');

    // Read Managers!A:C
    const managersDataRaw = await cachedGetData(`${MANAGERS_SHEET}!A:C`, {
      spreadsheetId: process.env.RP_SHEET_ID
    });
    const managersData = managersDataRaw.slice(1);
    // Find the row whose first column (Discord ID) matches interaction.user.id
    const managerRow = managersData.find(row => row[0] === interaction.user.id);

    if (!managerRow) {
      return { content: '❌ Only club managers can use this command.' };
    }

    // Store the club from column C
    const club = managerRow[2];
    const targetClub = normalizeClubName(club);

    // Read Wages!A:D
    const wagesDataRaw = await cachedGetData(`${WAGES_SHEET}!A:D`, {
      spreadsheetId: process.env.RP_SHEET_ID
    });
    const wagesData = wagesDataRaw.slice(1);
    // Filter rows whose first column (Club Name) equals the manager's club using normalization
    const clubPlayers = wagesData.filter(row => {
      const playerClub = normalizeClubName(row[0]);
      return (
        playerClub === targetClub ||
        playerClub.includes(targetClub) ||
        targetClub.includes(playerClub)
      );
    });

    if (clubPlayers.length === 0) {
      return { content: '❌ No wages have been configured for your club.' };
    }

    // Calculate totalWages by summing column D
    const totalWages = clubPlayers.reduce(
      (sum, row) =>
        sum + (Number(String(row[3] || '0').replace(/,/g, '')) || 0),
      0
    );

    // Read Economy!A:D
    const economyDataRaw = await cachedGetData(`${ECONOMY_SHEET}!A:D`, {
      spreadsheetId: process.env.RP_SHEET_ID
    });
    const economyData = economyDataRaw.slice(1);

    // Find the club account where column A matches club (case-insensitive) using normalization
    const clubAccountIndex = economyData.findIndex(row => {
      const economyClub = normalizeClubName(row[0]);
      return (
        economyClub === targetClub ||
        economyClub.includes(targetClub) ||
        targetClub.includes(economyClub)
      );
    });
    if (clubAccountIndex === -1) {
      return { content: '❌ Club account not found in Economy sheet.' };
    }

    const clubAccountRowNumber = clubAccountIndex + 2; // +2 because of header and 1-based indexing
    const clubBalance = Number(String(economyData[clubAccountIndex][3] || '0').replace(/,/g, '')) || 0;

    if (clubBalance < totalWages) {
      return { content: '❌ Your club does not have enough balance to pay wages.' };
    }

    // For each player in clubPlayers, find their Economy row by UserID (column B)
    for (const player of clubPlayers) {
      const playerUserId = player[1];
      const playerWage =
        Number(String(player[3] || '0').replace(/,/g, '')) || 0;
      const playerEconomyIndex = economyData.findIndex(row => row[1] === playerUserId);
      if (playerEconomyIndex === -1) {
        // Player not found in Economy sheet, skip
        continue;
      }
      const playerRowNumber = playerEconomyIndex + 2;
      const playerBalance = Number(String(economyData[playerEconomyIndex][3] || '0').replace(/,/g, '')) || 0;
      const newBalance = playerBalance + playerWage;

      await updateData(`Economy!D${playerRowNumber}`, [[newBalance]], {
        spreadsheetId: process.env.RP_SHEET_ID
      });

      // DM the player their wages
      try {
        const user = await interaction.client.users.fetch(playerUserId);

        const dmEmbed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle(`${E.success} Wages Received`)
          .setDescription([
            `${E.money || '💰'} Your weekly wages have been credited.`,
            '',
            `${E.team} Club: **${club}**`,
            `${E.greenIcon} Wages Received: **$${playerWage.toLocaleString()}**`,
            `${E.fire} New Balance: **$${newBalance.toLocaleString()}**`
          ].join('\n'))
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
      } catch {
        // Ignore DM failures
      }
    }

    // Subtract totalWages from club account balance
    const newClubBalance = clubBalance - totalWages;
    await updateData(`Economy!D${clubAccountRowNumber}`, [[newClubBalance]], {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    // Build an EmbedBuilder titled Weekly Wage Summary using emojis and value formatting
    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`${E.success} Weekly Wage Summary`)
      .setDescription([
        `${E.team} **${club}** wage distribution completed successfully.`,
        '',
        `### ${E.correct} Payments`,
        clubPlayers.map(row => {
          const wage = row[3] && String(row[3]).trim() !== ''
            ? `$${Number(String(row[3]).replace(/,/g, '')).toLocaleString()}`
            : 'Wages Not Set';
          return `${E.doubleArrow} **${row[2]}** • ${wage}`;
        }).join('\n')
      ].join('\n'))
      .addFields(
        { name: `${E.team} Club`, value: club, inline: true },
        { name: `${E.profile} Players Paid`, value: `${clubPlayers.length}`, inline: true },
        { name: `${E.trophy} Total Wages`, value: `$${totalWages.toLocaleString()}`, inline: true },
        {
          name: `${E.greenIcon} Remaining Club Balance`,
          value: `$${newClubBalance.toLocaleString()}`,
          inline: false
        }
      )
      .setTimestamp();

    return { embeds: [embed] };
  },
};
