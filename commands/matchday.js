const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  cachedGetData,
  getAllowedMatchday,
  getTeamColor,
  getFixtureMatchday
} = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

const hasScore = (row) => {
  return row[4] !== '' && row[4] !== undefined &&
    row[5] !== '' && row[5] !== undefined;
};

const shortTeam = (row, home = true) => {
  if (home) return String(row[7] || row[2] || 'HOME').trim();
  return String(row[8] || row[3] || 'AWAY').trim();
};

const resultLetter = (row) => {
  if (row[6]) return String(row[6]).trim();

  const hg = toNumber(row[4]);
  const ag = toNumber(row[5]);

  if (hg > ag) return 'H';
  if (hg < ag) return 'A';
  return 'D';
};

const resultIcon = result => {
  if (result === 'H' || result === 'A' || result === 'W') return safeEmoji(E.win, '✅');
  if (result === 'D') return safeEmoji(E.draw, '🤝');
  if (result === 'L') return safeEmoji(E.lose, '❌');
  return safeEmoji(E.equal, '➖');
};

const buildProgressBar = (completed, total) => {
  const size = 12;
  const filled = total ? Math.round((completed / total) * size) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
};

const lineLimit = (lines, max = 8) => {
  if (lines.length <= max) return lines.join('\n');
  return [...lines.slice(0, max), `+${lines.length - max} more...`].join('\n');
};

const findNextMatchdayRows = (fixtures, activeMD) => {
  const allMatchdays = [...new Set(
    fixtures
      .slice(1)
      .filter(row => row?.[0])
      .map(row => getFixtureMatchday(row[0]))
      .filter(Boolean)
  )];

  const currentIndex = allMatchdays.findIndex(md => String(md) === String(activeMD));
  const nextMD = currentIndex >= 0
    ? allMatchdays[currentIndex + 1]
    : null;

  if (!nextMD) {
    return { matchday: null, rows: [] };
  }

  return {
    matchday: nextMD,
    rows: fixtures
      .slice(1)
      .filter(row => getFixtureMatchday(row[0]) === nextMD)
  };
};

const makeCompletedLine = (row) => {
  const matchNo = String(row[0] || '-').trim();
  const home = shortTeam(row, true);
  const away = shortTeam(row, false);
  const score = `${row[4]}-${row[5]}`;
  const result = resultLetter(row);

  return `**${matchNo}** • \`${home}\` **${score}** \`${away}\` ${resultIcon(result)}`;
};

const makeRemainingLine = (row) => {
  const matchNo = String(row[0] || '-').trim();
  const home = shortTeam(row, true);
  const away = shortTeam(row, false);

  return `**${matchNo}** • \`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\``;
};

const makeNextLine = (row, index) => {
  const matchNo = String(row[0] || '-').trim();
  const home = shortTeam(row, true);
  const away = shortTeam(row, false);

  return `${index + 1}. ${safeEmoji(E.fire, '🔥')} **${matchNo}** \`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\``;
};

const buildMatchdaySummary = (activeMD, rows, completed, remaining, percent, nextMatchday) => {
  const firstCompleted = completed[0];
  const firstRemaining = remaining[0];

  const formatFixture = row => {
    if (!row) return 'N/A';
    const home = shortTeam(row, true);
    const away = shortTeam(row, false);

    if (hasScore(row)) {
      return `\`${home}\` ${row[4]}-${row[5]} \`${away}\``;
    }

    return `\`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\``;
  };

  return {
    activeMD: String(activeMD),
    total: rows.length,
    completed: completed.length,
    remaining: remaining.length,
    percent,
    latestResult: formatFixture(firstCompleted),
    nextFixture: formatFixture(firstRemaining),
    nextMatchday: nextMatchday.matchday ? `MD ${nextMatchday.matchday}` : 'N/A'
  };
};

