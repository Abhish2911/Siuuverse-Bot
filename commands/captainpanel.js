const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cachedGetData, cleanId, getTeamColor, normalize, splitList } = require('../utils/helpers');
const { clean: sharedClean } = require('../utils/competitionHelpers');
const E = require('../utils/emojis');

const RESERVE_SHEET_RANGE = 'Reserve!A:F';
const TEAMS_SHEET_RANGE = 'Teams!A:Z';

function truncateField(value, max = 1000) {
  const text = String(value || '').trim();
  if (!text) return 'None';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 12).trim()}\n+ more...`;
}

function clean(value) {
  return sharedClean(value);
}

function normalizeMatchNo(value) {
  return clean(value).toUpperCase();
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      reserveLabel: 'FA Cup',
      suspensionRange: 'FA_Cup_Coop_Suspension!A:G',
      matchNoIndex: 1,
      dateIndex: 2,
      homeIndex: 3,
      awayIndex: 4,
      homeShortIndex: 8,
      awayShortIndex: 9,
      hgIndex: 5,
      agIndex: 6,
      statusIndex: 10
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      reserveLabel: 'Carabao Cup',
      suspensionRange: 'Carabao_Coop_Suspension!A:G',
      matchNoIndex: 1,
      dateIndex: 2,
      homeIndex: 3,
      awayIndex: 4,
      homeShortIndex: 8,
      awayShortIndex: 9,
      hgIndex: 5,
      agIndex: 6,
      statusIndex: 10
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      reserveLabel: 'UCL',
      suspensionRange: 'UCL_Coop_Suspension!A:G',
      matchNoIndex: 0,
      dateIndex: 1,
      homeIndex: 2,
      awayIndex: 3,
      homeShortIndex: 7,
      awayShortIndex: 8,
      hgIndex: 4,
      agIndex: 5,
      statusIndex: 9
    };
  }

  return {
    key: 'league',
    label: 'League',
    fixturesRange: 'Fixtures!A:J',
    reserveLabel: 'League',
    suspensionRange: 'Suspension!A:G',
    matchNoIndex: 0,
    dateIndex: 1,
    homeIndex: 2,
    awayIndex: 3,
    homeShortIndex: 7,
    awayShortIndex: 8,
    hgIndex: 4,
    agIndex: 5,
    statusIndex: 9
  };
}

function hasScore(row, config) {
  return row?.[config.hgIndex] !== '' && row?.[config.hgIndex] !== undefined &&
    row?.[config.agIndex] !== '' && row?.[config.agIndex] !== undefined;
}

function parseMatchNumber(value) {
  const num = Number(String(value || '').trim());
  return Number.isFinite(num) ? num : Number.POSITIVE_INFINITY;
}

function getCaptainTeam(teamsRows, userId) {
  const id = cleanId(userId);
  return teamsRows.find(row => cleanId(row[4]) === id) || null;
}

function getSquadList(teamRow) {
  return splitList(teamRow?.[1]);
}

function getUserIds(teamRow) {
  return splitList(teamRow?.[5]).map(cleanId);
}

function getCaptainId(teamRow) {
  return cleanId(teamRow?.[4]);
}

function buildResultFormat(matchNo = '<match_no>') {
  return (
    `\`/result match:${matchNo} ` +
    `homegoals:<home_goals> ` +
    `awaygoals:<away_goals> ` +
    `scorers:<player1, player2> ` +
    `assists:<player1, player2> ` +
    `yellow:<player1, player2> ` +
    `red:<player1, player2> ` +
    `mvp:<player> ` +
    `tackles1:<home_tackles> ` +
    `tackles2:<away_tackles> ` +
    `interceptions1:<home_interceptions> ` +
    `interceptions2:<away_interceptions> ` +
    `saves1:<home_saves> ` +
    `saves2:<away_saves> ` +
    `homeplayed:<home_player1, home_player2> ` +
    `awayplayed:<away_player1, away_player2>\``
  );
}

function buildResultEntryGuide() {
  return (
    `${E.info || '📌'} **Result Entry Guide**\n` +
    `Use the correct match prefix in \`match:\` → **L / FA / CB / UCL**\n` +
    `Use the correct round/stage name inside the match ID when needed → **GS / RO16 / QF / SF / F**\n` +
    `Examples: **L MD2.1**, **FA QF.1**, **CB SF.1**, **UCL GS-A-MD2.1**, **UCL QF.1**`
  );
}

