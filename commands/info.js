const { SlashCommandBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');

const TEAMS_SHEET_RANGE = 'Teams!A:F';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show all teams and their players'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const rows = await cachedGetData(TEAMS_SHEET_RANGE);

      if (!rows?.length) {
        return interaction.editReply('❌ No team data found.');
      }

      const messages = [];
      let current = '# 🏆 Team Information\n\n';

      for (const row of rows) {
        const [
          teamName = 'Unknown Team',
          ,
          shortName = '-',
          ,
          ,
          usersId = ''
        ] = row;

        const mentions = usersId
          .split(',')
          .map(id => id.trim())
          .filter(Boolean)
          .map(id => `<@${id}>`)
          .join(', ');

        const section =
          `**${teamName} (${shortName})**\n` +
          `👥 ${mentions || 'No players'}\n\n`;

        if ((current + section).length > 1900) {
          messages.push(current);
          current = section;
        } else {
          current += section;
        }
      }

      if (current.trim()) messages.push(current);

      await interaction.editReply(messages[0]);

      for (let i = 1; i < messages.length; i++) {
        await interaction.followUp({
          content: messages[i]
        });
      }
    } catch (error) {
      console.error('Info command error:', error);
      await interaction.editReply('❌ Failed to fetch team information.');
    }
  }
};