const buildMatchdayDescription = summary => {
  return (
    `${safeEmoji(E.calendar, '📅')} **Current Active Matchday**\n` +
    `Automatic league matchday tracker based on played and remaining fixtures from the Fixtures.\n\n` +
    `${safeEmoji(E.calendar, '📅')} **Matchday:** ${summary.activeMD}\n` +
    `${safeEmoji(E.played, '🎮')} **Total Fixtures:** ${summary.total}\n` +
    `${safeEmoji(E.correct, '✅')} **Completed:** ${summary.completed}\n` +
    `${safeEmoji(E.missing, '➖')} **Remaining:** ${summary.remaining}\n` +
    `${safeEmoji(E.fire, '🔥')} **Progress:** ${summary.percent}%\n\n` +
    `${safeEmoji(E.correct, '✅')} **Latest Result:** ${summary.latestResult}\n` +
    `${safeEmoji(E.missing, '➖')} **Next To Play:** ${summary.nextFixture}\n` +
    `${safeEmoji(E.fire, '🔥')} **Upcoming Matchday:** ${summary.nextMatchday}`
  );
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchday')
    .setDescription('Show active matchday for League, FA Cup, Carabao Cup or UCL')
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription('Competition')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const competition =
      interaction.options?.getString('competition') || 'league';

    const sheetMap = {
      league: 'Fixtures!A:I',
      fa: 'FA_Cup_Fixtures!A:I',
      carabao: 'Carabao_Cup_Fixtures!A:I',
      ucl: 'UCL_Coop_Fixtures!A:I'
    };

    const fixtures = await cachedGetData(sheetMap[competition] || sheetMap.league);
    const teams = await cachedGetData('Teams!A:H');

    if (!Array.isArray(fixtures) || fixtures.length <= 1) {
      return { content: `${safeEmoji(E.wrong, '❌')} Fixtures is empty.` };
    }

    const allowedMD = getAllowedMatchday(fixtures);

    if (!allowedMD) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.correct, '✅')} League Complete`)
            .setDescription('All fixtures appear to be completed.')
            .setColor(0x2ECC71)
        ]
      };
    }

    const activeMD = String(allowedMD).trim();

    const rows = fixtures
      .slice(1)
      .filter(r => getFixtureMatchday(r?.[0]) === activeMD);

    if (!rows.length) {
      return { content: `${safeEmoji(E.wrong, '❌')} Could not find active matchday fixtures.` };
    }

    const completed = rows.filter(row => hasScore(row));
    const remaining = rows.filter(row => !hasScore(row));
    const progress = buildProgressBar(completed.length, rows.length);
    const percent = rows.length ? Math.round((completed.length / rows.length) * 100) : 0;

    const completedLines = completed.map(row => makeCompletedLine(row));
    const remainingLines = remaining.map(row => makeRemainingLine(row));
    const nextMatchday = findNextMatchdayRows(fixtures, activeMD);
    const nextLines = nextMatchday.rows
      .slice(0, 10)
      .map((row, index) => makeNextLine(row, index));
    const summary = buildMatchdaySummary(activeMD, rows, completed, remaining, percent, nextMatchday);

    const embedColor = remaining.length
      ? getTeamColor(teams, rows[0]?.[2] || rows[0]?.[3] || '', 0xF1C40F)
      : 0x2ECC71;

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.calendar, '📅')} ${competition.toUpperCase()} • Active Matchday ${activeMD}`)
      .setDescription(buildMatchdayDescription(summary))
      .addFields(
        {
          name: `${safeEmoji(E.stats || E.rank, '📊')} Progress`,
          value:
            `${safeEmoji(E.played, '🎮')} **Bar:** ${progress}\n` +
            `${safeEmoji(E.correct, '✅')} **Completed:** ${completed.length}/${rows.length}\n` +
            `${safeEmoji(E.missing, '➖')} **Remaining:** ${remaining.length}\n` +
            `📌 **Competition:** ${competition.toUpperCase()}\n🎛️ Use /matchday competition:<league|fa|carabao|ucl>`,
          inline: false
        },
        {
          name: `${safeEmoji(E.correct, '✅')} Completed Matches`,
          value: completedLines.length ? lineLimit(completedLines, 8) : 'None yet',
          inline: false
        },
        {
          name: `${safeEmoji(E.missing, '➖')} Remaining Matches`,
          value: remainingLines.length ? lineLimit(remainingLines, 8) : 'None',
          inline: false
        },
        {
          name: `${safeEmoji(E.fire, '🔥')} Next Matchday Fixtures${nextMatchday.matchday ? ` — MD ${nextMatchday.matchday}` : ''}`,
          value: nextLines.length
            ? nextLines.join('\n')
            : `${safeEmoji(E.correct, '✅')} No upcoming matchday fixtures found after MD ${activeMD}.`,
          inline: false
        }
      )
      .setColor(embedColor)
      .setFooter({ text: 'Matchday • Auto-detected from Fixtures • Live progress overview' });

    return {
      content: `${safeEmoji(E.calendar, '📅')} **Current matchday overview**`,
      embeds: [embed]
    };
  }
};
