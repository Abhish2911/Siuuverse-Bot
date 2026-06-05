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

    const description =
      `⚽ ${requestedGroup ? `Group ${requestedGroup}` : 'UCL Group Stage'} Standings\n\n` +
      `${safeEmoji(E.up, '🟢')} Top 2 teams qualify automatically\n` +
      `${safeEmoji(E.up, '🟢')} Best 2 third-place teams qualify`;

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.UCL, '🏆')} UCL Group Standings`)
      .setDescription(description)
      .addFields(
        {
          name: `${safeEmoji(E.UCL, '🏆')} Groups`,
          value: 'See group tables below',
          inline: false
        },
        ...Object.keys(groupsToShow)
          .sort()
          .map(groupKey => {
            const groupTeams = groupsToShow[groupKey];

            const pad = (value, len, dir = 'end') => {
              const str = String(value ?? '');
              return dir === 'start'
                ? str.padStart(len, ' ')
                : str.padEnd(len, ' ');
            };

            const groupTable = groupTeams.map((row, index) => {
              const pos = pad(index + 1, 2, 'start');
              const team = pad(clean(row[1]) || clean(row[2]), 6);
              const p = pad(row[3] || 0, 2, 'start');
              const w = pad(row[4] || 0, 2, 'start');
              const d = pad(row[5] || 0, 2, 'start');
              const l = pad(row[6] || 0, 2, 'start');
              const gd = pad(row[9] || 0, 4, 'start');
              const pts = pad(row[10] || 0, 3, 'start');

              const icon =
                index === 0 ? '👑' :
                index === 1 ? '🥈' :
                index === 2 ? '🥉' :
                '▫️';

              const line = `${icon} ${pos} ${team} ${p} ${w} ${d} ${l} ${gd} ${pts}`;

              if (index < 2) return `+ ${line}`;

              if (index === 2) {
                const isBestThird = bestTwoThird.some(
                  t => t.group === groupKey && t.team === row
                );

                return `${isBestThird ? '+' : ' '} ${line}`;
              }

              return `  ${line}`;
            }).join('\n');

            return {
              name: `🏆 Group ${groupKey}`,
              value:
                '```diff\n' +
                '      # TEAM    P  W  D  L   GD  PTS\n' +
                groupTable +
                '\n```',
              inline: false
            };
          }),
        {
          name: `${safeEmoji(E.correct, '🟢')} Qualification`,
          value:
            `${safeEmoji(E.up, '🟢')} Top 2 qualify automatically\n` +
            `${safeEmoji(E.up, '🟢')} Best 2 third-place teams qualify`,
          inline: false
        }
      )
      .setColor(0x0A1E5E)
      .setFooter({ text: 'UCL Group Standings • + Qualified Teams' })
      .setTimestamp();

    return {
      embeds: [embed]
    };
  }
};
