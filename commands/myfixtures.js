const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');
const {
  cachedGetData,
  cleanId,
  getTeamColor,
  normalize,
  splitList,
  createPaginationButtons,
  createCompetitionDropdown
} = require('../utils/helpers');
const { clean: sharedClean } = require('../utils/competitionHelpers');
const E = require('../utils/emojis');

const LEAGUE_PAGE_SIZE = 4;
const CUP_PAGE_SIZE = 2;
const RESERVE_SHEET_RANGE = 'Reserve!A:F';
let derbyMapCache = null;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return sharedClean(value);
}

function normalizeMatchNo(value) {
  return clean(value).toUpperCase();
}

function isDerbyFixture(home, away) {
  if (!Array.isArray(derbyMapCache)) return false;

  const h = normalize(home);
  const a = normalize(away);

  return derbyMapCache.some(d => {
    const t1 = normalize(d.team1);
    const t2 = normalize(d.team2);

    return (
      (h === t1 && a === t2) ||
      (h === t2 && a === t1)
    );
  });
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      reserveLabel: 'FA Cup',
      matchNoIndex: 1,
      dateIndex: 2,
      homeIndex: 3,
      awayIndex: 4,
      hgIndex: 5,
      agIndex: 6,
      resultIndex: 7,
      homeShortIndex: 8,
      awayShortIndex: 9,
      statusIndex: 10
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      reserveLabel: 'Carabao Cup',
      matchNoIndex: 1,
      dateIndex: 2,
      homeIndex: 3,
      awayIndex: 4,
      hgIndex: 5,
      agIndex: 6,
      resultIndex: 7,
      homeShortIndex: 8,
      awayShortIndex: 9,
      statusIndex: 10
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      reserveLabel: 'UCL',
      matchNoIndex: 0,
      dateIndex: 1,
      homeIndex: 2,
      awayIndex: 3,
      hgIndex: 4,
      agIndex: 5,
      resultIndex: 6,
      homeShortIndex: 7,
      awayShortIndex: 8,
      statusIndex: 9
    };
  }

  return {
    key: 'league',
    label: 'League',
    fixturesRange: 'Fixtures!A:J',
    reserveLabel: 'League',
    matchNoIndex: 0,
    dateIndex: 1,
    homeIndex: 2,
    awayIndex: 3,
    hgIndex: 4,
    agIndex: 5,
    resultIndex: 6,
    homeShortIndex: 7,
    awayShortIndex: 8,
    statusIndex: 9
  };
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function hasScore(row, config) {
  return row?.[config.hgIndex] !== '' && row?.[config.hgIndex] !== undefined &&
    row?.[config.agIndex] !== '' && row?.[config.agIndex] !== undefined;
}

function matchdayOf(row, config) {
  const matchNo = String(row?.[config.matchNoIndex] || '').trim();
  return matchNo.includes('.') ? matchNo.split('.')[0].trim() : matchNo || '-';
}

function getTeamFromUserId(teams, userId) {
  const id = cleanId(userId);
  if (!id || !Array.isArray(teams)) return null;

  for (const row of teams.slice(1)) {
    const teamName = String(row[0] || '').trim();
    const shortName = String(row[2] || teamName).trim();
    const logo = String(row[3] || '').trim();
    const captainId = cleanId(row[4]);
    const memberIds = splitList(row[5]).map(cleanId);
    const stadium = String(row[6] || 'Not set').trim();
    const color = String(row[7] || '').trim();

    if (captainId === id || memberIds.includes(id)) {
      return { teamName, shortName, logo, stadium, color };
    }
  }

  return null;
}

function getTeamFromPlayerName(teams, playerName) {
  const key = normalize(playerName);
  if (!key || !Array.isArray(teams)) return null;

  for (const row of teams.slice(1)) {
    const teamName = String(row[0] || '').trim();
    const shortName = String(row[2] || teamName).trim();
    const logo = String(row[3] || '').trim();
    const stadium = String(row[6] || 'Not set').trim();
    const color = String(row[7] || '').trim();
    const players = splitList(row[1]);

    if (players.some(p => normalize(p) === key)) {
      return { teamName, shortName, logo, stadium, color };
    }
  }

  return null;
}

function getRecord(standings, teamName, shortName) {
  const empty = { wins: 0, draws: 0, losses: 0, gd: 0, pts: 0 };
  if (!Array.isArray(standings)) return empty;

  const key = normalize(teamName);
  const shortKey = normalize(shortName);
  const row = standings.slice(1).find(r => normalize(r[1]) === key || normalize(r[1]) === shortKey);

  if (!row) return empty;

  return {
    wins: Number(row[3] || 0) || 0,
    draws: Number(row[4] || 0) || 0,
    losses: Number(row[5] || 0) || 0,
    gd: toNumber(row[8]),
    pts: toNumber(row[9])
  };
}

