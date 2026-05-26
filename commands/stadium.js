const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const { invalidateSheetCache, sendAuditLog } = require('../utils/helpers');

function isCaptainOfTeam(row, userId) {
  return String(row?.[4] || '').trim() === String(userId).trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stadium')
    .setDescription('Set your team stadium name captain only')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Your stadium name')
        .setRequired(true)
    ),

  async execute(interaction) {
    const stadiumName = interaction.options.getString('name').trim();

    if (stadiumName.length < 2) {
      return { content: '❌ Stadium name is too short.' };
    }

    if (stadiumName.length > 80) {
      return { content: '❌ Stadium name must be 80 characters or less.' };
    }

    const teams = await getData('Teams!A:G');
    const rows = Array.isArray(teams) ? teams.slice(1) : [];

    const teamIndex = rows.findIndex(row => isCaptainOfTeam(row, interaction.user.id));

    if (teamIndex === -1) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🚫 Captain Only')
            .setDescription('Only the registered captain of a team can set the stadium name.')
            .setColor(0xE74C3C)
        ]
      };
    }

    while (rows[teamIndex].length < 7) rows[teamIndex].push('');

    const teamName = rows[teamIndex][0] || 'Unknown Team';
    const shortName = rows[teamIndex][2] || 'N/A';
    const oldStadium = rows[teamIndex][6] || 'Not set';

    rows[teamIndex][6] = stadiumName;

    await updateData('Teams!A2:G', rows);
    invalidateSheetCache(['Teams!', 'Teams!A:F', 'Teams!A:G']);

    sendAuditLog(interaction, {
      title: '🏟️ Stadium Updated',
      description: `**${teamName}** stadium updated.`,
      color: 0x3498DB,
      fields: [
        { name: 'Team', value: `${teamName} (${shortName})`, inline: true },
        { name: 'Old Stadium', value: String(oldStadium), inline: true },
        { name: 'New Stadium', value: stadiumName, inline: true },
        { name: 'Captain', value: `<@${interaction.user.id}>`, inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('🏟️ Stadium Updated')
          .setDescription(`**${teamName}** now plays at **${stadiumName}**.`)
          .addFields(
            { name: 'Team', value: `${teamName} (${shortName})`, inline: true },
            { name: 'Old Stadium', value: String(oldStadium), inline: true },
            { name: 'New Stadium', value: stadiumName, inline: true }
          )
          .setColor(0x2ECC71)
      ]
    };
  }
};