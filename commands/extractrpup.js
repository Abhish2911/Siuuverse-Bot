const { SlashCommandBuilder } = require('discord.js');
const { getData, appendData } = require('../utils/sheets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('extractrpup')
    .setDescription('Snapshot Player_Data into Training_Data'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rows = await getData(
      'Player_Data!A:Q',
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    if (rows.length <= 1) {
      return interaction.editReply({
        content: '❌ No player data found.'
      });
    }

    const timestamp = new Date().toISOString();

    const trainingRows = rows.slice(1).map(row => [
      row[0] || '',
      row[1] || '',
      row[2] || '',
      row[5] || '',
      row[6] || '',
      row[7] || '',
      row[8] || '',
      row[9] || '',
      row[10] || '',
      row[11] || '',
      row[12] || '',
      row[13] || '',
      row[14] || '',
      row[15] || '',
      row[16] || '',
      timestamp
    ]);

    await appendData(
      'Training_Data!A:P',
      trainingRows,
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    return interaction.editReply({
      content: `✅ Added ${trainingRows.length} player snapshots to Training_Data.`
    });
  }
};
