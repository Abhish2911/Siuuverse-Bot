const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const { clean, toNumber } = require('../utils/competitionHelpers');
const { resetCompetitionYellows } = require('../utils/suspensionService');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return ownerIds.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;
}

function getCompetitionConfig(key) {
  const normalized = clean(key).toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      code: 'FA',
      sheet: 'FA_Cup_Coop_Fixtures!A:K',
      saveRange: 'FA_Cup_Coop_Fixtures!A2:K'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      code: 'CB',
      sheet: 'Carabao_Coop_Fixtures!A:K',
      saveRange: 'Carabao_Coop_Fixtures!A2:K'
    };
  }

  return {
    key: 'ucl',
    label: 'UCL',
    code: 'UCL',
    sheet: 'UCL_Coop_Knockout_Fixtures!A:K',
    saveRange: 'UCL_Coop_Knockout_Fixtures!A2:K',
    groupStandingsSheet: 'UCL_Coop_Group_Standings!A:K'
  };
}

function getRoundLabel(roundCode) {
  const code = clean(roundCode).toUpperCase();
  if (code === 'GS') return 'Group Stage';
  if (code === 'R1') return 'Round 1';
  if (code === 'QFQ') return 'Quarter Final Qualifier';
  if (code === 'R16') return 'Round of 16';
  if (code === 'QF') return 'Quarter Final';
  if (code === 'SF') return 'Semi Final';
  return 'Final';
}

function doesFixtureMatchRound(fixtureRound, targetRoundLabel, fixtureMd = '') {
  const fixture = clean(fixtureRound).toLowerCase();
  const target = clean(targetRoundLabel).toLowerCase();
  const md = clean(fixtureMd).toUpperCase();

  if (!target) return false;

  const aliases = {
    'round 1': ['r1', 'round 1'],
    'quarter final qualifier': ['qfq', 'quarter final qualifier'],
    'round of 16': ['r16', 'round of 16'],
    'quarter final': ['qf', 'quarter final'],
    'semi final': ['sf', 'semi final'],
    'final': ['f', 'final'],
    'group stage': ['gs', 'group stage']
  };

  const targetAliases = aliases[target] || [target];

  const roundMatched = fixture && targetAliases.some(alias => {
    return fixture === alias || fixture.startsWith(alias);
  });

  if (roundMatched) return true;

  return targetAliases.some(alias => {
    const upperAlias = alias.toUpperCase();

    if (upperAlias === 'F') {
      return /FINAL$/i.test(md);
    }

    return md.includes(` ${upperAlias}-`) || md.includes(` ${upperAlias}`);
  });
}

function normalizeFixtureRow(row) {
  const firstColumn = clean(row[0]).toUpperCase();
  const lastColumn = clean(row[row.length - 1]).toUpperCase();

  const knownRounds = [
    'ROUND 1',
    'QUARTER FINAL',
    'QUARTER FINAL LEG 1',
    'QUARTER FINAL LEG 2',
    'SEMI FINAL',
    'SEMI FINAL LEG 1',
    'SEMI FINAL LEG 2',
    'FINAL',
    'GROUP STAGE',
    'QUARTER FINAL QUALIFIER'
  ];

  const hasRoundColumnFirst = knownRounds.includes(firstColumn);
  const hasRoundColumnLast = knownRounds.includes(lastColumn);

  // Layout:
  // Round | MD | Date | Home | Away | HG | AG | Result | HS | AS | Status
  if (hasRoundColumnFirst) {
    return {
      storageType: 'ROUND_FIRST',
      round: clean(row[0]),
      md: clean(row[1]),
      date: clean(row[2]),
      homeTeam: clean(row[3]),
      awayTeam: clean(row[4]),
      hg: clean(row[5]),
      ag: clean(row[6]),
      result: clean(row[7]),
      homeShort: clean(row[8]),
      awayShort: clean(row[9]),
      status: clean(row[10])
    };
  }

  // Layout:
  // MD | Date | Home | Away | HG | AG | Result | HS | AS | Status | Round
  if (hasRoundColumnLast) {
    return {
      storageType: 'ROUND_LAST',
      round: clean(row[10]),
      md: clean(row[0]),
      date: clean(row[1]),
      homeTeam: clean(row[2]),
      awayTeam: clean(row[3]),
      hg: clean(row[4]),
      ag: clean(row[5]),
      result: clean(row[6]),
      homeShort: clean(row[7]),
      awayShort: clean(row[8]),
      status: clean(row[9])
    };
  }

  // Fallback legacy inference from MD
  const md = clean(row[0]);
  let inferredRound = '';

  if (/ R1-/i.test(md)) inferredRound = 'Round 1';
  else if (/ QFQ-/i.test(md)) inferredRound = 'Quarter Final Qualifier';
  else if (/ QF-/i.test(md)) inferredRound = 'Quarter Final';
  else if (/ SF-/i.test(md)) inferredRound = 'Semi Final';
  else if (/FINAL/i.test(md)) inferredRound = 'Final';

  return {
    storageType: 'ROUND_LAST',
    round: inferredRound,
    md: clean(row[0]),
    date: clean(row[1]),
    homeTeam: clean(row[2]),
    awayTeam: clean(row[3]),
    hg: clean(row[4]),
    ag: clean(row[5]),
    result: clean(row[6]),
    homeShort: clean(row[7]),
    awayShort: clean(row[8]),
    status: clean(row[9])
  };
}

