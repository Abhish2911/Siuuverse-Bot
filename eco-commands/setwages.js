const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const E = require('../utils/emojis');

// Sheet name constants
const MANAGERS_SHEET = 'Managers';
const WAGES_SHEET = 'Wages';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setwages')
    .setDescription('Set the weekly wages for a player in your club.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Select the player')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('The name of the player')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('wages')
        .setDescription('The new weekly wage')
        .setRequired(true)
        .setMinValue(0)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser('user');
    const playerNameInput = interaction.options.getString('player')?.trim();
    const newWages = interaction.options.getInteger('wages');

    // 1. Read Managers sheet (A:C)
    let managersDataRaw;
    try {
      managersDataRaw = await cachedGetData(`${MANAGERS_SHEET}!A:C`, {
        spreadsheetId: process.env.RP_SHEET_ID
      });
    } catch (e) {
      return { content: '❌ Could not access Managers sheet.' };
    }
    const managers = managersDataRaw.slice(1);
    // 2. Verify user is a manager
    const managerRow = managers.find(row => row[0] === userId);
    if (!managerRow) {
      return { content: '❌ Only club managers can use this command.' };
    }
    // 3. Determine manager's club (column C)
    const managerClub = managerRow[2];
    if (!managerClub) {
      return { content: '❌ Could not determine your club.' };
    }

    // 4. Read Wages sheet (A:D)
    let wagesRowsRaw;
    try {
      wagesRowsRaw = await cachedGetData(`${WAGES_SHEET}!A:D`, {
        spreadsheetId: process.env.RP_SHEET_ID
      });
    } catch (e) {
      return { content: '❌ Could not access Wages sheet.' };
    }
    const wagesRows = wagesRowsRaw.slice(1);

    // 5. Find row matching club and player
    // Columns: Club Name | UserID | Player Name | Wages
    const normalize = val => String(val || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const playerRowIndex = wagesRows.findIndex(row =>
      normalize(row[0]) === normalize(managerClub) &&
      String(row[1]).trim() === targetUser.id
    );
    if (playerRowIndex === -1) {
      return { content: '❌ That player is not in your club.' };
    }
    const playerRow = wagesRows[playerRowIndex];
    if (
      playerNameInput &&
      normalize(playerRow[2]) !== normalize(playerNameInput)
    ) {
      return {
        content: '❌ The provided player name does not match the selected user.'
      };
    }

    // 7. Update only the Wages column for that row
    try {
      await updateData(`Wages!D${playerRowIndex + 2}`, [[newWages]], {
        spreadsheetId: process.env.RP_SHEET_ID
      });
    } catch (e) {
      return { content: '❌ Failed to update wages.' };
    }

    // 8. Return embed
    const embed = new EmbedBuilder()
      .setTitle(`${E.success} Wages Updated`)
      .setColor(0x2ECC71)
      .addFields(
        { name: 'Club', value: managerClub, inline: true },
        { name: 'Player', value: `${playerRow[2]} (${targetUser})`, inline: true },
        { name: 'New Weekly Wage', value: newWages.toLocaleString(), inline: true }
      )
      .setTimestamp();

    return { embeds: [embed] };
  }
};
