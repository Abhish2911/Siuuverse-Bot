const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, getTeamColor, normalize } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const num = Number(String(value ?? '').replace('+', ''));
  return Number.isFinite(num) ? num : 0;
}

function rankIcon(index, total) {
  if (index === 0) return '👑';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  if (index >= total - 2) return '🔻';
  return '▫️';
}

function formatGD(value) {
  const num = toNumber(value);
  return num > 0 ? `+${num}` : String(num);
}

function buildStandingsSummary(rows) {
  const leader = rows[0];
  const second = rows[1];
  const third = rows[2];
  const bottom = rows[rows.length - 1];

  const formatTeamLine = row => {
    if (!row) return 'N/A';
    return `\`${clean(row[1])}\` • ${row[9] || 0} pts`;
  };

  return {
    teams: rows.length,
    leader: formatTeamLine(leader),
    second: formatTeamLine(second),
    third: formatTeamLine(third),
    bottom: formatTeamLine(bottom)
  };
}

function buildStandingsDescription(summary) {
  return (
    `${safeEmoji(E.trophy_animated, safeEmoji(E.PL, '🏆'))} **League Table Overview**\n` +
    `Current coop league standings sorted by points, goal difference and goals scored.\n\n` +
    `${safeEmoji(E.team, '👥')} **Teams:** ${summary.teams}\n` +
    `${safeEmoji(E.goldenBoot, '👑')} **Leader:** ${summary.leader}\n` +
    `${safeEmoji(E.runnerUp, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}\n` +
    `🔻 **Bottom:** ${summary.bottom}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show coop league standings'),

  async execute() {
    const [standings, teams] = await Promise.all([
      cachedGetData('Standings!A:J'),
      cachedGetData('Teams!A:H')
    ]);

    if (!Array.isArray(standings) || standings.length <= 1) {
      return { content: `${safeEmoji(E.wrong, '❌')} No standings data found.` };
    }

    const shortMap = {};
    teams.slice(1).forEach(row => {
      const teamName = row[0];
      const shortName = row[2];
      if (teamName && shortName) {
        shortMap[normalize(teamName)] = String(shortName).trim().toUpperCase();
      }
    });

    const rows = standings
      .slice(1)
      .filter(row => row[1])
      .sort((a, b) =>
        toNumber(b[9]) - toNumber(a[9]) ||
        toNumber(b[8]) - toNumber(a[8]) ||
        toNumber(b[6]) - toNumber(a[6]) ||
        String(a[1]).localeCompare(String(b[1]))
      );

    const pad = (value, len, dir = 'end') => {
      const str = String(value ?? '');
      return dir === 'start' ? str.padStart(len, ' ') : str.padEnd(len, ' ');
    };

    const table = rows.map((row, index) => {
      const pos = pad(index + 1, 2, 'start');
      const fullTeam = normalize(row[1]);
      const team = pad(shortMap[fullTeam] || String(row[1] || '').slice(0, 6).toUpperCase() || 'N/A', 6);
      const p = pad(row[2] || 0, 2, 'start');
      const w = pad(row[3] || 0, 2, 'start');
      const d = pad(row[4] || 0, 2, 'start');
      const l = pad(row[5] || 0, 2, 'start');
      const gd = pad(formatGD(row[8]), 4, 'start');
      const pts = pad(row[9] || 0, 3, 'start');
      const line = `${rankIcon(index, rows.length)} ${pos} ${team} ${p} ${w} ${d} ${l} ${gd} ${pts}`;

      if (index < 3) return `+ ${line}`;
      if (index >= rows.length - 2) return `- ${line}`;
      return `  ${line}`;
    }).join('\n');

    const header = '      # TEAM    P  W  D  L   GD  PTS';
    const summary = buildStandingsSummary(rows);
    const leader = rows[0]?.[1] || '';
    const bottomZone = rows.slice(-3).map(row => row[1]).filter(Boolean).join('\n') || 'N/A';

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.trophy_animated, safeEmoji(E.PL, '🏆'))} Coop League Table`)
          .setDescription(buildStandingsDescription(summary))
          .addFields(
            { name: `${safeEmoji(E.stats || E.rank, '📊')} Table`, value: `\`\`\`diff\n${header}\n${table || 'No teams'}\n\`\`\``, inline: false },
            { name: '🔻 Bottom Zone', value: bottomZone, inline: false }
          )
          .setColor(getTeamColor(teams, leader, 0x5865F2))
          .setFooter({ text: 'Coop league standings • 👑 Leader • 🥈 2nd • 🥉 3rd • 🔻 Bottom 3' })
      ]
    };
  }
};