function inferNextRound(currentRound, config) {
  const code = clean(currentRound).toUpperCase();

  if (code === 'GS') return 'QF';

  if (config.key === 'fa' || config.key === 'carabao') {
    if (code === 'R1') return 'QFQ';
    if (code === 'QFQ') return 'QF';
  }

  if (code === 'R16') return 'QF';
  if (code === 'QF') return 'SF';
  if (code === 'SF') return 'F';
  return '';
}

function formatFixtureLines(fixtures) {
  return fixtures.map((fixture, index) => {
    return `**${index + 1}.** \`${clean(fixture.md)}\` • \`${clean(fixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(fixture.awayShort)}\``;
  }).join('\n') || 'No fixtures generated.';
}

function isByeFixture(fixture) {
  return clean(fixture.awayTeam).toUpperCase() === 'BYE' || clean(fixture.awayShort).toUpperCase() === 'BYE';
}

function getFixtureTieKey(fixture) {
  return clean(fixture.md).toUpperCase().replace(/[AB]$/, '');
}

function getWinnerFromSingleFixture(fixture) {
  if (isByeFixture(fixture)) {
    return {
      teamName: fixture.homeTeam,
      shortName: fixture.homeShort
    };
  }

  const hg = toNumber(fixture.hg);
  const ag = toNumber(fixture.ag);

  if (hg === ag) return null;

  return hg > ag
    ? { teamName: fixture.homeTeam, shortName: fixture.homeShort }
    : { teamName: fixture.awayTeam, shortName: fixture.awayShort };
}

function getWinnersFromFixtures(fixtures) {
  const twoLegGroups = new Map();
  const singleFixtures = [];

  fixtures.forEach(fixture => {
    const md = clean(fixture.md).toUpperCase();

    if (/[AB]$/.test(md)) {
      const key = getFixtureTieKey(fixture);
      if (!twoLegGroups.has(key)) twoLegGroups.set(key, []);
      twoLegGroups.get(key).push(fixture);
    } else {
      singleFixtures.push(fixture);
    }
  });

  const winners = [];

  for (const fixture of singleFixtures) {
    const winner = getWinnerFromSingleFixture(fixture);
    if (!winner) return { ok: false, reason: `Draw found in ${fixture.md}. Enter a winner score before advancing.` };
    winners.push(winner);
  }

  for (const [tieKey, legs] of twoLegGroups.entries()) {
    if (legs.length !== 2) {
      return { ok: false, reason: `${tieKey} must have exactly 2 legs before advancing.` };
    }

    const teamTotals = new Map();

    legs.forEach(leg => {
      const homeKey = clean(leg.homeShort) || clean(leg.homeTeam);
      const awayKey = clean(leg.awayShort) || clean(leg.awayTeam);

      if (!teamTotals.has(homeKey)) {
        teamTotals.set(homeKey, {
          teamName: leg.homeTeam,
          shortName: leg.homeShort,
          goals: 0
        });
      }

      if (!teamTotals.has(awayKey)) {
        teamTotals.set(awayKey, {
          teamName: leg.awayTeam,
          shortName: leg.awayShort,
          goals: 0
        });
      }

      teamTotals.get(homeKey).goals += toNumber(leg.hg);
      teamTotals.get(awayKey).goals += toNumber(leg.ag);
    });

    const sorted = [...teamTotals.values()].sort((a, b) => b.goals - a.goals);

    if (!sorted.length || sorted[0].goals === sorted[1]?.goals) {
      return { ok: false, reason: `${tieKey} is tied on aggregate. Enter final winning score before advancing.` };
    }

    winners.push({
      teamName: sorted[0].teamName,
      shortName: sorted[0].shortName
    });
  }

  return { ok: true, winners };
}