function getOpponentCaptainMention(teams, opponentTeam) {
  const key = normalize(opponentTeam);
  const row = Array.isArray(teams)
    ? teams.slice(1).find(r => normalize(r[0]) === key || normalize(r[2]) === key)
    : null;

  const captainId = cleanId(row?.[4]);
  return captainId ? `<@${captainId}>` : 'Not linked';
}

function getReserveMatches(reserveRows, team, competitionLabel) {
  if (!Array.isArray(reserveRows) || reserveRows.length <= 1 || !team) return [];

  const teamKey = normalize(team.teamName);
  const shortKey = normalize(team.shortName);
  const targetCompetition = clean(competitionLabel).toLowerCase();

  return reserveRows
    .slice(1)
    .filter(row => row && row.length)
    .filter(row => clean(row[0]).toLowerCase() === targetCompetition)
    .filter(row => {
      const home = normalize(row[2]);
      const away = normalize(row[3]);
      return home === teamKey || home === shortKey || away === teamKey || away === shortKey;
    })
    .map(row => ({
      matchNo: String(row[1] || '-').trim(),
      home: String(row[2] || 'HOME').trim(),
      away: String(row[3] || 'AWAY').trim(),
      by: clean(row[4]),
      playerName: clean(row[5])
    }));
}

function getResultText(row, teamName, config) {
  if (!hasScore(row, config)) return 'Pending';

  const home = normalize(row[config.homeIndex]);
  const away = normalize(row[config.awayIndex]);
  const hg = Number(row[config.hgIndex]);
  const ag = Number(row[config.agIndex]);
  const key = normalize(teamName);

  if (hg === ag) return 'Draw';
  if (home === key) return hg > ag ? 'Win' : 'Loss';
  if (away === key) return ag > hg ? 'Win' : 'Loss';
  return 'Played';
}

function buildFixtureLine(row, team, currentMatchNo, config) {
  const matchNo = String(row[config.matchNoIndex] || '-').trim();
  const date = String(row[config.dateIndex] || 'TBD').trim();
  const home = String(row[config.homeIndex] || 'HOME').trim();
  const away = String(row[config.awayIndex] || 'AWAY').trim();
  const hg = row[config.hgIndex];
  const ag = row[config.agIndex];
  const isCurrent = String(row[config.matchNoIndex] || '') === String(currentMatchNo || '');
  const result = getResultText(row, team.teamName, config);
  const played = hasScore(row, config);
  const derby = isDerbyFixture(home, away);
  const icon = played ? safeEmoji(E.correct, '✅') : isCurrent ? safeEmoji(E.fire, '🔥') : safeEmoji(E.missing, '➖');
  const statusEmoji = played
    ? result === 'Win'
      ? safeEmoji(E.win, '✅')
      : result === 'Draw'
        ? safeEmoji(E.draw, '🤝')
        : result === 'Loss'
          ? safeEmoji(E.lose, '❌')
          : safeEmoji(E.correct, '✅')
    : safeEmoji(E.missing, '➖');

  const scoreText = played ? `**${hg}-${ag}**` : '**Pending**';

  return (
    `${safeEmoji(E.doubleArrow, '➡️')} **${matchNo}**${derby ? ` ${safeEmoji(E.fire, '🔥')} DERBY` : ''} • ${safeEmoji(E.calendar, '📅')} ${date}\n` +
    `> \`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\` — ${scoreText}\n` +
    `> ${icon} ${statusEmoji} **${played ? result : 'Pending'}**`
  );
}

function buildFixtureSummary(team, rows, upcoming, played, reserveMatches, current, config) {
  const currentMatchNo = current ? clean(current[config.matchNoIndex]) : 'None';
  const currentPairing = current
    ? `\`${clean(current[config.homeShortIndex] || current[config.homeIndex])}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(current[config.awayShortIndex] || current[config.awayIndex])}\``
    : 'All fixtures completed';

  return {
    total: rows.length,
    upcoming: upcoming.length,
    played: played.length,
    reserved: reserveMatches.length,
    currentMatchNo,
    currentPairing,
    competition: config.label,
    shortName: team.shortName || team.teamName,
    stadium: team.stadium || 'Not set'
  };
}

