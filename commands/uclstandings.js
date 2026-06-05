const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uclstandings')
    .setDescription('Show UCL group standings')
    .addStringOption(option =>
      option
        .setName('group')
        .setDescription('Group name (A, B, C)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const rows = await cachedGetData('UCL_Coop_Group_Standings!A:K');

    if (!rows || rows.length <= 1) {
      return {
        content: '❌ No UCL standings data found.'
      };
    }

    const requestedGroup = clean(
      interaction.options.getString('group') || 'A'
    ).toUpperCase();

    const standings = rows
      .slice(1)
      .filter(r => clean(r[0]).toUpperCase() === requestedGroup)
      .sort((a, b) => Number(b[10] || 0) - Number(a[10] || 0));

    if (!standings.length) {
      return {
        content: `❌ No standings found for Group ${requestedGroup}.`
      };
    }

    const table = standings
      .map((r, i) => {
        const pos = String(i + 1).padStart(2, ' ');
        const team = clean(r[1] || r[2]).padEnd(4, ' ');

        return (
          `${pos}. ${team} | ` +
          `P:${r[3] || 0} ` +
          `W:${r[4] || 0} ` +
          `D:${r[5] || 0} ` +
          `L:${r[6] || 0} ` +
          `GD:${r[9] || 0} ` +
          `PTS:${r[10] || 0}`
        );
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.trophy, '🏆')} UCL Group ${requestedGroup} Standings`)
      .setDescription(`\`\`\`\n${table}\n\`\`\``)
      .setFooter({ text: 'SiuuVerse UCL' })
      .setTimestamp();

    return {
      embeds: [embed]
    };
  }
};
