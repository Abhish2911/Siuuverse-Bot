const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  shuffleArray,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn,
  generateRoundRobinFixtures
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

function formatFixtureLines(fixtures) {
  return fixtures.slice(0, 12).map((fixture, index) => {
    return `**${index + 1}.** \`${clean(fixture.md)}\` • \`${clean(fixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(fixture.awayShort)}\``;
  }).join('\n') || 'No fixtures generated.';
}

function buildFixtureSummary(fixtures, teamCount, doubleRoundRobin) {
  const firstFixture = fixtures[0];
  const topPairing = firstFixture
    ? `\`${clean(firstFixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(firstFixture.awayShort)}\``
    : 'N/A';

  const firstMatchday = firstFixture?.md
    ? clean(firstFixture.md).split('.')[0]
    : 'N/A';

  return {
    teams: teamCount,
    fixtures: fixtures.length,
    mode: doubleRoundRobin ? 'Double Round Robin' : 'Single Round Robin',
    firstMatchday,
    topPairing
  };
}

function buildFixtureDescription(isGenerated = false) {
  if (isGenerated) {
    return (
      `${safeEmoji(E.correct, '✅')} League fixtures were generated and saved into the fixtures sheet.\n` +
      `${safeEmoji(E.info || E.Badge, '📌')} Review the opening pairings below before matches begin.`
    );
  }

  return (
    `${safeEmoji(E.calendar, '📅')} Previewing the current generated league fixture set.\n` +
    `${safeEmoji(E.info || E.Badge, '📌')} No sheet data will be changed until you run the generate command.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaguefixtures')
    .setDescription('Generate or preview coop league fixtures')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate full coop league fixtures from active teams')
        .addBooleanOption(option =>
          option
            .setName('double')
            .setDescription('Generate home and away reverse fixtures too')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('preview')
        .setDescription('Preview coop league fixtures without saving')
        .addBooleanOption(option =>
          option
            .setName('double')
            .setDescription('Preview home and away reverse fixtures too')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const doubleRoundRobin = interaction.options.getBoolean('double') ?? true;

    const teamsSheet = await cachedGetData('Teams!A:Z');

    if (!Array.isArray(teamsSheet) || teamsSheet.length <= 1) {
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is empty.` };
    }

    const header = teamsSheet[0];
    const headerMap = getTeamsHeaderMap(header);
    const teamRows = teamsSheet.slice(1).filter(row => clean(row[headerMap.teamName]));

    if (headerMap.teamName === -1 || headerMap.shortName === -1 || headerMap.powerRank === -1) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is missing one of these columns: Team Name, Short Name, Power Rank.`
      };
    }

    const activeLeagueTeams = getActiveTeamsByCompetition(teamRows, headerMap, 'league');

    if (activeLeagueTeams.length < 2) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} At least 2 league teams are required to generate fixtures.`
      };
    }

    const sortedTeams = sortTeamsByColumn(activeLeagueTeams, headerMap.powerRank, headerMap.teamName);
    const randomizedTeams = shuffleArray([...sortedTeams]);

    const fixtureInput = randomizedTeams.map(row => ({
      teamName: clean(row[headerMap.teamName]),
      shortName: clean(row[headerMap.shortName])
    }));

    const generatedFixtures = generateRoundRobinFixtures(fixtureInput, {
      competitionCode: 'L',
      doubleRoundRobin,
      includeGroupInId: false,
      teamNameKey: 'teamName',
      shortNameKey: 'shortName',
      randomizeHomeAway: true,
      shuffleRounds: false
    });

    if (!generatedFixtures.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Could not generate league fixtures.`
      };
    }

    if (subcommand === 'preview') {
      const summary = buildFixtureSummary(generatedFixtures, activeLeagueTeams.length, doubleRoundRobin);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.calendar, '📅')} League Fixtures Preview`)
            .setDescription(buildFixtureDescription(false))
            .addFields(
              { name: 'Teams', value: String(summary.teams), inline: true },
              { name: 'Fixtures', value: String(summary.fixtures), inline: true },
              { name: 'Mode', value: summary.mode, inline: true },
              { name: 'Opening Matchday', value: summary.firstMatchday, inline: true },
              { name: 'Top Pairing', value: summary.topPairing, inline: true },
              { name: 'Preview', value: 'No sheet changes', inline: true },
              { name: `${safeEmoji(E.calendar, '📅')} Opening Pairings`, value: formatFixtureLines(generatedFixtures), inline: false }
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'League Fixtures • Preview only' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    const rowsToSave = generatedFixtures.map(fixture => [
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

    await updateData('Fixtures!A2:J', rowsToSave);
    invalidateSheetCache(['Fixtures!']);

    sendAuditLog(interaction, {
      title: '📅 League Fixtures Generated',
      description: 'League fixtures were generated and saved into the Fixtures.',
      color: 0x5865F2,
      fields: [
        { name: 'Teams', value: String(activeLeagueTeams.length), inline: true },
        { name: 'Fixtures', value: String(generatedFixtures.length), inline: true },
        { name: 'Mode', value: doubleRoundRobin ? 'Double Round Robin' : 'Single Round Robin', inline: true }
      ]
    });

    const summary = buildFixtureSummary(generatedFixtures, activeLeagueTeams.length, doubleRoundRobin);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.calendar, '✅')} League Fixtures Generated`)
          .setDescription(buildFixtureDescription(true))
          .addFields(
            { name: 'Teams', value: String(summary.teams), inline: true },
            { name: 'Fixtures', value: String(summary.fixtures), inline: true },
            { name: 'Mode', value: summary.mode, inline: true },
            { name: 'Opening Matchday', value: summary.firstMatchday, inline: true },
            { name: 'Top Pairing', value: summary.topPairing, inline: true },
            { name: 'Saved To', value: 'Fixtures', inline: true },
            { name: `${safeEmoji(E.calendar, '📅')} Opening Pairings`, value: formatFixtureLines(generatedFixtures), inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'League Fixtures • Generated from active teams' })
      ]
    };
  }
};