function shuffleTeams(teams) {
  const copy = [...teams];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function buildQfqFixtures(winners, competitionCode) {
  const shuffled = shuffleTeams(winners);
  const byeTeam = shuffled[shuffled.length - 1];
  const playingTeams = shuffled.slice(0, -1);
  const fixtures = [];
  let tie = 1;

  for (let i = 0; i < playingTeams.length; i += 2) {
    const home = playingTeams[i];
    const away = playingTeams[i + 1];
    if (!home || !away) continue;

    fixtures.push({
      round: 'Quarter Final Qualifier',
      md: `${competitionCode} QFQ-${tie}`,
      date: '',
      homeTeam: home.teamName,
      awayTeam: away.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: home.shortName,
      awayShort: away.shortName,
      status: 'Upcoming'
    });

    tie += 1;
  }

  if (byeTeam) {
    fixtures.push({
      round: 'Quarter Final Qualifier',
      md: `${competitionCode} QFQ-BYE`,
      date: '',
      homeTeam: byeTeam.teamName,
      awayTeam: 'BYE',
      hg: '',
      ag: '',
      result: 'BYE',
      homeShort: byeTeam.shortName,
      awayShort: 'BYE',
      status: 'Done'
    });
  }

  return fixtures;
}

function buildTwoLegFixtures(winners, nextRoundCode, competitionCode) {
  const nextRoundLabel = getRoundLabel(nextRoundCode);
  const fixtures = [];
  let tie = 1;

  for (let i = 0; i < winners.length; i += 2) {
    const home = winners[i];
    const away = winners[i + 1];
    if (!home || !away) continue;

    fixtures.push({
      round: `${nextRoundLabel} Leg 1`,
      md: `${competitionCode} ${nextRoundCode}-${tie}A`,
      date: '',
      homeTeam: home.teamName,
      awayTeam: away.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: home.shortName,
      awayShort: away.shortName,
      status: 'Upcoming'
    });

    fixtures.push({
      round: `${nextRoundLabel} Leg 2`,
      md: `${competitionCode} ${nextRoundCode}-${tie}B`,
      date: '',
      homeTeam: away.teamName,
      awayTeam: home.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: away.shortName,
      awayShort: home.shortName,
      status: 'Upcoming'
    });

    tie += 1;
  }

  return fixtures;
}

function buildSingleLegFixtures(winners, nextRoundCode, competitionCode) {
  const nextRoundLabel = getRoundLabel(nextRoundCode);
  const fixtures = [];
  let tie = 1;

  for (let i = 0; i < winners.length; i += 2) {
    const home = winners[i];
    const away = winners[i + 1];
    if (!home || !away) continue;

    fixtures.push({
      round: nextRoundLabel,
      md: `${competitionCode} ${nextRoundCode === 'F' ? 'Final' : `${nextRoundCode}-${tie}`}`,
      date: '',
      homeTeam: home.teamName,
      awayTeam: away.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: home.shortName,
      awayShort: away.shortName,
      status: 'Upcoming'
    });

    tie += 1;
  }

  return fixtures;
}

function buildNextFixturesFromCurrent(currentFixtures, config, nextRound) {
  const winnerResult = getWinnersFromFixtures(currentFixtures);
  if (!winnerResult.ok) return winnerResult;

  const winners = winnerResult.winners;
  const next = clean(nextRound).toUpperCase();

  if ((config.key === 'fa' || config.key === 'carabao') && next === 'QFQ') {
    if (winners.length !== 7) {
      return { ok: false, reason: `QFQ requires exactly 7 Round 1 winners. Found ${winners.length}.` };
    }

    return { ok: true, fixtures: buildQfqFixtures(winners, config.code) };
  }

  // FA/Carabao Quarter Finals are generated from:
  // - 3 QFQ winners
  // - 1 QFQ bye winner
  // - 4 seeded teams from Teams sheet
  if ((config.key === 'fa' || config.key === 'carabao') && next === 'QF') {
    return {
      ok: false,
      reason: 'FA/Carabao Quarter Finals must be generated using seeded teams from Teams sheet.'
    };
  }

  if ((config.key === 'fa' || config.key === 'carabao' || config.key === 'ucl') && (next === 'SF')) {
    return { ok: true, fixtures: buildTwoLegFixtures(winners, next, config.code) };
  }

  return { ok: true, fixtures: buildSingleLegFixtures(winners, next, config.code) };
}

function parseUclGroupStandings(rows) {
  return rows
    .slice(1)
    .filter(row => clean(row[0]) || clean(row[1]))
    .map(row => ({
      group: clean(row[0]),
      teamName: clean(row[1]),
      shortName: clean(row[2]) || clean(row[1]),
      played: toNumber(row[3]),
      wins: toNumber(row[4]),
      draws: toNumber(row[5]),
      losses: toNumber(row[6]),
      gf: toNumber(row[7]),
      ga: toNumber(row[8]),
      gd: toNumber(row[9]),
      pts: toNumber(row[10])
    }))
    .filter(row => row.group && row.teamName);
}

function sortUclGroupRows(rows) {
  return [...rows].sort((a, b) =>
    b.pts - a.pts ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.teamName.localeCompare(b.teamName)
  );
}

function getUclQualifiedTeamsFromStandings(standingsRows) {
  const rows = parseUclGroupStandings(standingsRows);
  const groups = ['A', 'B', 'C'];
  const qualified = [];
  const thirdPlaced = [];

  for (const group of groups) {
    const groupRows = sortUclGroupRows(rows.filter(row => clean(row.group).toUpperCase() === group));

    if (groupRows.length !== 6) {
      return { ok: false, reason: `Group ${group} standings must have exactly 6 teams. Current: ${groupRows.length}.` };
    }

    qualified.push(groupRows[0], groupRows[1]);
    thirdPlaced.push(groupRows[2]);
  }

  const bestThird = sortUclGroupRows(thirdPlaced).slice(0, 2);
  const finalTeams = [...qualified, ...bestThird].map(row => ({
    teamName: row.teamName,
    shortName: row.shortName,
    group: row.group,
    pts: row.pts,
    gd: row.gd,
    gf: row.gf
  }));

  return { ok: true, teams: finalTeams, bestThird };
}

function buildUclQuarterFinalFixtures(qualifiedTeams) {
  const seeded = qualifiedTeams.slice(0, 4);
  const unseeded = qualifiedTeams.slice(4, 8).reverse();
  const fixtures = [];

  seeded.forEach((home, index) => {
    const away = unseeded[index];
    const tie = index + 1;
    if (!home || !away) return;

    fixtures.push({
      round: 'Quarter Final Leg 1',
      md: `UCL QF-${tie}A`,
      date: '',
      homeTeam: home.teamName,
      awayTeam: away.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: home.shortName,
      awayShort: away.shortName,
      status: 'Upcoming'
    });

    fixtures.push({
      round: 'Quarter Final Leg 2',
      md: `UCL QF-${tie}B`,
      date: '',
      homeTeam: away.teamName,
      awayTeam: home.teamName,
      hg: '',
      ag: '',
      result: '',
      homeShort: away.shortName,
      awayShort: home.shortName,
      status: 'Upcoming'
    });
  });

  return fixtures;
}

function buildAdvanceSummary(config, currentRoundLabel, nextRoundLabel, fixtures) {
  const firstFixture = fixtures[0];
  const topPairing = firstFixture
    ? `\`${clean(firstFixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(firstFixture.awayShort)}\``
    : 'N/A';

  return {
    competition: config.label,
    currentRound: currentRoundLabel,
    nextRound: nextRoundLabel,
    fixtures: fixtures.length,
    topPairing
  };
}

function buildAdvanceDescription(config, currentRoundLabel, nextRoundLabel, isPreview = false) {
  if (isPreview) {
    return (
      `${safeEmoji(E.calendar, '📅')} Previewing ${config.label} progression from **${currentRoundLabel}** to **${nextRoundLabel}**.\n` +
      `${safeEmoji(E.info || E.Badge, '📌')} No data will be changed until you run the real advance command.`
    );
  }

  return (
    `${safeEmoji(E.correct, '✅')} ${config.label} was advanced from **${currentRoundLabel}** to **${nextRoundLabel}**.\n` +
    `${safeEmoji(E.info || E.Badge, '📌')} Review the newly generated pairings below before matches begin.`
  );
}

function shouldResetYellowsOnAdvance(config, nextRound) {
  const competitionKey = String(config?.key || '').trim().toLowerCase();
  const next = String(nextRound || '').trim().toUpperCase();

  return (competitionKey === 'fa' || competitionKey === 'carabao' || competitionKey === 'ucl') && next === 'SF';
}

function getYellowResetLabel(config, nextRoundLabel) {
  if (!shouldResetYellowsOnAdvance(config, nextRoundLabel)) return 'No yellow-card reset';
  return `Yellow cards reset on entry to ${nextRoundLabel}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('advanceknockout')
    .setDescription('Advance a knockout competition to the next round from completed fixtures')
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription('Competition to advance')
        .setRequired(true)
        .addChoices(
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    )
    .addStringOption(option =>
      option
        .setName('current')
        .setDescription('Current finished round')
        .setRequired(true)
        .addChoices(
          { name: 'Group Stage', value: 'GS' },
          { name: 'Round 1', value: 'R1' },
          { name: 'Quarter Final Qualifier', value: 'QFQ' },
          { name: 'Round of 16', value: 'R16' },
          { name: 'Quarter Final', value: 'QF' },
          { name: 'Semi Final', value: 'SF' }
        )
    )
    .addBooleanOption(option =>
      option
        .setName('preview')
        .setDescription('Preview the next round without saving')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    const competition = interaction.options.getString('competition');
    const currentRound = interaction.options.getString('current');
    const preview = interaction.options.getBoolean('preview') || false;

    const config = getCompetitionConfig(competition);
    const nextRound = inferNextRound(currentRound, config);

    if (!nextRound) {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} Could not determine the next round from ${currentRound}.` };
    }

    if (config.key !== 'ucl' && currentRound === 'GS') {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} Group Stage advance is only available for UCL.` };
    }

    if ((config.key === 'fa' || config.key === 'carabao') && currentRound === 'R16') {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} ${config.label} now uses Round 1 → QFQ → QF format, not Round of 16.` };
    }

    if (config.key === 'ucl' && currentRound === 'GS') {
      const standingsSheet = await cachedGetData(config.groupStandingsSheet).catch(() => []);

      if (!Array.isArray(standingsSheet) || standingsSheet.length <= 1) {
        return { content: `${safeEmoji(E.wrong || E.error, '❌')} UCL group standings is empty.` };
      }

      const qualifiedResult = getUclQualifiedTeamsFromStandings(standingsSheet);
      if (!qualifiedResult.ok) {
        return { content: `${safeEmoji(E.wrong || E.error, '❌')} ${qualifiedResult.reason}` };
      }

      const nextFixtures = buildUclQuarterFinalFixtures(qualifiedResult.teams);
      const currentRoundLabel = getRoundLabel(currentRound);
      const nextRoundLabel = getRoundLabel(nextRound);

      if (preview) {
        const summary = buildAdvanceSummary(config, currentRoundLabel, nextRoundLabel, nextFixtures);

        return {
          embeds: [
            new EmbedBuilder()
              .setTitle(`${safeEmoji(E.calendar, '📅')} ${config.label} ${nextRoundLabel} Preview`)
              .setDescription(
                `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} UCL group-stage qualification preview.\n` +
                `${safeEmoji(E.correct, '✅')} Top 2 from each group + best 2 third-place teams qualify.\n` +
                `${safeEmoji(E.info || E.Badge, '📌')} No data will be changed until you run without preview.`
              )
              .addFields(
                { name: 'Qualified Teams', value: qualifiedResult.teams.map(team => `\`${team.shortName}\` ${team.teamName}`).join('\n'), inline: false },
                { name: 'Best Third-Place Teams', value: qualifiedResult.bestThird.map(team => `\`${team.shortName}\` ${team.teamName} • ${team.pts} pts • GD ${team.gd}`).join('\n'), inline: false },
                { name: 'Fixtures', value: String(summary.fixtures), inline: true },
                { name: `${safeEmoji(E.calendar, '📅')} QF Pairings`, value: formatFixtureLines(nextFixtures), inline: false }
              )
              .setColor(0x5865F2)
              .setFooter({ text: 'UCL Advance • Group Stage to Quarter Final preview' })
          ]
        };
      }

      const nextRows = nextFixtures.map(fixture => [
        fixture.round,
        fixture.md,
        fixture.date,
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.hg,
        fixture.ag,
        fixture.result,
        fixture.homeShort,
        fixture.awayShort,
        fixture.status
      ]);

      await updateData(config.saveRange, nextRows);
      invalidateSheetCache([config.sheet.split('!')[0] + '!']);

      sendAuditLog(interaction, {
        title: `🏆 ${config.label} Quarter Final Generated`,
        description: 'UCL Top 2 from each group + best 2 third-place teams advanced to Quarter Final.',
        color: 0x5865F2,
        fields: [
          { name: 'Qualified Teams', value: String(qualifiedResult.teams.length), inline: true },
          { name: 'Fixtures', value: String(nextFixtures.length), inline: true },
          { name: 'Format', value: 'QF 2 legs', inline: true }
        ]
      });

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.correct || E.trophy_animated, '✅')} UCL Quarter Final Generated`)
            .setDescription(
              `${safeEmoji(E.correct, '✅')} UCL advanced from **Group Stage** to **Quarter Final**.\n` +
              `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} Top 2 from each group + best 2 third-place teams qualified.`
            )
            .addFields(
              { name: 'Qualified Teams', value: qualifiedResult.teams.map(team => `\`${team.shortName}\` ${team.teamName}`).join('\n'), inline: false },
              { name: 'Best Third-Place Teams', value: qualifiedResult.bestThird.map(team => `\`${team.shortName}\` ${team.teamName} • ${team.pts} pts • GD ${team.gd}`).join('\n'), inline: false },
              { name: 'Saved To', value: config.sheet.split('!')[0], inline: true },
              { name: 'Fixtures', value: String(nextFixtures.length), inline: true },
              { name: `${safeEmoji(E.calendar, '📅')} QF Pairings`, value: formatFixtureLines(nextFixtures), inline: false }
            )
            .setColor(0x2ECC71)
            .setFooter({ text: 'UCL Advance • Group Stage to QF saved' })
        ]
      };
    }

    const fixturesSheet = await cachedGetData(config.sheet).catch(() => []);
    const teamsSheet = await cachedGetData('Teams!A:R').catch(() => []);

    if (!Array.isArray(fixturesSheet) || fixturesSheet.length <= 1) {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} ${config.label} fixtures is empty.` };
    }

    const rows = fixturesSheet
      .slice(1)
      .filter(row => clean(row[0]) || clean(row[1]) || clean(row[3]) || clean(row[4]));

    const currentRoundLabel = getRoundLabel(currentRound);
    const normalizedRows = rows.map(normalizeFixtureRow);

    const currentRoundFixtures = normalizedRows
      .filter(row => doesFixtureMatchRound(row.round, currentRoundLabel, row.md));

    if (!currentRoundFixtures.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No ${currentRoundLabel} fixtures found in ${config.label} fixtures.`
      };
    }

    const unfinished = currentRoundFixtures.filter(fixture => clean(fixture.status).toLowerCase() !== 'done');
    if (unfinished.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} ${unfinished.length} ${currentRoundLabel} fixture(s) are not marked Done yet.`
      };
    }

    let advanceResult;

    // FA/Carabao QF generation with seeded teams
    if ((config.key === 'fa' || config.key === 'carabao') && nextRound === 'QF') {
      const winnerResult = getWinnersFromFixtures(currentRoundFixtures);

      if (!winnerResult.ok) {
        return {
          content: `${safeEmoji(E.wrong || E.error, '❌')} ${winnerResult.reason}`
        };
      }

      const qfqWinners = winnerResult.winners;

      const seedColumnIndex = config.key === 'fa' ? 15 : 16;

      const seededTeams = teamsSheet
        .slice(1)
        .filter(row => {
          const seedValue = Number(clean(row[seedColumnIndex]));
          return !Number.isNaN(seedValue) && seedValue >= 1 && seedValue <= 4;
        })
        .map(row => ({
          // Teams sheet structure:
          // A = Team Name
          // B = Players
          // C = Short Name
          teamName: clean(row[0]),
          shortName: clean(row[2]) || clean(row[0]),
          seed: Number(clean(row[seedColumnIndex]))
        }))
        .sort((a, b) => a.seed - b.seed);

      if (seededTeams.length !== 4) {
        return {
          content: `${safeEmoji(E.wrong || E.error, '❌')} Expected exactly 4 seeded teams in Teams sheet for ${config.label}. Found ${seededTeams.length}.`
        };
      }

      const allQuarterFinalists = [...seededTeams, ...qfqWinners];

      // Seeded teams must always be paired against QFQ winners.
      // 1v4 and 2v3 style split.
      const pairings = [
        [seededTeams[0], qfqWinners[3]],
        [seededTeams[1], qfqWinners[2]],
        [seededTeams[2], qfqWinners[1]],
        [seededTeams[3], qfqWinners[0]]
      ];

      const orderedQuarterFinalists = [];

      pairings.forEach(([seeded, qualifier]) => {
        if (seeded && qualifier) {
          orderedQuarterFinalists.push(seeded, qualifier);
        }
      });

      if (allQuarterFinalists.length !== 8) {
        return {
          content: `${safeEmoji(E.wrong || E.error, '❌')} Quarter Final generation requires 8 teams. Found ${allQuarterFinalists.length}.`
        };
      }

      advanceResult = {
        ok: true,
        fixtures: buildTwoLegFixtures(orderedQuarterFinalists, 'QF', config.code)
      };
    } else {
      advanceResult = buildNextFixturesFromCurrent(currentRoundFixtures, config, nextRound);
    }
    if (!advanceResult.ok) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} ${advanceResult.reason}`
      };
    }

    const nextFixtures = advanceResult.fixtures;

    if (!nextFixtures.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Could not generate the next round from ${currentRoundLabel}.`
      };
    }

    const nextRoundLabel = getRoundLabel(nextRound);

    if (preview) {
      const summary = buildAdvanceSummary(config, currentRoundLabel, nextRoundLabel, nextFixtures);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.calendar, '📅')} ${config.label} ${nextRoundLabel} Preview`)
            .setDescription(buildAdvanceDescription(config, currentRoundLabel, nextRoundLabel, true))
            .addFields(
              { name: 'Competition', value: summary.competition, inline: true },
              { name: 'Current Round', value: summary.currentRound, inline: true },
              { name: 'Next Round', value: summary.nextRound, inline: true },
              { name: 'Fixtures', value: String(summary.fixtures), inline: true },
              { name: 'Top Pairing', value: summary.topPairing, inline: true },
              { name: 'Mode', value: 'Preview Only', inline: true },
              { name: 'Yellow Reset', value: getYellowResetLabel(config, nextRound), inline: false },
              { name: `${safeEmoji(E.calendar, '📅')} Pairings`, value: formatFixtureLines(nextFixtures), inline: false }
            )
            .setColor(0x5865F2)
            .setFooter({ text: `${config.label} Knockout Advance • Preview only` })
        ]
      };
    }

    const keptRows = rows.filter(row => {
      const normalized = normalizeFixtureRow(row);

      // Only remove already-generated fixtures for the exact next round.
      // Keep older rounds like QFQ when generating QF.
      return !(
        doesFixtureMatchRound(normalized.round, nextRoundLabel, normalized.md)
      );
    });
    const usesRoundLastLayout = rows.some(row => {
      const normalized = normalizeFixtureRow(row);
      return normalized.storageType === 'ROUND_LAST';
    });

    const nextRows = nextFixtures.map(fixture => {
      // Existing FA/Carabao/UCL sheets:
      // MD | Date | Home | Away | HG | AG | Result | HS | AS | Status | Round
      if (usesRoundLastLayout) {
        return [
          fixture.md,
          fixture.date,
          fixture.homeTeam,
          fixture.awayTeam,
          fixture.hg,
          fixture.ag,
          fixture.result,
          fixture.homeShort,
          fixture.awayShort,
          fixture.status,
          fixture.round || nextRoundLabel
        ];
      }

      // Alternate layout:
      // Round | MD | Date | Home | Away | HG | AG | Result | HS | AS | Status
      return [
        fixture.round || nextRoundLabel,
        fixture.md,
        fixture.date,
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.hg,
        fixture.ag,
        fixture.result,
        fixture.homeShort,
        fixture.awayShort,
        fixture.status
      ];
    });

    const rowsToSave = [...keptRows, ...nextRows];

    await updateData(config.saveRange, rowsToSave);

    let yellowResetStatus = 'No yellow-card reset';

    if (shouldResetYellowsOnAdvance(config, nextRound)) {
      try {
        await resetCompetitionYellows(interaction.guild.id, config.key);
        yellowResetStatus = `✅ Yellow cards reset for ${config.label}`;
      } catch (error) {
        console.error('Yellow reset error:', error);
        yellowResetStatus = '⚠️ Yellow-card reset failed';
      }
    }

    invalidateSheetCache([config.sheet.split('!')[0] + '!']);

    sendAuditLog(interaction, {
      title: `🏆 ${config.label} ${nextRoundLabel} Generated`,
      description: `${config.label} was advanced from ${currentRoundLabel} to ${nextRoundLabel}.`,
      color: 0x5865F2,
      fields: [
        { name: 'Current Round', value: currentRoundLabel, inline: true },
        { name: 'Next Round', value: nextRoundLabel, inline: true },
        { name: 'Fixtures', value: String(nextFixtures.length), inline: true },
        { name: 'Yellow Reset', value: yellowResetStatus, inline: false }
      ]
    });

    const summary = buildAdvanceSummary(config, currentRoundLabel, nextRoundLabel, nextFixtures);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.trophy_animated, '✅')} ${config.label} ${nextRoundLabel} Generated`)
          .setDescription(buildAdvanceDescription(config, currentRoundLabel, nextRoundLabel, false))
          .addFields(
            { name: 'Competition', value: summary.competition, inline: true },
            { name: 'Current Round', value: summary.currentRound, inline: true },
            { name: 'Next Round', value: summary.nextRound, inline: true },
            { name: 'Fixtures', value: String(summary.fixtures), inline: true },
            { name: 'Top Pairing', value: summary.topPairing, inline: true },
            { name: 'Saved To', value: config.sheet.split('!')[0], inline: true },
            { name: 'Yellow Reset', value: yellowResetStatus, inline: false },
            { name: `${safeEmoji(E.calendar, '📅')} Pairings`, value: formatFixtureLines(nextFixtures), inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: `${config.label} Knockout Advance • Saved into ${config.sheet.split('!')[0]}` })
      ]
    };
  }
};
