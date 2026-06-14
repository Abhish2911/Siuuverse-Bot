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

      rows.sort((a, b) =>
        String(a?.[0] || '').localeCompare(String(b?.[0] || ''))
      );

      rows.shift(); // Remove sheet header row

      for (const row of rows) {
        const [
          teamName = 'Unknown Team',
          players = '',
          shortName = '-',
          ,
          captainId = '',
          usersId = ''
        ] = row;

        const mentions = [captainId, usersId]
          .flatMap(value => String(value || '').split(/[\n,;|]+/))
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

      current = current.replace(
        '**Team Name (Short Name)**\n👥 Players: Players\n🏷️ Users: <@UsersID>\n\n',
        ''
      );

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
