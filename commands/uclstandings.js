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

const { MessageEmbed } = require('discord.js');
const { getSheet } = require('../lib/sheets');
const { getRankIcon } = require('./standings');

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

module.exports = {
  name: 'uclstandings',
  description: 'Show the current UCL group standings.',
  args: false,
  usage: '[group]',
  async execute(message, args) {
    // Determine group
    let group = (args[0] || '').toUpperCase();
    if (!GROUPS.includes(group)) group = 'A';

    // Fetch all standings data
    const sheet = await getSheet('UCL_Coop_Group_Standings');
    // Read all rows (skip header row)
    const rows = await sheet.getRows();
    // Each row: [Group, Team, P, W, D, L, GF, GA, GD, PTS]

    // Group teams by group
    const groupMap = {};
    for (const row of rows) {
      const g = row[0];
      if (!GROUPS.includes(g)) continue;
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(row);
    }

    // Sort teams in each group
    for (const g of GROUPS) {
      if (!groupMap[g]) continue;
      groupMap[g] = groupMap[g]
        .sort((a, b) =>
          Number(b[10] || 0) - Number(a[10] || 0) ||
          Number(b[9] || 0) - Number(a[9] || 0) ||
          Number(b[7] || 0) - Number(a[7] || 0)
        );
    }

    // Collect all 3rd place teams
    let thirdPlaceTeams = [];
    for (const g of GROUPS) {
      if (!groupMap[g] || groupMap[g].length < 3) continue;
      thirdPlaceTeams.push({
        group: g,
        row: groupMap[g][2],
      });
    }
    // Sort third-place teams by PTS, GD, GF
    thirdPlaceTeams = thirdPlaceTeams.sort((a, b) =>
      Number(b.row[10] || 0) - Number(a.row[10] || 0) ||
      Number(b.row[9] || 0) - Number(a.row[9] || 0) ||
      Number(b.row[7] || 0) - Number(a.row[7] || 0)
    );
    // Best 2 third-place teams
    const bestThirds = thirdPlaceTeams.slice(0, 2).map(t => `${t.group}:${t.row[1]}`);

    // Prepare standings table for the selected group
    const teams = groupMap[group] || [];
    const header = '      # TEAM    P  W  D  L   GD  PTS';
    const tableRows = teams.map((row, idx) => {
      const rankIcon = getRankIcon(idx);
      const team = row[1];
      const P = row[2] || '0';
      const W = row[3] || '0';
      const D = row[4] || '0';
      const L = row[5] || '0';
      const GD = row[9] || '0';
      const PTS = row[10] || '0';
      const line = `${rankIcon} ${team.padEnd(7)} ${P.padStart(2)} ${W.padStart(2)} ${D.padStart(2)} ${L.padStart(2)}  ${GD.padStart(3)} ${PTS.padStart(3)}`;
      // Qualification formatting
      if (idx < 2) return `+ ${line}`;
      if (idx === 2) {
        // If this 3rd place is among best two third-place teams, mark as qualified
        const id = `${group}:${team}`;
        if (bestThirds.includes(id)) return `+ ${line}`;
        return `? ${line}`;
      }
      return `  ${line}`;
    });

    // Leader info
    const leader = teams[0] ? teams[0][1] : 'N/A';
    // Table block
    const table = ['```diff', header, ...tableRows, '```'].join('\n');

    // Summary
    const summary =
      `**Group ${group} Standings**\n` +
      `**Leader:** ${leader}\n` +
      `**Teams:** ${teams.length}`;

    // Embed
    const embed = new MessageEmbed()
      .setTitle(`UCL Group ${group}`)
      .addField('Standings', table, false)
      .addField('Summary', summary, false)
      .addField('🟢 Qualification',
        'Top 2 qualify automatically\n' +
        'Best 2 third-place teams qualify',
        false
      )
      .setFooter('UCL Group Standings • 🟢 Qualified • ? Third Place Contender');

    await message.channel.send({ embeds: [embed] });
  }
};
