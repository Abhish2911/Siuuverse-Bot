const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  shuffleArray
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

function buildGroupFixtures(groupTeams, groupName) {
  const fixtures = [];

  if (groupTeams.length !== 6) {
    throw new Error(
      `Group ${groupName} must contain exactly 6 teams.`
    );
  }

  const teams = [...groupTeams];

  const rounds = [];

  for (let round = 0; round < 5; round++) {
    const matches = [];

    for (let i = 0; i < 3; i++) {
      let home = teams[i];
      let away = teams[5 - i];

      // Alternate home/away by round
      if ((round + i) % 2 === 1) {
        [home, away] = [away, home];
      }

      matches.push({
        home,
        away
      });
    }

    rounds.push(matches);

    // Circle rotation
    teams.splice(1, 0, teams.pop());
  }

  let matchNumber = 1;

  rounds.forEach(matches => {
    matches.forEach(match => {
      fixtures.push({
        md: `UCL-GS-${groupName}-${matchNumber}`,
        date: '',
        homeTeam: match.home.teamName,
        awayTeam: match.away.teamName,
        hg: '',
        ag: '',
        result: '',
        homeShort: match.home.shortName,
        awayShort: match.away.shortName,
        status: 'Upcoming'
      });

      matchNumber++;
    });
  });

  return fixtures;
}

function buildAllGroupFixtures(rows, headerMap, groupNames) {
  const fixtures = [];

  for (const groupName of groupNames) {
    const groupTeams = rows
      .filter(row => clean(row[headerMap.uclGroup]) === groupName)
      .sort((a, b) => {
        const potDiff = toNumber(a[headerMap.uclPot]) - toNumber(b[headerMap.uclPot]);
        if (potDiff !== 0) return potDiff;

        return clean(a[headerMap.teamName]).localeCompare(clean(b[headerMap.teamName]));
      })
      .map(row => ({
        teamName: clean(row[headerMap.teamName]),
        shortName: clean(row[headerMap.shortName])
      }));

    fixtures.push(...buildGroupFixtures(groupTeams, groupName));
  }

  return fixtures;
}

function drawThreeGroupsFromSixPots(rows, headerMap) {
  const groupNames = ['A', 'B', 'C'];
  const groupedByPot = new Map();

  rows.forEach(row => {
    const pot = clean(row[headerMap.uclPot]);

    if (!groupedByPot.has(pot)) {
      groupedByPot.set(pot, []);
    }

    groupedByPot.get(pot).push(row);
  });

  const drawnRows = [];

  for (let pot = 1; pot <= 6; pot++) {
    const potTeams = groupedByPot.get(String(pot)) || [];

    if (potTeams.length !== 3) {
      throw new Error(`Pot ${pot} must have exactly 3 teams for 3 groups. Found ${potTeams.length}.`);
    }

    const shuffled = shuffleArray(potTeams);

    shuffled.forEach((row, index) => {
      const next = [...row];
      next[headerMap.uclGroup] = groupNames[index];
      drawnRows.push(next);
    });
  }

  return drawnRows;
}

function validateUclDrawSetup(activeUclTeams, headerMap) {
  if (activeUclTeams.length !== 18) {
    return `UCL format expects exactly **18 active teams**. Current active teams: **${activeUclTeams.length}**.`;
  }

  const potCounts = new Map();

  activeUclTeams.forEach(row => {
    const pot = clean(row[headerMap.uclPot]);
    potCounts.set(pot, (potCounts.get(pot) || 0) + 1);
  });

  for (let pot = 1; pot <= 6; pot++) {
    const count = potCounts.get(String(pot)) || 0;

    if (count !== 3) {
      return `Pot **${pot}** must have exactly **3 teams**. Current: **${count}**. Run \`/uclpots generate\` first.`;
    }
  }

  return '';
}

function buildGroupedOutput(rows, headerMap, groupNames) {
  return groupNames.map(groupName => {
    const lines = rows
      .filter(row => clean(row[headerMap.uclGroup]) === groupName)
      .sort((a, b) => {
        const potDiff = toNumber(a[headerMap.uclPot]) - toNumber(b[headerMap.uclPot]);
        if (potDiff !== 0) return potDiff;

        return clean(a[headerMap.teamName]).localeCompare(clean(b[headerMap.teamName]));
      })
      .map(row => {
        return `Pot ${clean(row[headerMap.uclPot])} • \`${clean(row[headerMap.shortName])}\` ${clean(row[headerMap.teamName])}`;
      });

    return {
      name: `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} Group ${groupName}`,
      value: lines.join('\n') || 'No teams drawn.',
      inline: false
    };
  });
}

