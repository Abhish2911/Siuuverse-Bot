const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

// OVR requirements and Market Values as in trainrp.js
const OVR_REQUIREMENTS = {
  75: 0,76: 5,77: 10,78: 15,79: 20,80: 30,81: 40,82: 50,83: 60,84: 70,85: 85,86: 100,87: 115,88: 130,89: 145,90: 165,91: 185,92: 205,93: 225,94: 245,95: 270,96: 300,97: 330,98: 360,99: 400
};

const MARKET_VALUES = {
  75:'500k',76:'650k',77:'800k',78:'1M',79:'1.3M',80:'1.7M',81:'2.2M',82:'2.8M',83:'3.5M',84:'4.5M',85:'6M',86:'8M',87:'11M',88:'15M',89:'20M',90:'27M',91:'35M',92:'45M',93:'60M',94:'80M',95:'110M',96:'150M',97:'200M',98:'275M',99:'400M'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refreshrp')
    .setDescription('Refresh all RP player OVRs and Market Values based on their TP.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    try {
      // Fetch player data from the sheet
      const rows = await getData('Player_Data!A2:Q', {
        spreadsheetId: process.env.RP_SHEET_ID,
      });

      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return await interaction.reply({
          content: 'No player data found.',
          ephemeral: true,
        });
      }

      let updatedRows = [];
      let updatedCount = 0;

      for (const row of rows) {
        // Defensive: ensure row has enough columns
        while (row.length < 17) row.push('');

        const totalTP = Number(row[16] || 0);
        const oldOVR = Number(row[2]);
        const oldMV = row[3];

        let newOVR = 75;
        for (const [ovr, required] of Object.entries(OVR_REQUIREMENTS)) {
          if (totalTP >= required) {
            newOVR = Number(ovr);
          }
        }

        const newMV = MARKET_VALUES[newOVR];

        let changed = false;
        if (oldOVR !== newOVR) {
          row[2] = String(newOVR);
          changed = true;
        }
        if (oldMV !== newMV) {
          row[3] = newMV;
          changed = true;
        }
        if (changed) updatedCount++;
        // Only columns A to P (0 to 15) are written back
        updatedRows.push(row.slice(0, 16));
      }

      // Update all rows in one call
      await updateData('Player_Data!A2:P', updatedRows, {
        spreadsheetId: process.env.RP_SHEET_ID,
      });

      const embed = new EmbedBuilder()
        .setTitle('🔄 RP Refresh Complete')
        .setDescription(
          `${emojis.success || '✅'} **Success!**\n\n` +
          `**Total Players Processed:** ${rows.length}\n` +
          `**Players Updated:** ${updatedCount}\n\n` +
          `All OVRs and Market Values have been refreshed based on current TP.`
        )
        .setColor('Green')
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in refreshrp:', err);
      await interaction.reply({
        content: '❌ An error occurred while refreshing RP data. Please try again later.',
        ephemeral: true,
      });
    }
  },
};