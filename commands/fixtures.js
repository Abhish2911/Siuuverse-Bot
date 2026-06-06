const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const { cachedGetData, getTeamColor } = require('../utils/helpers');
const { clean: sharedClean } = require('../utils/competitionHelpers');
const E = require('../utils/emojis');

let derbyMapCache = null;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return sharedClean(value);
}

function normalizeMatchNo(value) {
  return clean(value)
    .replace(/\./g, '-')
    .toLowerCase();
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:L',
      reserveLabel: 'FA Cup',
      matchNoIndex: 0,
      dateIndex: 1,
      homeIndex: 2,
      awayIndex: 3,
      hgIndex: 4,
      agIndex: 5,
      resultIndex: 6,
      homeShortIndex: 8,
      awayShortIndex: 9,
      statusIndex: 10,
      footerText: 'SiuuVerse FA Cup'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:L',
      reserveLabel: 'Carabao Cup',
      matchNoIndex: 0,
      dateIndex: 1,
      homeIndex: 2,
      awayIndex: 3,
      hgIndex: 4,
      agIndex: 5,
      resultIndex: 6,
      homeShortIndex: 8,
      awayShortIndex: 9,
      statusIndex: 10,
      footerText: 'SiuuVerse Carabao Cup'
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      knockoutRange: 'UCL_Coop_Knockout_Fixtures!A:L',
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
      statusIndex: 9,
      footerText: 'SiuuVerse UCL'
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
    statusIndex: 9,
    footerText: 'SiuuVerse Coop League'
  };
}

/* ---------------- MATCHDAY PARSER ---------------- */

function getHeaderLabel(row, config) {
  const rawMatchNo = clean(row?.[config.matchNoIndex]);
  const matchNo = String(rawMatchNo || '')
    .replace(/\./g, '-')
    .trim()
    .toUpperCase();

  if (!matchNo) return '';

  // League: L-1-1 -> L-1
  const league = matchNo.match(/^L-(\d+)-\d+$/);
  if (league) {
    return `L-${league[1]}`;
  }

  // FA Cup: FA-R1-1 -> FA-R1
  const fa = matchNo.match(/^FA-(.+?)-\d+$/);
  if (fa) {
    return `FA-${fa[1]}`;
  }

  // Carabao Cup: CB-R1-1 -> CB-R1
  const carabao = matchNo.match(/^CB-(.+?)-\d+$/);
  if (carabao) {
    return `CB-${carabao[1]}`;
  }

  // UCL Group Stage: UCL-GS-A-1-1 -> UCL-GS-1
  const uclGroup = matchNo.match(/^UCL-GS-[A-H]-(\d+)-\d+$/);
  if (uclGroup) {
    return `UCL-GS-${uclGroup[1]}`;
  }

  // UCL Knockout: UCL-R16-1 -> UCL-R16
  const uclKnockout = matchNo.match(/^UCL-(R16|QF|SF|F)-\d+$/);
  if (uclKnockout) {
    return `UCL-${uclKnockout[1]}`;
  }

  return matchNo;
}

function isDerbyFixture(home, away) {
  if (!derbyMapCache) return false;

  const h = clean(home).toLowerCase();
  const a = clean(away).toLowerCase();

  return derbyMapCache.some(d => {
    const t1 = clean(d.team1).toLowerCase();
    const t2 = clean(d.team2).toLowerCase();

    return (
      (h === t1 && a === t2) ||
      (h === t2 && a === t1)
    );
  });
}

function getReserveMap(rows, competitionLabel) {
  const map = new Map();

  if (!Array.isArray(rows)) return map;

  rows.slice(1).forEach(row => {
    const competition = clean(row?.[0]);
    const matchNo = normalizeMatchNo(row?.[1]);

    if (!matchNo) return;

    if (
      clean(competition).toLowerCase() !==
      clean(competitionLabel).toLowerCase()
    ) {
      return;
    }

    map.set(matchNo, {
      competition,
      home: clean(row?.[2]),
      away: clean(row?.[3]),
      by: clean(row?.[4]),
      playerName: clean(row?.[5])
    });
  });

  return map;
}

const getMatchdays = (data, config) => {
  if (!Array.isArray(data)) return [];

  const days = new Set();

  for (const row of data.slice(1)) {
    const label = getHeaderLabel(row, config);

    if (label) days.add(label);
  }

  return [...days];
};

function hasScore(row, config) {
  return (
    row[config.hgIndex] !== '' &&
    row[config.hgIndex] !== undefined &&
    row[config.agIndex] !== '' &&
    row[config.agIndex] !== undefined
  );
}