function buildFixturePreview(fixtures) {
  const grouped = {
    A: [],
    B: [],
    C: []
  };

  fixtures.forEach(fixture => {
    const match = String(fixture.md).match(/UCL-GS-([A-Z])/i);

    if (!match) return;

    const group = match[1];

    if (grouped[group]) {
      grouped[group].push(fixture);
    }
  });

  const lines = [];

  Object.entries(grouped).forEach(([group, matches]) => {
    lines.push(`**Group ${group}**`);

    matches
      .sort((a, b) => {
        const aNum = Number(String(a.md).split('-').pop()) || 0;
        const bNum = Number(String(b.md).split('-').pop()) || 0;
        return aNum - bNum;
      })
      .slice(0, 3)
      .forEach(fixture => {
        lines.push(
          `\`${fixture.md}\` • ` +
          `\`${fixture.homeShort}\` ` +
          `${safeEmoji(E.vs, '⚔️')} ` +
          `\`${fixture.awayShort}\``
        );
      });

    lines.push('');
  });

  return lines.join('\n').trim();
}

function buildDrawSummary(rows, headerMap, groupNames, fixtures = []) {
  const assignedGroups = new Set(
    rows
      .map(row => clean(row[headerMap.uclGroup]))
      .filter(Boolean)
  );

  const potCount = new Set(
    rows
      .map(row => clean(row[headerMap.uclPot]))
      .filter(Boolean)
  ).size || 0;

  const topSeedRow = [...rows]
    .filter(row => clean(row[headerMap.uclPot]))
    .sort((a, b) => {
      const potDiff = toNumber(a[headerMap.uclPot]) - toNumber(b[headerMap.uclPot]);
      if (potDiff !== 0) return potDiff;

      return clean(a[headerMap.teamName]).localeCompare(clean(b[headerMap.teamName]));
    })[0];

  return {
    activeTeams: rows.length,
    groupsUsed: assignedGroups.size || groupNames.length,
    potsUsed: potCount,
    teamsPerGroup: rows.length && groupNames.length
      ? Math.round(rows.length / groupNames.length)
      : 0,
    fixtures: fixtures.length,
    format: '18 teams → 3 groups of 6',
    groupList: groupNames.join(', ') || 'N/A',
    topSeed: topSeedRow
      ? `\`${clean(topSeedRow[headerMap.shortName])}\` ${clean(topSeedRow[headerMap.teamName])}`
      : 'N/A'
  };
}

