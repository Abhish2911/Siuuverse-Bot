const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
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

function getGroupNamesFromTeams(teamRows, headerMap) {
  return [...new Set(
    teamRows
      .map(row => clean(row[headerMap.uclGroup]))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function buildGroupTeamMap(teamRows, headerMap) {
  const map = new Map();

  for (const row of teamRows) {
    const group = clean(row[headerMap.uclGroup]);

    if (!group) continue;

    if (!map.has(group)) {
      map.set(group, []);
    }

    map.get(group).push({
      teamName: clean(row[headerMap.teamName]),
      shortName: clean(row[headerMap.shortName])
    });
  }

  return map;
}

function applyUclMatchIds(fixtures) {
  const groupCounters = {};

  return fixtures.map(fixture => {
    const next = { ...fixture };

    const rawGroup = clean(fixture.md).match(/GS-([A-Z])/i);
    const groupName = rawGroup?.[1] || 'A';

    if (!groupCounters[groupName]) {
      groupCounters[groupName] = 1;
    }

    next.md = `UCL GS-${groupName}-${groupCounters[groupName]}`;

    groupCounters[groupName] += 1;

    return next;
  });
}

function validateUclFixtureSetup(activeUclTeams, groupNames, teamsByGroup) {
  if (activeUclTeams.length !== 18) {
    return `UCL group-stage fixtures require exactly **18 active teams**. Current active teams: **${activeUclTeams.length}**.`;
  }

  const expectedGroups = ['A', 'B', 'C'];
  const missingGroups = expectedGroups.filter(group => !groupNames.includes(group));

  if (missingGroups.length) {
    return `Missing UCL groups: **${missingGroups.join(', ')}**. Run \`/ucldraw generate\` first.`;
  }

  for (const group of expectedGroups) {
    const teams = teamsByGroup.get(group) || [];

    if (teams.length !== 6) {
      return `Group **${group}** must have exactly **6 teams**. Current: **${teams.length}**.`;
    }
  }

  return '';
}

function formatFixtureLines(fixtures) {
  const lines = fixtures.slice(0, 12).map((fixture, index) => {
    return `**${index + 1}.** \`${clean(fixture.md)}\` • \`${clean(fixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(fixture.awayShort)}\``;
  });

  const text = lines.join('\n') || 'No fixtures generated.';

  return text.length > 1024
    ? `${text.slice(0, 1000)}\n...`
    : text;
}

function buildFixtureSummary(fixtures, activeTeams, groupNames) {
  const expectedFixtures = 45;
  const teamsPerGroup = groupNames.length
    ? Math.round(activeTeams / groupNames.length)
    : 0;

  const firstFixture = fixtures[0];

  const topPairing = firstFixture
    ? `\`${clean(firstFixture.homeShort)}\` ${safeEmoji(E.vs, '⚔️')} \`${clean(firstFixture.awayShort)}\``
    : 'N/A';

  const openingStage = firstFixture?.md || 'N/A';

  return {
    activeTeams,
    groups: groupNames.length,
    teamsPerGroup,
    expectedFixtures,
    fixtures: fixtures.length,
    openingStage,
    topPairing,
    groupList: groupNames.join(', ') || 'N/A'
  };
}

function buildFixtureDescription(isGenerated = false) {
  const base = isGenerated
    ? `${safeEmoji(E.correct, '✅')} UCL group-stage fixtures were generated and saved into the fixtures sheet.\n`
    : `${safeEmoji(E.calendar, '📅')} Previewing the current generated UCL fixture set.\n`;

  return (
    base +
    `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} **Format:** 18 teams → 3 groups of 6.\n` +
    `${safeEmoji(E.played, '🎮')} **Group Stage:** Single round-robin, each team plays 5 matches.\n` +
    `${safeEmoji(E.calendar, '📅')} **Match IDs:** UCL GS-A-1, UCL GS-B-1 style.\n` +
    `${safeEmoji(E.calendar, '📅')} **Total Group Fixtures:** 45.\n` +
    `${safeEmoji(E.correct, '✅')} **Qualification:** Top 2 each group + best 2 third-place teams.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uclfixtures')
    .setDescription('Generate or preview UCL group-stage fixtures')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate UCL group fixtures from UCL Group assignments')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('preview')
        .setDescription('Preview UCL group fixtures without saving')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    const teamsSheet = await cachedGetData('Teams!A:Z');

    if (!Array.isArray(teamsSheet) || teamsSheet.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is empty.`
      };
    }

    const header = teamsSheet[0];

    const headerMap = getTeamsHeaderMap(header);

    const teamRows = teamsSheet
      .slice(1)
      .filter(row => clean(row[headerMap.teamName]));

    if (
      headerMap.teamName === -1 ||
      headerMap.shortName === -1 ||
      headerMap.uclStatus === -1 ||
      headerMap.uclGroup === -1 ||
      headerMap.uclPot === -1
    ) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is missing one of these columns: Team Name, Short Name, UCL Status, UCL Group, UCL Pot.`
      };
    }

    const activeUclTeams = getActiveTeamsByCompetition(
      teamRows,
      headerMap,
      'ucl'
    );

    if (!activeUclTeams.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No active UCL teams found. Set UCL Status to Active first.`
      };
    }

    const missingGroup = activeUclTeams.some(
      row => !clean(row[headerMap.uclGroup])
    );

    if (missingGroup) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Some active UCL teams do not have a UCL Group yet. Run /ucldraw generate first.`
      };
    }

    const groupNames = getGroupNamesFromTeams(
      activeUclTeams,
      headerMap
    );

    const teamsByGroup = buildGroupTeamMap(
      activeUclTeams,
      headerMap
    );

    const setupError = validateUclFixtureSetup(
      activeUclTeams,
      groupNames,
      teamsByGroup
    );

    if (setupError) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} ${setupError}`
      };
    }

    let generatedFixtures = [];

    for (const groupName of groupNames) {
      const groupTeams = teamsByGroup.get(groupName) || [];

      if (groupTeams.length !== 6) continue;

      const groupFixtures = generateRoundRobinFixtures(groupTeams, {
        competitionCode: 'UCL',
        doubleRoundRobin: false,
        includeGroupInId: true,
        groupName,
        teamNameKey: 'teamName',
        shortNameKey: 'shortName',
        randomizeHomeAway: true,
        shuffleRounds: true
      });

      generatedFixtures.push(...groupFixtures);
    }

    generatedFixtures = applyUclMatchIds(generatedFixtures);

    if (!generatedFixtures.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Could not generate UCL group fixtures.`
      };
    }

    if (generatedFixtures.length !== 45) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} UCL fixture count must be **45** for 3 groups of 6. Generated: **${generatedFixtures.length}**.`
      };
    }

    if (subcommand === 'preview') {
      const summary = buildFixtureSummary(
        generatedFixtures,
        activeUclTeams.length,
        groupNames
      );

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.UCL || E.calendar, '🏆')} UCL Fixtures Preview`)
            .setDescription(buildFixtureDescription(false))
            .addFields(
              { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
              { name: 'Groups', value: String(summary.groups), inline: true },
              { name: 'Teams / Group', value: String(summary.teamsPerGroup), inline: true },
              { name: 'Fixtures', value: String(summary.fixtures), inline: true },
              { name: 'Expected Fixtures', value: String(summary.expectedFixtures), inline: true },
              { name: 'Group List', value: summary.groupList, inline: true },
              { name: 'Opening Stage', value: summary.openingStage, inline: true },
              { name: 'Top Pairing', value: summary.topPairing, inline: true },
              {
                name: `${safeEmoji(E.calendar, '📅')} Opening Pairings`,
                value: formatFixtureLines(generatedFixtures).slice(0, 1024),
                inline: false
              }
            )
            .setColor(0x5865F2)
            .setFooter({
              text: 'UCL Fixtures • GS-A-1 style IDs'
            })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.`
      };
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

    await updateData(
      'UCL_Coop_Group_Fixtures!A2:J',
      rowsToSave
    );

    invalidateSheetCache([
      'UCL_Coop_Group_Fixtures!'
    ]);

    sendAuditLog(interaction, {
      title: '🏆 UCL Fixtures Generated',
      description: 'UCL group-stage fixtures were generated and saved into UCL_Coop_Group_Fixtures.',
      color: 0x5865F2,
      fields: [
        {
          name: 'Active Teams',
          value: String(activeUclTeams.length),
          inline: true
        },
        {
          name: 'Groups',
          value: groupNames.join(', '),
          inline: true
        },
        {
          name: 'Teams / Group',
          value: '6',
          inline: true
        },
        {
          name: 'Fixtures',
          value: String(generatedFixtures.length),
          inline: true
        }
      ]
    });

    const summary = buildFixtureSummary(
      generatedFixtures,
      activeUclTeams.length,
      groupNames
    );

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.UCL, '✅')} UCL Fixtures Generated`)
          .setDescription(buildFixtureDescription(true))
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Groups', value: String(summary.groups), inline: true },
            { name: 'Teams / Group', value: String(summary.teamsPerGroup), inline: true },
            { name: 'Fixtures', value: String(summary.fixtures), inline: true },
            { name: 'Expected Fixtures', value: String(summary.expectedFixtures), inline: true },
            { name: 'Group List', value: summary.groupList, inline: true },
            { name: 'Opening Stage', value: summary.openingStage, inline: true },
            { name: 'Top Pairing', value: summary.topPairing, inline: true },
            { name: 'Saved To', value: 'UCL_Coop_Group_Fixtures', inline: true },
            {
              name: `${safeEmoji(E.calendar, '📅')} Opening Pairings`,
              value: formatFixtureLines(generatedFixtures).slice(0, 1024),
              inline: false
            }
          )
          .setColor(0x2ECC71)
          .setFooter({
            text: 'UCL Fixtures • GS-A-1 style generated'
          })
      ]
    };
  }
};