function buildFixtureDescription(team, summary, record, currentBlock, reserveBlock, pageRows, page, orderedRows) {
  return (
    `# ${summary.shortName}\n` +
    `${safeEmoji(E.blueIcon, '🔵')} **Team:** ${team.teamName}\n` +
    `🏟️ **Stadium:** ${summary.stadium}\n` +
    `${safeEmoji(E.trophy_animated || E.calendar, '🏆')} **Competition:** ${summary.competition}\n` +
    `${summary.competition === 'League'
      ? `${safeEmoji(E.played, '🎮')} **Record:** ${record.wins}W / ${record.draws}D / ${record.losses}L\n${safeEmoji(E.goal, '⚽')} **GD:** ${record.gd} | **Pts:** ${record.pts}\n`
      : ''}` +
    `${safeEmoji(E.played, '🎮')} **Total:** ${summary.total} • ${safeEmoji(E.missing, '➖')} **Upcoming:** ${summary.upcoming} • ${safeEmoji(E.correct, '✅')} **Played:** ${summary.played} • ${safeEmoji(E.lock, '🔒')} **Reserved:** ${summary.reserved}\n` +
    `${safeEmoji(E.calendar, '📅')} **Current Match:** ${summary.currentMatchNo}\n` +
    `${safeEmoji(E.Badge || E.info, '📌')} **Current Pairing:** ${summary.currentPairing}\n\n` +
    `${currentBlock}` +
    `${reserveBlock}` +
    `${safeEmoji(E.calendar, '📅')} **Showing ${pageRows.length ? page * pageRows.length + 1 : 0}-${page * pageRows.length + pageRows.length} of ${orderedRows.length} fixtures**`
  );
}