function buildDrawDescription(isGenerated = false) {
  const base = isGenerated
    ? `${safeEmoji(E.correct, '✅')} UCL groups and fixtures were generated and saved.\n`
    : `${safeEmoji(E.info || E.Badge, '📌')} Current UCL groups loaded from the Teams sheet.\n`;

  return (
    base +
    `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} **Format:** 18 teams → 3 groups of 6.\n` +
    `${safeEmoji(E.rank, '🏅')} **Match IDs:** UCL GS-A-1 • UCL GS-B-1 • UCL GS-C-1.\n` +
    `${safeEmoji(E.correct, '✅')} **Qualification:** Top 2 from each group + best 2 third-place teams.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ucldraw')
    .setDescription('Generate or view the UCL group draw')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Draw active UCL teams into groups using existing UCL pots')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View the current UCL group draw from the Teams sheet')
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
      headerMap.uclPot === -1 ||
      headerMap.uclGroup === -1
    ) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is missing one of these columns: Team Name, Short Name, UCL Status, UCL Pot, UCL Group.`
      };
    }

    const activeUclTeams = getActiveTeamsByCompetition(
      teamRows,
      headerMap,
      'ucl'
    );

    if (!activeUclTeams.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No active UCL teams found.`
      };
    }

    const missingPot = activeUclTeams.some(
      row => !clean(row[headerMap.uclPot])
    );

    if (missingPot) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Some active UCL teams do not have a UCL Pot yet.`
      };
    }

    const groupNames = ['A', 'B', 'C'];

    if (subcommand === 'view') {
      const groupedFields = buildGroupedOutput(
        activeUclTeams,
        headerMap,
        groupNames
      ).filter(field => field.value !== 'No teams drawn.');

      const fixturesSheet = await cachedGetData('UCL_Coop_Group_Fixtures!A:J')
        .catch(() => []);

      const fixtureRows = Array.isArray(fixturesSheet)
        ? fixturesSheet.slice(1)
        : [];

      const fixtures = fixtureRows.map(row => ({
        md: clean(row[0]),
        homeShort: clean(row[7]),
        awayShort: clean(row[8])
      }));

      const summary = buildDrawSummary(
        activeUclTeams,
        headerMap,
        groupNames,
        fixtures
      );

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.UCL || E.calendar, '🏆')} UCL Group Draw`)
            .setDescription(buildDrawDescription(false))
            .addFields(
              { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
              { name: 'Groups', value: String(summary.groupsUsed), inline: true },
              { name: 'Fixtures', value: String(summary.fixtures), inline: true },
              { name: 'Format', value: summary.format, inline: true },
              { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
              { name: 'Top Seed', value: summary.topSeed, inline: true },
              ...groupedFields,
              {
                name: `${safeEmoji(E.calendar, '📅')} Fixture Preview`,
                value: buildFixturePreview(fixtures),
                inline: false
              }
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'UCL Draw • Group Stage IDs enabled' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.`
      };
    }

    const setupError = validateUclDrawSetup(activeUclTeams, headerMap);

    if (setupError) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} ${setupError}`
      };
    }

    const drawnRows = drawThreeGroupsFromSixPots(
      activeUclTeams,
      headerMap
    );

    const groupMap = new Map(
      drawnRows.map(row => [
        clean(row[headerMap.teamName]).toLowerCase(),
        clean(row[headerMap.uclGroup])
      ])
    );

    const updatedRows = teamRows.map(row => {
      const next = [...row];

      const teamName = clean(row[headerMap.teamName]).toLowerCase();

      if (groupMap.has(teamName)) {
        next[headerMap.uclGroup] = groupMap.get(teamName);
      }

      return next;
    });

    await updateData('Teams!A2:Z', updatedRows);

    const activeAfterDraw = updatedRows.filter(
      row => clean(row[headerMap.uclStatus]).toLowerCase() === 'active'
    );

    const fixtures = buildAllGroupFixtures(
      activeAfterDraw,
      headerMap,
      groupNames
    );

    const fixtureRows = fixtures.map(fixture => [
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
  fixtureRows
);

    invalidateSheetCache([
      'Teams!',
      'UCL_Coop_Group_Fixtures!'
    ]);

    const groupedFields = buildGroupedOutput(
      activeAfterDraw,
      headerMap,
      groupNames
    ).filter(field => field.value !== 'No teams drawn.');

    const summary = buildDrawSummary(
      activeAfterDraw,
      headerMap,
      groupNames,
      fixtures
    );

    sendAuditLog(interaction, {
      title: '🏆 UCL Draw Generated',
      description: 'UCL groups and fixtures generated successfully.',
      color: 0x5865F2,
      fields: [
        { name: 'Teams', value: String(summary.activeTeams), inline: true },
        { name: 'Groups', value: String(summary.groupsUsed), inline: true },
        { name: 'Fixtures', value: String(summary.fixtures), inline: true },
        { name: 'Format', value: summary.format, inline: false }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.UCL, '✅')} UCL Draw Generated`)
          .setDescription(buildDrawDescription(true))
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Groups', value: String(summary.groupsUsed), inline: true },
            { name: 'Fixtures', value: String(summary.fixtures), inline: true },
            { name: 'Format', value: summary.format, inline: true },
            { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
            { name: 'Top Seed', value: summary.topSeed, inline: true },
            ...groupedFields,
            {
              name: `${safeEmoji(E.calendar, '📅')} Fixture Preview`,
              value: buildFixturePreview(fixtures),
              inline: false
            }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'UCL Draw • Match IDs: UCL GS-A-1 format' })
      ]
    };
  }
};
