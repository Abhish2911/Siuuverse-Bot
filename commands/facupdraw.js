const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn,
} = require('../utils/competitionHelpers');
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

function getRoundCode(teamCount) {
  if (teamCount >= 16) return 'R16';
  if (teamCount >= 8) return 'QF';
  if (teamCount >= 4) return 'SF';
  return 'F';
}

function getRoundLabel(roundCode) {
  if (roundCode === 'R16') return 'Round of 16';
  if (roundCode === 'QF') return 'Quarter Final';
  if (roundCode === 'SF') return 'Semi Final';
  return 'Final';
}

function splitSeedsForCupFormat(seedRows) {
  return {
    top4: seedRows.filter(team => toNumber(team.seed) >= 1 && toNumber(team.seed) <= 4),
    round1: seedRows.filter(team => toNumber(team.seed) >= 5)
  };
}

function buildCupFixture(round, md, home, away, leg = '') {
  const roundLabel = leg ? `${round} ${leg}` : round;

  return {
    round: roundLabel,
    md,
    date: '',
    homeTeam: home.teamName,
    awayTeam: away.teamName,
    hg: '',
    ag: '',
    result: '',
    decision: '',
    homeShort: home.shortName,
    awayShort: away.shortName,
    status: 'Upcoming'
  };
}

function pairSequentialTeams(teams, round, prefix, startNumber = 1, twoLegged = false) {
  const fixtures = [];
  let matchNumber = startNumber;

  const shuffledTeams = shuffleTeams(teams);

  for (let i = 0; i < shuffledTeams.length; i += 2) {
    const home = shuffledTeams[i];
    const away = shuffledTeams[i + 1];

    if (!home || !away) continue;

    if (twoLegged) {
      fixtures.push(buildCupFixture(round, `${prefix}-${matchNumber}A`, home, away, 'Leg 1'));
      fixtures.push(buildCupFixture(round, `${prefix}-${matchNumber}B`, away, home, 'Leg 2'));
    } else {
      fixtures.push(buildCupFixture(round, `${prefix}-${matchNumber}`, home, away));
    }

    matchNumber += 1;
  }

  return fixtures;
}