function getResultEmoji(homeGoals, awayGoals) {
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);

  if (Number.isNaN(hg) || Number.isNaN(ag)) {
    return safeEmoji(E.played, '🎮');
  }

  if (hg > ag) return safeEmoji(E.win, '✅');
  if (hg < ag) return safeEmoji(E.lose, '❌');

  return safeEmoji(E.draw, '🤝');
}

function getStatusText(row, config, reserveMap = new Map()) {
  if (hasScore(row, config)) {
    return `${safeEmoji(E.correct, '✅')} DONE`;
  }

  const reserve = reserveMap.get(
    normalizeMatchNo(row?.[config.matchNoIndex])
  );

  if (reserve) {
    return `${safeEmoji(E.lock, '🔒')} RESERVED${
      reserve.by ? ` by ${reserve.by}` : ''
    }`;
  }

  const rawStatus = clean(row?.[config.statusIndex]).toUpperCase();

  if (rawStatus) {
    if (rawStatus === 'DONE') {
      return `${safeEmoji(E.correct, '✅')} DONE`;
    }

    if (rawStatus === 'RESERVED') {
      return `${safeEmoji(E.lock, '🔒')} RESERVED`;
    }

    if (rawStatus === 'LIVE') {
      return `${safeEmoji(E.fire, '🔥')} LIVE`;
    }
  }

  return `${safeEmoji(E.calendar, '📅')} UPCOMING`;
}

function shorten(value, len = 14) {
  const str = String(value || '').trim();

  return str.length > len
    ? `${str.slice(0, len - 1)}…`
    : str;
}

function buildFixtureLines(fixtures, config, reserveMap = new Map()) {
  return fixtures.map(row => {
    const matchNo = row?.[config.matchNoIndex];
    const home = row?.[config.homeIndex];
    const away = row?.[config.awayIndex];
    const hg = row?.[config.hgIndex];
    const ag = row?.[config.agIndex];
    const result = row?.[config.resultIndex];
    const homeShort = row?.[config.homeShortIndex];
    const awayShort = row?.[config.awayShortIndex];

    const played = hasScore(row, config);

    const left = clean(homeShort) || shorten(home, 10);
    const right = clean(awayShort) || shorten(away, 10);

    const res =
      result ||
      (played
        ? Number(hg) > Number(ag)
          ? 'H'
          : Number(hg) < Number(ag)
            ? 'A'
            : 'D'
        : '-');

    const reserve = reserveMap.get(
      normalizeMatchNo(matchNo)
    );

    const scoreText = played
      ? `${getResultEmoji(hg, ag)} **${hg}-${ag}** (${res})`
      : reserve
        ? `${safeEmoji(E.lock, '🔒')} Reserved${
            reserve.by ? ` by **${reserve.by}**` : ''
          }${
            reserve.playerName
              ? ` • **${reserve.playerName}**`
              : ''
          }`
        : `${safeEmoji(E.calendar, '📅')} Pending`;

    const derbyTag = isDerbyFixture(home, away)
      ? ` ${safeEmoji(E.fire, '🔥')} DERBY`
      : '';

    return (
      `**${matchNo || '-'}**${derbyTag} • ${getStatusText(
        row,
        config,
        reserveMap
      )}\n` +
      `> \`${left || 'HOME'}\` ${safeEmoji(
        E.vs,
        '⚔️'
      )} \`${right || 'AWAY'}\`\n` +
      `> ${scoreText}`
    );
  });
}

function buildFixtureSummary(
  mdMatches,
  md,
  filter,
  config,
  reserveMap
) {
  const firstFixture = mdMatches[0];

  const firstPairing = firstFixture
    ? `\`${clean(
        firstFixture?.[config.homeShortIndex]
      ) || clean(
        firstFixture?.[config.homeIndex]
      )}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(
        firstFixture?.[config.awayShortIndex]
      ) || clean(
        firstFixture?.[config.awayIndex]
      )}\``
    : 'N/A';

  const date = firstFixture?.[config.dateIndex] || 'TBD';

  const playedCount = mdMatches.filter(row =>
    hasScore(row, config)
  ).length;

  const totalCount = mdMatches.length;

  const pendingCount = totalCount - playedCount;

  const reservedCount = mdMatches.filter(
    row =>
      reserveMap.has(
        normalizeMatchNo(row?.[config.matchNoIndex])
      ) && !hasScore(row, config)
  ).length;

  const progress = totalCount
    ? Math.round((playedCount / totalCount) * 100)
    : 0;

  return {
    matchday: md,
    date,
    playedCount,
    totalCount,
    pendingCount,
    reservedCount,
    progress,
    filter: String(filter || 'all').toUpperCase(),
    firstPairing
  };
}