function buildCaptainPanelButtons(matchNo = 'next', competitionKey = 'league') {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`captainpanel_resultformat:${competitionKey}:${matchNo}`)
        .setLabel('Result Format')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildSquadMembersText(teamRow) {
  const squadNames = getSquadList(teamRow);
  const captainId = getCaptainId(teamRow);
  const otherUserIds = getUserIds(teamRow);
  const linkedIds = [captainId, ...otherUserIds].filter(Boolean);

  if (!squadNames.length) return 'No squad players found.';

  const lines = squadNames.map((name, index) => {
    const linkedId = linkedIds[index];
    const icon = index === 0 ? E.captain : E.profile;
    return linkedId
      ? `${icon} **${index + 1}. ${name}** — <@${linkedId}>`
      : `${icon} **${index + 1}. ${name}** — No linked ID`;
  });

  return truncateField(lines.join('\n'));
}

function getNextMatch(fixturesRows, teamName, shortName, config) {
  const teamKey = normalize(teamName);
  const shortKey = normalize(shortName);
  const rows = fixturesRows.slice(1).filter(r => r[config.matchNoIndex]);

  const matches = rows.filter(row => {
    const homeTeam = normalize(row[config.homeIndex]);
    const awayTeam = normalize(row[config.awayIndex]);
    const homeShort = normalize(row[config.homeShortIndex]);
    const awayShort = normalize(row[config.awayShortIndex]);

    const isOurMatch =
      homeTeam === teamKey ||
      awayTeam === teamKey ||
      homeShort === shortKey ||
      awayShort === shortKey;

    const unplayed = !hasScore(row, config);
    return isOurMatch && unplayed;
  });

  matches.sort((a, b) => {
    const dateA = Date.parse(String(a[config.dateIndex] || ''));
    const dateB = Date.parse(String(b[config.dateIndex] || ''));

    const hasDateA = Number.isFinite(dateA);
    const hasDateB = Number.isFinite(dateB);

    if (hasDateA && hasDateB && dateA !== dateB) return dateA - dateB;
    if (hasDateA && !hasDateB) return -1;
    if (!hasDateA && hasDateB) return 1;

    return parseMatchNumber(a[config.matchNoIndex]) - parseMatchNumber(b[config.matchNoIndex]);
  });

  return matches[0] || null;
}

function getTeamReservedMatches(reserveRows, teamName, shortName, competitionLabel) {
  const teamKey = normalize(teamName);
  const shortKey = normalize(shortName);
  const targetCompetition = clean(competitionLabel).toLowerCase();

  return reserveRows
    .slice(1)
    .filter(row => row && row.length)
    .filter(row => clean(row[0]).toLowerCase() === targetCompetition)
    .filter(row => {
      const homeTeam = normalize(row[2]);
      const awayTeam = normalize(row[3]);
      return homeTeam === teamKey || awayTeam === teamKey || homeTeam === shortKey || awayTeam === shortKey;
    })
    .map(row => ({
      matchNo: String(row[1] || '-').trim(),
      home: String(row[2] || 'HOME').trim(),
      away: String(row[3] || 'AWAY').trim(),
      by: clean(row[4]),
      playerName: clean(row[5])
    }));
}