function shuffleTeams(teams) {
  const copy = [...teams];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function buildQfqFixtures(round1WinnerSlots) {
  const shuffled = shuffleTeams(round1WinnerSlots);

  const byeTeam = shuffled[shuffled.length - 1];
  const playingTeams = shuffled.slice(0, -1);

  const fixtures = pairSequentialTeams(
    playingTeams,
    'Quarter Final Qualifier',
    'FA QFQ'
  );

  return {
    fixtures,
    byeTeam
  };
}

function buildFaCupAdvantageDraw(seedRows) {
  const grouped = splitSeedsForCupFormat(seedRows);

  const round1Fixtures = pairSequentialTeams(grouped.round1, 'Round 1', 'FA R1');

  return {
    grouped,
    qfqBye: null,
    fixtures: [...round1Fixtures]
  };
}

function chunkArray(items, size) {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function formatDrawLines(fixtures) {
  const lines = fixtures.map((fixture, index) => {
    return `**${index + 1}.** **${clean(fixture.round || 'Round')}** • \`${clean(fixture.md)}\` • \`${clean(fixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(fixture.awayShort)}\``;
  });

  return chunkArray(lines, 8).map(chunk => chunk.join('\n'));
}

function buildDrawSummary(teamRows, fixtures, roundLabel, grouped = null) {
  const topSeed = teamRows[0]
    ? `\`${clean(teamRows[0].shortName)}\` ${clean(teamRows[0].teamName)}`
    : 'N/A';

  return {
    activeTeams: teamRows.length,
    fixtures: fixtures.length,
    round: roundLabel,
    topSeed,
    qfqPathTeams: grouped?.round1?.length || 0,
    directQfTeams: grouped?.top4?.length || 0
  };
}

function buildDrawDescription(roundLabel, isGenerated = false) {
  const base = isGenerated
    ? `${safeEmoji(E.correct, '✅')} FA Cup QFQ-format draw was generated and saved into the fixtures.\n`
    : `${safeEmoji(E.info || E.Badge, '📌')} Current FA Cup fixtures loaded from the data.\n`;

  return (
    base +
    `${safeEmoji(E.played, '🎮')} **Round 1 Generated:** Seeds 5–18 enter Round 1.\n` +
    `${safeEmoji(E.rank, '🏅')} **Top 4 Seeds:** Enter later directly in Quarter Finals.\n` +
    `${safeEmoji(E.info || E.Badge, '📌')} Remaining knockout rounds are generated using /advanceknockout.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('facupdraw')
    .setDescription('Generate or view the FA Cup knockout draw')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate the FA Cup first knockout round using FA Cup seeds')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View the current FA Cup fixtures draw')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const fixturesSheet = await cachedGetData('FA_Cup_Coop_Fixtures!A:K').catch(() => []);

      if (!Array.isArray(fixturesSheet) || fixturesSheet.length <= 1) {
        return {
          embeds: [
            new EmbedBuilder()
              .setTitle(`${safeEmoji(E.FA || E.calendar, '🏆')} FA Cup Draw`)
              .setDescription('No FA Cup draw has been generated yet.')
              .setColor(0x5865F2)
          ]
        };
      }

      const rows = fixturesSheet.slice(1).filter(row => clean(row[0]) || clean(row[2]) || clean(row[3]));
      const fixtures = rows.map(row => ({
        md: clean(row[0]),
        homeTeam: clean(row[2]),
        awayTeam: clean(row[3]),
        homeShort: clean(row[7]),
        awayShort: clean(row[8]),
        status: clean(row[9]),
        round: clean(row[10])
      }));

      const roundLabel = fixtures[0]?.round || 'Draw';
      const summary = buildDrawSummary([], fixtures, roundLabel);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.FA || E.calendar, '🏆')} FA Cup ${roundLabel}`)
            .setDescription(buildDrawDescription(roundLabel, false))
            .addFields(
              { name: 'Fixtures', value: String(summary.fixtures), inline: true },
              { name: 'Round', value: summary.round, inline: true },
              { name: 'Loaded From', value: 'FA_Cup_Coop_Fixtures', inline: true },
              { name: 'Format', value: 'Top 4 QF • QFQ • QF/SF 2 Legs', inline: true },
              ...formatDrawLines(fixtures).map((value, index) => ({
                name: `${safeEmoji(E.calendar, '📅')} Pairings ${index + 1}`,
                value,
                inline: false
              }))
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'FA Cup Draw • Loaded from fixtures data' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    const teamsSheet = await cachedGetData('Teams!A:Z');

    if (!Array.isArray(teamsSheet) || teamsSheet.length <= 1) {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} Teams is empty.` };
    }

    const header = teamsSheet[0];
    const headerMap = getTeamsHeaderMap(header);
    const teamRows = teamsSheet.slice(1).filter(row => clean(row[headerMap.teamName]));

    if (
      headerMap.teamName === -1 ||
      headerMap.shortName === -1 ||
      headerMap.faStatus === -1 ||
      headerMap.faSeed === -1
    ) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams is missing one of these columns: Team Name, Short Name, FA Status, FA Cup Seed.`
      };
    }

    const activeFaTeams = getActiveTeamsByCompetition(teamRows, headerMap, 'fa');

    if (activeFaTeams.length < 2) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} At least 2 active FA Cup teams are required for a draw.`
      };
    }

    const missingSeeds = activeFaTeams.some(row => !clean(row[headerMap.faSeed]));
    if (missingSeeds) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Some active FA Cup teams do not have a seed yet. Run /facupseed generate first.`
      };
    }

    const sortedBySeed = sortTeamsByColumn(activeFaTeams, headerMap.faSeed, headerMap.teamName);

    const fixtureInput = sortedBySeed.map(row => ({
      teamName: clean(row[headerMap.teamName]),
      shortName: clean(row[headerMap.shortName]),
      seed: toNumber(row[headerMap.faSeed])
    }));

    const summaryTeams = fixtureInput.map(row => ({
      teamName: row.teamName,
      shortName: row.shortName
    }));

    const draw = buildFaCupAdvantageDraw(fixtureInput);
    const generatedFixtures = draw.fixtures;
    const roundLabel = 'FA Cup Full Draw';

    if (!generatedFixtures.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Could not generate FA Cup draw. Check FA Cup seeds and active teams.`
      };
    }

    const rowsToSave = generatedFixtures.map(fixture => [
      clean(fixture.md),
      clean(fixture.date),
      clean(fixture.homeTeam),
      clean(fixture.awayTeam),
      clean(fixture.hg),
      clean(fixture.ag),
      clean(fixture.result),
      clean(fixture.homeShort),
      clean(fixture.awayShort),
      clean(fixture.status),
      clean(fixture.round)
    ]);

    await updateData('FA_Cup_Coop_Fixtures!A2:K', rowsToSave);
    invalidateSheetCache(['FA_Cup_Coop_Fixtures!']);

    sendAuditLog(interaction, {
      title: '🏆 FA Cup Draw Generated',
      description: `FA Cup ${roundLabel} draw was generated from FA Cup seeds and saved into the fixtures.`,
      color: 0x5865F2,
      fields: [
        { name: 'Active Teams', value: String(activeFaTeams.length), inline: true },
        { name: 'Fixtures', value: String(generatedFixtures.length), inline: true },
        { name: 'Format', value: 'Round 1 only', inline: true },
        { name: 'Direct QF Teams', value: String(draw.grouped.top4.length), inline: true },
        { name: 'Round 1 Teams', value: String(draw.grouped.round1.length), inline: true }
      ]
    });

    const summary = buildDrawSummary(summaryTeams, generatedFixtures, roundLabel, draw.grouped);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.FA, '✅')} FA Cup Draw Generated`)
          .setDescription(buildDrawDescription(roundLabel, true))
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Fixtures', value: String(summary.fixtures), inline: true },
            { name: 'Top Seed', value: summary.topSeed, inline: true },
            { name: 'Direct QF', value: String(summary.directQfTeams), inline: true },
            { name: 'QFQ Path', value: String(summary.qfqPathTeams), inline: true },
            { name: 'Format', value: 'R1 → QFQ → QF → SF → Final', inline: true },
            ...formatDrawLines(generatedFixtures).map((value, index) => ({
              name: `${safeEmoji(E.calendar, '📅')} Pairings ${index + 1}`,
              value,
              inline: false
            }))
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'FA Cup Draw • Top 4 direct QF + QFQ format' })
      ]
    };
  }
};