function buildFixtureDescription(summary, config) {
  return (
    `# ${config.label} • ${summary.matchday}\n` +
    `${safeEmoji(E.calendar, '📅')} Date: **${summary.date}**\n` +
    `${safeEmoji(E.correct, '✅')} Done: **${summary.playedCount}** • ` +
    `${safeEmoji(E.missing, '➖')} Pending: **${summary.pendingCount}** • ` +
    `${safeEmoji(E.lock, '🔒')} Reserved: **${summary.reservedCount}**\n` +
    `${safeEmoji(E.played, '🎮')} Progress: ` +
    `**${summary.playedCount}/${summary.totalCount} • ${summary.progress}%**\n` +
    `${safeEmoji(E.Badge || E.info, '📌')} Filter: ` +
    `**${summary.filter}** • Opening Pairing: ${summary.firstPairing}`
  );
}

function createButtons(md, matchdays, config, filter = 'all') {
  const currentIndex = matchdays.indexOf(md);
  const state = encodeURIComponent(
    `${config.key}__${filter}__${md}`
  );

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fixtures_prev_${state}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentIndex === 0),

    new ButtonBuilder()
      .setCustomId(`fixtures_refresh_${state}`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`fixtures_next_${state}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentIndex === matchdays.length - 1)
  );
}

function createDropdown(md, matchdays, config, filter = 'all') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        `md_select_fixtures__${encodeURIComponent(config.key)}__${encodeURIComponent(filter)}`
      )
      .setPlaceholder(`${config.label} • ${md}`)
      .addOptions(
        matchdays.slice(0, 25).map(m => ({
          label: `${config.label} • ${m}`.slice(0, 100),
          value: m,
          description: `Open ${m} (${String(
            filter || 'all'
          ).toUpperCase()})`.slice(0, 100),
          default: m === md
        }))
      )
  );
}

function buildFixtures(
  data,
  md,
  matchdays,
  teams = [],
  reserveRows = [],
  filter = 'all',
  config = getCompetitionConfig('league')
) {
  const reserveMap = getReserveMap(
    reserveRows,
    config.reserveLabel
  );

  let mdMatches = data
    .slice(1)
    .filter(r => getHeaderLabel(r, config) === md)
    .sort((a, b) => {
      const aMatch = clean(a?.[config.matchNoIndex]);
      const bMatch = clean(b?.[config.matchNoIndex]);

      return aMatch.localeCompare(
        bMatch,
        undefined,
        {
          numeric: true,
          sensitivity: 'base'
        }
      );
    });

  if (filter === 'played') {
    mdMatches = mdMatches.filter(row =>
      hasScore(row, config)
    );
  } else if (filter === 'pending') {
    mdMatches = mdMatches.filter(
      row => !hasScore(row, config)
    );
  }

  if (!mdMatches.length) {
    return {
      content:
        `${safeEmoji(E.wrong, '❌')} No ` +
        `${filter === 'all' ? '' : `${filter} `}` +
        `fixtures found for ${md}.`
    };
  }

  const featureTeam =
    mdMatches[0]?.[config.homeIndex] ||
    mdMatches[0]?.[config.awayIndex] ||
    '';

  const embedColor = getTeamColor(
    teams,
    featureTeam
  );

  const summary = buildFixtureSummary(
    mdMatches,
    md,
    filter,
    config,
    reserveMap
  );

  const embed = new EmbedBuilder()
    .setTitle(
      `${safeEmoji(
        E.league,
        safeEmoji(E.calendar, '📅')
      )} ${config.label} Fixtures Hub`
    )
    .setDescription(
      buildFixtureDescription(summary, config)
    )
    .addFields(
      buildFixtureLines(
        mdMatches,
        config,
        reserveMap
      ).map((text, index) => ({
        name: `${safeEmoji(
          E.doubleArrow,
          '➡️'
        )} Fixture ${index + 1}`,
        value: text,
        inline: true
      }))
    )
    .setColor(embedColor)
    .setFooter({
      text: `${md} • ${config.footerText}`
    })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      createButtons(
        md,
        matchdays,
        config,
        filter
      ),
      createDropdown(
        md,
        matchdays,
        config,
        filter
      )
    ]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fixtures')
    .setDescription('Show fixtures')
    .addStringOption(option =>
      option
        .setName('matchday')
        .setDescription('Matchday / Stage')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription(
          'Competition to view fixtures for'
        )
        .setRequired(false)
        .addChoices(
          {
            name: 'League',
            value: 'league'
          },
          {
            name: 'FA Cup',
            value: 'fa'
          },
          {
            name: 'Carabao Cup',
            value: 'carabao'
          },
          {
            name: 'UCL',
            value: 'ucl'
          }
        )
    )
    .addStringOption(option =>
      option
        .setName('filter')
        .setDescription(
          'Show all, played, or pending fixtures'
        )
        .setRequired(false)
        .addChoices(
          {
            name: 'All',
            value: 'all'
          },
          {
            name: 'Played',
            value: 'played'
          },
          {
            name: 'Pending',
            value: 'pending'
          }
        )
    ),

  async execute(interaction) {
    const competitionKey =
      interaction.options.getString(
        'competition'
      ) || 'league';

    const config =
      getCompetitionConfig(competitionKey);

    const [data, teams, reserveRows, derbyRows] =
      await Promise.all([
        config.key === 'ucl'
          ? Promise.all([
              cachedGetData(config.fixturesRange),
              cachedGetData(config.knockoutRange).catch(() => [])
            ]).then(([groups, knockouts]) => [
              ...(groups || []),
              ...((knockouts || []).slice(1))
            ])
          : cachedGetData(config.fixturesRange),
        cachedGetData('Teams!A:Z'),
        cachedGetData('Reserve!A:F').catch(
          () => []
        ),
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

    const matchdays = getMatchdays(
      data,
      config
    );

    if (!matchdays.length) {
      return {
        content:
          `${safeEmoji(E.wrong, '❌')} No ` +
          `${config.label} fixtures found.`
      };
    }

    const requestedMd = clean(
      interaction.options.getString('matchday') || ''
    )
      .replace(/\./g, '-');

    const filter =
      interaction.options.getString(
        'filter'
      ) || 'all';

    const selectedMd =
      requestedMd &&
      matchdays.includes(requestedMd)
        ? requestedMd
        : matchdays[0];

    return buildFixtures(
      data,
      selectedMd,
      matchdays,
      teams,
      reserveRows,
      filter,
      config
    );
  },

  async buttonHandler(
    interaction,
    action,
    value
  ) {
    const decodedState = decodeURIComponent(
      String(value || 'league__all__')
    );

    const [
      competitionKey = 'league',
      filter = 'all',
      currentMd = ''
    ] = decodedState.split('__');

    const config =
      getCompetitionConfig(competitionKey);

    const [data, teams, reserveRows, derbyRows] =
      await Promise.all([
        config.key === 'ucl'
          ? Promise.all([
              cachedGetData(config.fixturesRange),
              cachedGetData(config.knockoutRange).catch(() => [])
            ]).then(([groups, knockouts]) => [
              ...(groups || []),
              ...((knockouts || []).slice(1))
            ])
          : cachedGetData(config.fixturesRange),
        cachedGetData('Teams!A:Z'),
        cachedGetData('Reserve!A:F').catch(
          () => []
        ),
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

    const matchdays = getMatchdays(
      data,
      config
    );

    if (!matchdays.length) {
      return {
        content:
          `${safeEmoji(E.wrong, '❌')} No ` +
          `${config.label} fixtures found.`
      };
    }

    let index = matchdays.indexOf(currentMd);

    if (index === -1) index = 0;

    if (action === 'prev') index--;
    if (action === 'next') index++;
    if (action === 'refresh') {
      index = matchdays.indexOf(currentMd);
    }

    index = Math.max(
      0,
      Math.min(index, matchdays.length - 1)
    );

    return buildFixtures(
      data,
      matchdays[index],
      matchdays,
      teams,
      reserveRows,
      filter,
      config
    );
  },

  async selectHandler(interaction) {
    const parts = String(
      interaction.customId || ''
    ).split('__');

    const competitionKey = decodeURIComponent(
      parts[1] || 'league'
    );

    const filter = decodeURIComponent(
      parts[2] || 'all'
    );

    const config =
      getCompetitionConfig(competitionKey);

    const [data, teams, reserveRows, derbyRows] =
      await Promise.all([
        config.key === 'ucl'
          ? Promise.all([
              cachedGetData(config.fixturesRange),
              cachedGetData(config.knockoutRange).catch(() => [])
            ]).then(([groups, knockouts]) => [
              ...(groups || []),
              ...((knockouts || []).slice(1))
            ])
          : cachedGetData(config.fixturesRange),
        cachedGetData('Teams!A:Z'),
        cachedGetData('Reserve!A:F').catch(
          () => []
        ),
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

    const matchdays = getMatchdays(
      data,
      config
    );

    if (!matchdays.length) {
      return {
        content:
          `${safeEmoji(E.wrong, '❌')} No ` +
          `${config.label} fixtures found.`
      };
    }

    return buildFixtures(
      data,
      interaction.values[0],
      matchdays,
      teams,
      reserveRows,
      filter,
      config
    );
  }
};