function cleanSuspensionPlayer(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function getTeamSuspensions(suspensionRows, teamShort, squadNames) {
  const squadSet = new Set(squadNames.map(name => normalize(name)));

  return suspensionRows
    .slice(1)
    .filter(row => String(row[0] || '').trim())
    .filter(row => {
      const player = normalize(cleanSuspensionPlayer(row[0]));
      const rawPlayer = normalize(row[0]);
      const rowShort = normalize(row[6]);
      return squadSet.has(player) || squadSet.has(rawPlayer) || (teamShort && rowShort === normalize(teamShort));
    })
    .filter(row => {
      const banned = String(row[4] || '').trim();
      const status = normalize(row[5]);
      return banned !== '' && !status.includes('served') && !status.includes('done');
    })
    .map(row => ({
      player: cleanSuspensionPlayer(row[0]),
      reason: String(row[5] || '').trim() || 'Suspended',
      bannedMatch: String(row[4] || '').trim() || 'N/A'
    }));
}

async function buildCaptainPanelPayload(interaction, competitionKey = 'league') {
  const config = getCompetitionConfig(competitionKey);

  const [teams, fixtures, suspension, reserveRows] = await Promise.all([
    cachedGetData(TEAMS_SHEET_RANGE),
    cachedGetData(config.fixturesRange),
    cachedGetData(config.suspensionRange).catch(() => []),
    cachedGetData(RESERVE_SHEET_RANGE).catch(() => [])
  ]);

  if (!Array.isArray(teams) || teams.length <= 1) {
    return { content: `${E.wrong} Teams is empty.` };
  }

  const teamRows = teams.slice(1).filter(row => row[0]);
  const captainTeam = getCaptainTeam(teamRows, interaction.user.id);

  if (!captainTeam) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${E.lock} Captain Panel`)
          .setDescription('You are not registered as a team captain in the Teams.')
          .setColor(0xE74C3C)
      ],
      components: []
    };
  }

  const teamName = String(captainTeam[0] || '').trim();
  const squadNames = getSquadList(captainTeam);
  const shortName = String(captainTeam[2] || '').trim();
  const logoUrl = String(captainTeam[3] || '').trim();
  const stadium = String(captainTeam[6] || 'Not set').trim();

  const nextMatch = Array.isArray(fixtures) && fixtures.length > 1
    ? getNextMatch(fixtures, teamName, shortName, config)
    : null;

  const suspensions = Array.isArray(suspension) && suspension.length > 1
    ? getTeamSuspensions(suspension, shortName, squadNames)
    : [];

  const reservedMatches = Array.isArray(reserveRows) && reserveRows.length > 1
    ? getTeamReservedMatches(reserveRows, teamName, shortName, config.reserveLabel)
    : [];

  const nextMatchText = nextMatch
    ? (() => {
        const matchNo = String(nextMatch[config.matchNoIndex] || '-').trim();
        const date = String(nextMatch[config.dateIndex] || 'TBD').trim();
        const home = String(nextMatch[config.homeShortIndex] || nextMatch[config.homeIndex] || 'HOME').trim();
        const away = String(nextMatch[config.awayShortIndex] || nextMatch[config.awayIndex] || 'AWAY').trim();
        return truncateField(
          `${E.doubleArrow} **Match:** ${matchNo}\n` +
          `${E.calendar} **Date:** ${date}\n` +
          `${E.vs} **Fixture:** ${home} ${E.vs} ${away}\n` +
          `${E.goal} Click **Result Format** button below to copy the full ${config.label} result command format.\n` +
          `${E.info || '📌'} Match IDs must include the right prefix and round/stage name.`
        );
      })()
    : `${E.correct} No upcoming unplayed match found.`;

  const squadText = buildSquadMembersText(captainTeam);

  const suspensionsText = suspensions.length
    ? truncateField(suspensions.map(s => `${E.suspend} **${s.player}** — ${s.reason} (Match ${s.bannedMatch})`).join('\n'))
    : `${E.correct} No active suspensions.`;

  const reservedText = reservedMatches.length
    ? truncateField(reservedMatches.map(match =>
        `${E.reserve || '📌'} **Match ${match.matchNo}** — ${match.home} ${E.vs} ${match.away}${match.by ? ` • by <@${match.by}>` : ''}${match.playerName ? ` • **${match.playerName}**` : ''}`
      ).join('\n'))
    : `${E.correct} No active reserved matches.`;

  const embed = new EmbedBuilder()
    .setTitle(`${E.captain} Captain Panel — ${shortName || teamName} (${config.label})`)
    .setDescription(
      `${E.team || '🏟️'} **Team:** ${teamName}\n` +
      `${E.Badge} **Short:** ${shortName || 'N/A'}\n` +
      `${E.trophy_animated || '🏆'} **Competition:** ${config.label}\n` +
      `🏟️ **Stadium:** ${stadium}`
    )
    .addFields(
      { name: `${E.calendar} Your Next Match`, value: nextMatchText, inline: false },
      { name: `${E.info || '📌'} Result Entry Guide`, value: buildResultEntryGuide(), inline: false },
      { name: `${E.reserve || '📌'} Reserved / Pending Played Status`, value: reservedText, inline: false },
      { name: `${E.profile} Squad Members`, value: squadText, inline: false },
      { name: `${E.suspend} Suspensions`, value: suspensionsText, inline: false }
    )
    .setColor(getTeamColor(teams, teamName, 0x3498DB))
    .setFooter({ text: `${config.label} captain dashboard • Squad, fixture and reserve control` });

  if (logoUrl && /^https?:\/\//i.test(logoUrl)) embed.setThumbnail(logoUrl);

  const buttonMatchNo = nextMatch ? String(nextMatch[config.matchNoIndex] || 'next').trim() : 'next';

  return {
    embeds: [embed],
    components: buildCaptainPanelButtons(buttonMatchNo, config.key)
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('captainpanel')
    .setDescription('COOP captain view: next match, reserves, squad and suspensions')
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription('Competition to open the captain panel for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const competitionKey = interaction.options.getString('competition') || 'league';
    return buildCaptainPanelPayload(interaction, competitionKey);
  },

  async buttonHandler(interaction, action, value, extra) {
    if (action !== 'resultformat') return null;

    const raw = String(value || 'league:next');
    const [competitionKeyRaw, matchNoRaw] = raw.split(':');

    const competitionKey = String(competitionKeyRaw || 'league').trim();
    const config = getCompetitionConfig(competitionKey);
    const matchNo = String(matchNoRaw || extra || '<match_no>').trim() || '<match_no>';

    return {
      content:
        `${E.goal} **${config.label} Full Result Submit Format**\n` +
        buildResultFormat(matchNo) +
        `\n\n` +
        buildResultEntryGuide(),
      ephemeral: true
    };
  }
};
