const { SlashCommandBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');

const TEAMS_SHEET_RANGE = 'Teams!A:F';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show all teams and their players'),

  async execute(interaction) {
    try {
      const rows = await cachedGetData(TEAMS_SHEET_RANGE);

      if (!rows?.length) {
        return { content: '❌ No team data found.' };
      }

      const messages = [];
      let current = '# 🏆 Team Information\n\n';

      for (const row of rows) {
        const [
          teamName = 'Unknown Team',
          players = '',
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
          `👥 Players: ${players || 'No players listed'}\n` +
          `🏷️ Users: ${mentions || 'No users linked'}\n\n`;

        if ((current + section).length > 1900) {
          messages.push(current);
          current = section;
        } else {
          current += section;
        }
      }

      if (current.trim()) messages.push(current);

      if (!messages.length) {
        return { content: '❌ No team data found.' };
      }

      for (let i = 1; i < messages.length; i++) {
        await interaction.channel.send({
          content: messages[i]
        });
      }

      return { content: messages[0] };
    } catch (error) {
      console.error('Info command error:', error);
      return { content: '❌ Failed to fetch team information.' };
    }
  }
};
