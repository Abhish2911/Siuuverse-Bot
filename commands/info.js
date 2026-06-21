const { SlashCommandBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');

const TEAMS_SHEET_RANGE = 'Teams!A:Z';

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

      rows.shift(); // Remove sheet header row BEFORE sorting

      rows.sort((a, b) =>
        String(a?.[0] || '').localeCompare(String(b?.[0] || '') )
      );

      const messages = [];
      let current = '# 🏆 Team Information\n\n';

      let teamCount = 0;

      for (const row of rows) {
        const [
          teamName = 'Unknown Team',
          players = '',
          shortName = '-',
          stadiumName = '-',
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
          `🏟️ Stadium: ${stadiumName || 'N/A'}\n` +
          `🏷️ Users: ${mentions || 'No users linked'}\n\n`;

        if (teamCount >= 9 || (current + section).length > 1900) {
          messages.push(current);
          current = section;
          teamCount = 1;
        } else {
          current += section;
          teamCount++;
        }
      }

      if (current.trim()) messages.push(current);

      if (!messages.length) {
        return { content: '❌ No team data found.' };
      }

      for (let i = 1; i < messages.length; i++) {
        await interaction.channel.send({
          content: messages[i],
          allowedMentions: { parse: [] }
        });
      }

      return {
        content: messages[0],
        allowedMentions: { parse: [] }
      };
    } catch (error) {
      console.error('Info command error:', error);
      return { content: '❌ Failed to fetch team information.' };
    }
  }
};