async function buildMyFixtures(interaction, page = 0, targetType = 'self', targetValue = '', competitionKey = 'league') {
  const config = getCompetitionConfig(competitionKey);
  const pageSize = config.key === 'league'
    ? LEAGUE_PAGE_SIZE
    : CUP_PAGE_SIZE;
  const [teams, fixtures, standings, reserveRows, derbyRows] = await Promise.all([
    cachedGetData('Teams!A:Z'),
    cachedGetData(config.fixturesRange),
    cachedGetData('Standings!A:J').catch(() => []),
    cachedGetData(RESERVE_SHEET_RANGE).catch(() => []),
    cachedGetData('Derbies!A:D').catch(() => [])
  ]);

  derbyMapCache = (derbyRows || [])
    .slice(1)
    .map(r => ({
      team1: r[1],
      team2: r[2],
      active: r[3]
    }))
    .filter(r => String(r.active || '').toLowerCase() === 'yes');

  let team = null;
  let targetText = '';

  if (targetType === 'user') {
    team = getTeamFromUserId(teams, targetValue);
    targetText = `<@${targetValue}>`;
  } else if (targetType === 'player') {
    team = getTeamFromPlayerName(teams, targetValue);
    targetText = targetValue;
  } else {
    team = getTeamFromUserId(teams, interaction.user.id);
    targetText = `${interaction.user}`;
  }

  if (!team) {
    return { content: `${safeEmoji(E.wrong, '❌')} Could not find a team for **${targetText || 'you'}**. Check Teams player name / Discord ID.` };
  }

  const teamKey = normalize(team.teamName);
  const shortKey = normalize(team.shortName);
  const rows = Array.isArray(fixtures)
    ? fixtures
        .slice(1)
        .filter(row => normalize(row[config.homeIndex]) === teamKey || normalize(row[config.awayIndex]) === teamKey || normalize(row[config.homeIndex]) === shortKey || normalize(row[config.awayIndex]) === shortKey)
    : [];

  if (!rows.length) {
    return { content: `${safeEmoji(E.wrong, '❌')} No fixtures found for **${team.teamName}**.` };
  }

  const upcoming = rows.filter(row => !hasScore(row, config));
  const played = rows.filter(row => hasScore(row, config));
  const current = upcoming[0] || null;
  const orderedRows = [...upcoming, ...played].sort((a, b) => {
    const aPlayed = hasScore(a, config) ? 1 : 0;
    const bPlayed = hasScore(b, config) ? 1 : 0;
    if (aPlayed !== bPlayed) return aPlayed - bPlayed;

    const aNo = clean(a[config.matchNoIndex]);
    const bNo = clean(b[config.matchNoIndex]);
    return aNo.localeCompare(bNo, undefined, { numeric: true, sensitivity: 'base' });
  });

  const totalPages = Math.max(1, Math.ceil(orderedRows.length / pageSize));
  page = Math.max(0, Math.min(page, totalPages - 1));

  const pageRows = orderedRows.slice(page * pageSize, page * pageSize + pageSize);
  const record = config.key === 'league' ? getRecord(standings, team.teamName, team.shortName) : { wins: 0, draws: 0, losses: 0, gd: 0, pts: 0 };
  const reserveMatches = getReserveMatches(reserveRows, team, config.reserveLabel);
  const summary = buildFixtureSummary(team, rows, upcoming, played, reserveMatches, current, config);
  const currentOpponent = current ? (normalize(current[config.homeIndex]) === teamKey ? current[config.awayIndex] : current[config.homeIndex]) : null;
  const reserveBlock = reserveMatches.length
    ? `${safeEmoji(E.lock, '🔒')} **Reserved Matches**\n` +
      reserveMatches
        .slice(0, 5)
        .map(match =>
          `> **${match.matchNo}** • \`${match.home}\` ${safeEmoji(E.vs, '⚔️')} \`${match.away}\`${match.by ? ` • by <@${match.by}>` : ''}${match.playerName ? ` • **${match.playerName}**` : ''}`
        )
        .join('\n') +
      (reserveMatches.length > 5 ? `\n> +${reserveMatches.length - 5} more reserved matches` : '') +
      '\n\n'
    : '';

  const currentBlock = current
    ? `${safeEmoji(E.fire, '🔥')} **Next Match**\n` +
      `> \`${current[config.homeIndex]}\` ${safeEmoji(E.vs, '⚔️')} \`${current[config.awayIndex]}\`\n` +
      `> ${safeEmoji(E.calendar, '📅')} Stage / Matchday **${matchdayOf(current, config)}**\n` +
      `> ${safeEmoji(E.captain, '👑')} Opp. Captain: ${getOpponentCaptainMention(teams, currentOpponent)}\n` +
      `> ${isDerbyFixture(current[config.homeIndex], current[config.awayIndex]) ? `${safeEmoji(E.fire, '🔥')} **DERBY MATCH**` : `${safeEmoji(E.info, 'ℹ️')} Regular Fixture`}\n` +
      `> ${safeEmoji(E.missing, '➖')} Status: **Pending**\n\n`
    : `${safeEmoji(E.correct, '✅')} **All fixtures completed.**\n\n`;

  const lines = pageRows.map(row => buildFixtureLine(row, team, current?.[config.matchNoIndex], config));

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.calendar, '📅')} ${team.teamName.toUpperCase()} ${config.label} Fixtures`)
    .setDescription(buildFixtureDescription(team, summary, record, currentBlock, reserveBlock, pageRows, page, orderedRows))
    .addFields(
      {
        name: `${safeEmoji(E.fire, '🔥')} Fixture List`,
        value: lines.join('\n\n') || 'No fixtures on this page.',
        inline: false
      }
    )
    .setColor(getTeamColor(teams, team.teamName, 0x5865F2))
    .setFooter({ text: `${config.label} • Page ${page + 1}/${totalPages} • Showing ${pageSize} matches per page` });

  if (team.logo && /^https?:\/\//i.test(team.logo)) embed.setThumbnail(team.logo);

  return {
    embeds: [embed],
    components: [
      createCompetitionDropdown({
        prefix: 'myfixtures',
        selectedCompetition: competitionKey,
        targetType,
        targetValue: encodeURIComponent(targetValue || interaction.user.id),
        ownerId: interaction.user.id
      }),
      createPaginationButtons({
        prefix: 'myfixtures',
        page,
        totalPages,
        targetType: `${targetType}|${competitionKey}`,
        targetValue: encodeURIComponent(targetValue || interaction.user.id),
        ownerId: interaction.user.id
      })
    ]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myfixtures')
    .setDescription('Show your coop team fixtures automatically')
    .addStringOption(opt => opt.setName('player').setDescription('Player name to search fixtures for').setRequired(false))
    .addUserOption(opt => opt.setName('user').setDescription('Discord user to search fixtures for').setRequired(false))
    .addStringOption(opt =>
      opt
        .setName('competition')
        .setDescription('Competition to show fixtures for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const playerInput = interaction.options.getString('player');
    const userInput = interaction.options.getUser('user');
    let targetType = 'self';
    let targetValue = interaction.user.id;
    const competitionKey = interaction.options.getString('competition') || 'league';

    if (userInput) {
      targetType = 'user';
      targetValue = userInput.id;
    } else if (playerInput) {
      targetType = 'player';
      targetValue = playerInput;
    }

    return buildMyFixtures(interaction, 0, targetType, targetValue, competitionKey);
  },

  async buttonHandler(interaction, action, page, targetType, targetValue) {
    const currentPage = Number(page) || 0;
    const nextPage = action === 'next'
      ? currentPage + 1
      : action === 'prev'
        ? currentPage - 1
        : currentPage;
    const rawType = String(targetType || 'self|league');
    const [resolvedTargetType = 'self', competitionKey = 'league'] = rawType.split('|');
    const value = decodeURIComponent(targetValue || interaction.user.id);
    return buildMyFixtures(
      interaction,
      nextPage,
      resolvedTargetType || 'self',
      value,
      competitionKey || 'league'
    );
  },

  async selectMenuHandler(interaction, targetType, targetValue) {
    const competitionKey = interaction.values[0] || 'league';
    const value = decodeURIComponent(targetValue || interaction.user.id);

    return buildMyFixtures(
      interaction,
      0,
      targetType || 'self',
      value,
      competitionKey
    );
  },
};
