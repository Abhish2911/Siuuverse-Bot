const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function clean(value) {
  return String(value || '').trim();
}

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function sortTeams(a, b) {
  // Sort by PTS (col 10), GD (col 9), GF (col 7)
  const ptsA = Number(a[10] || 0);
  const ptsB = Number(b[10] || 0);
  if (ptsB !== ptsA) return ptsB - ptsA;

  const gdA = Number(a[9] || 0);
  const gdB = Number(b[9] || 0);
  if (gdB !== gdA) return gdB - gdA;

  const gfA = Number(a[7] || 0);
  const gfB = Number(b[7] || 0);
  return gfB - gfA;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uclstandings')
    .setDescription('Show UCL group standings')
    .addStringOption(option =>
      option
        .setName('group')
        .setDescription('Group name (A, B, C, etc.)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const rows = await cachedGetData('UCL_Coop_Group_Standings!A:K');

    if (!rows || rows.length <= 1) {
      return {
        content: '❌ No UCL standings data found.'
      };
    }

    // Group data by group letter
    const groups = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const group = clean(row[0]).toUpperCase();
      if (!group) continue;
      if (!groups[group]) groups[group] = [];
      groups[group].push(row);
    }

    // Sort each group by PTS, GD, GF
    for (const g in groups) {
      groups[g].sort(sortTeams);
    }

    // Collect all 3rd place teams across groups
    const thirdPlaceTeams = [];
    for (const g in groups) {
      if (groups[g].length >= 3) {
        thirdPlaceTeams.push({
          group: g,
          team: groups[g][2],
        });
      }
    }

    // Sort third place teams to find best two
    thirdPlaceTeams.sort((a, b) => sortTeams(a.team, b.team));

    // Best two third place teams qualify
    const bestTwoThird = thirdPlaceTeams.slice(0, 2);

    // Determine requested group
    const requestedGroup = clean(interaction.options.getString('group') || '').toUpperCase();

    // If group specified, show only that group, else show all groups
    const groupsToShow = requestedGroup ? { [requestedGroup]: groups[requestedGroup] || [] } : groups;

    if (requestedGroup && (!groups[requestedGroup] || groups[requestedGroup].length === 0)) {
      return {
        content: `❌ No standings found for Group ${requestedGroup}.`
      };
    }

    // Build table lines
    // Format: position + marker (🟢 or ?), short name or team, P, W, D, L, GF, GA, GD, PTS
    // Mark positions 1 and 2 with 🟢
    // Mark 3rd place with 🟢 if best two third-place teams, else ?

    // We'll build a diff-style table: 
    // Pos Marker Team          P  W  D  L  GF GA GD PTS
    //  1 🟢 TeamName          6  4  1  1 12  5  7 13

    const lines = [];
    const header = ' # TEAM    P  W  D  L   GD  PTS';

    for (const g of Object.keys(groupsToShow).sort()) {
      const groupTeams = groupsToShow[g];
      if (!groupTeams || groupTeams.length === 0) continue;

      for (let i = 0; i < groupTeams.length; i++) {
        const row = groupTeams[i];
        const pos = i + 1;

        const shortName = clean(row[1]) || clean(row[2]) || '';
        const p = row[3] || '0';
        const w = row[4] || '0';
        const d = row[5] || '0';
        const l = row[6] || '0';
        const gd = row[9] || '0';
        const pts = row[10] || '0';

        const team = shortName.padEnd(6, ' ');
        const pStr = String(p).padStart(2, ' ');
        const wStr = String(w).padStart(2, ' ');
        const dStr = String(d).padStart(2, ' ');
        const lStr = String(l).padStart(2, ' ');
        const gdStr = String(gd).padStart(4, ' ');
        const ptsStr = String(pts).padStart(3, ' ');

        const icon = pos === 1
          ? '👑'
          : pos === 2
            ? '🥈'
            : pos === 3
              ? '🥉'
              : '▫️';

        const line = `${icon} ${String(pos).padStart(2, ' ')} ${team} ${pStr} ${wStr} ${dStr} ${lStr} ${gdStr} ${ptsStr}`;

        if (pos <= 2) {
          lines.push(`+ ${line}`);
        } else if (pos === 3) {
          const isBestThird = bestTwoThird.some(t => t.group === g && t.team === row);
          lines.push(`${isBestThird ? '+' : '▫️'} ${line}`);
        } else {
          lines.push(`  ${line}`);
        }
      }
    }

    const description =
      `${safeEmoji(E.goal, '⚽')} ${requestedGroup ? `Group ${requestedGroup}` : 'UCL Group Stage'} Standings\n\n` +
      `${safeEmoji(E.up, '🟢')} Top 2 teams qualify automatically\n` +
      `${safeEmoji(E.up, '🟢')} Best 2 third-place teams qualify`;

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.UCL, '🏆')} UCL Group Standings`)
      .setDescription(description)
      .addFields(
        {
          name: `${safeEmoji(E.UCL, '🏆')} Groups`,
          value: Object.keys(groupsToShow)
            .sort()
            .map(groupKey => {
              const groupLines = [header];
              const groupTeams = groupsToShow[groupKey];

              for (let i = 0; i < groupTeams.length; i++) {
                const row = groupTeams[i];
                const pos = i + 1;
                const shortName = clean(row[1]) || clean(row[2]) || '';
                const p = row[3] || '0';
                const w = row[4] || '0';
                const d = row[5] || '0';
                const l = row[6] || '0';
                const gd = row[9] || '0';
                const pts = row[10] || '0';

                const icon = pos === 1 ? '👑' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '▫️';
                const line = `${icon} ${String(pos).padStart(2, ' ')} ${shortName.padEnd(6, ' ')} ${String(p).padStart(2, ' ')} ${String(w).padStart(2, ' ')} ${String(d).padStart(2, ' ')} ${String(l).padStart(2, ' ')} ${String(gd).padStart(4, ' ')} ${String(pts).padStart(3, ' ')}`;

                if (pos <= 2) groupLines.push(`+ ${line}`);
                else if (pos === 3) {
                  const isBestThird = bestTwoThird.some(t => t.group === groupKey && t.team === row);
                  groupLines.push(`${isBestThird ? '+' : '▫️'} ${line}`);
                } else groupLines.push(`  ${line}`);
              }

              return `**Group ${groupKey}**\n\`\`\`diff\n` + groupLines.join('\n') + '\n```';
            })
            .join('\n'),
          inline: false
        },
        {
          name: `${safeEmoji(E.correct, '✅')} Qualification`,
          value: 'Top 2 qualify automatically\nBest 2 third-place teams qualify',
          inline: false
        }
      )
      .setColor(0x0A1E5E)
      .setFooter({ text: `UCL Group Standings • ${safeEmoji(E.correct, '✅')} Qualified`})
      .setTimestamp();

    return {
      embeds: [embed]
    };
  }
};
