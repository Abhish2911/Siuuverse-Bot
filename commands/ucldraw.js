const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition
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

function getGroupNames(teamCount) {
  return ['A', 'B', 'C'];
}

function shuffleRows(rows) {
  const copy = [...rows];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function drawThreeGroupsFromSixPots(rows, headerMap) {
  const groupNames = ['A', 'B', 'C'];
  const groupedByPot = new Map();

  rows.forEach(row => {
    const pot = clean(row[headerMap.uclPot]);
    if (!groupedByPot.has(pot)) groupedByPot.set(pot, []);
    groupedByPot.get(pot).push(row);
  });

  const drawnRows = [];

  for (let pot = 1; pot <= 6; pot++) {
    const potTeams = groupedByPot.get(String(pot)) || [];

    if (potTeams.length !== 3) {
      throw new Error(`Pot ${pot} must have exactly 3 teams for 3 groups. Found ${potTeams.length}.`);
    }

    const shuffled = shuffleRows(potTeams);

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

function buildDrawSummary(rows, headerMap, groupNames) {
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
    teamsPerGroup: rows.length && groupNames.length ? Math.round(rows.length / groupNames.length) : 0,
    format: '18 teams → 3 groups of 6',
    groupList: groupNames.join(', ') || 'N/A',
    topSeed: topSeedRow
      ? `\`${clean(topSeedRow[headerMap.shortName])}\` ${clean(topSeedRow[headerMap.teamName])}`
      : 'N/A'
  };
}

function buildDrawDescription(isGenerated = false) {
  const base = isGenerated
    ? `${safeEmoji(E.correct, '✅')} UCL groups were drawn and saved into the Teams sheet.\n`
    : `${safeEmoji(E.info || E.Badge, '📌')} Current UCL groups loaded from the Teams sheet.\n`;

  return (
    base +
    `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} **Format:** 18 teams → 3 groups of 6.\n` +
    `${safeEmoji(E.rank, '🏅')} **Pots:** 6 pots of 3 teams. Each group receives one team from every pot.\n` +
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
      return { content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is empty.` };
    }

    const header = teamsSheet[0];
    const headerMap = getTeamsHeaderMap(header);
    const teamRows = teamsSheet.slice(1).filter(row => clean(row[headerMap.teamName]));

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

    const activeUclTeams = getActiveTeamsByCompetition(teamRows, headerMap, 'ucl');

    if (!activeUclTeams.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No active UCL teams found. Set UCL Status to Active first.`
      };
    }

    const missingPot = activeUclTeams.some(row => !clean(row[headerMap.uclPot]));
    if (missingPot) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Some active UCL teams do not have a UCL Pot yet. Run /uclpots generate first.`
      };
    }

    const groupNames = getGroupNames(activeUclTeams.length);
    const setupError = validateUclDrawSetup(activeUclTeams, headerMap);

    if (subcommand === 'view') {
      const groupedFields = buildGroupedOutput(activeUclTeams, headerMap, groupNames)
        .filter(field => field.value !== 'No teams drawn.');

      if (!groupedFields.length) {
        return {
          embeds: [
            new EmbedBuilder()
              .setTitle(`${safeEmoji(E.UCL || E.calendar, '🏆')} UCL Group Draw`)
              .setDescription('No UCL groups have been drawn yet.')
              .setColor(0x5865F2)
          ]
        };
      }

      const summary = buildDrawSummary(activeUclTeams, headerMap, groupNames);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.UCL || E.calendar, '🏆')} UCL Group Draw`)
            .setDescription(buildDrawDescription(false))
            .addFields(
              { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
              { name: 'Groups', value: String(summary.groupsUsed), inline: true },
              { name: 'Teams / Group', value: String(summary.teamsPerGroup), inline: true },
              { name: 'Format', value: summary.format, inline: true },
              { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
              { name: 'Group List', value: summary.groupList, inline: true },
              { name: 'Top Seed', value: summary.topSeed, inline: true },
              { name: 'Loaded From', value: 'Teams', inline: true },
              ...groupedFields
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'UCL Draw • 3 groups of 6 format' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    if (setupError) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} ${setupError}`
      };
    }

    const drawnRows = drawThreeGroupsFromSixPots(activeUclTeams, headerMap);

    const groupMap = new Map(
      drawnRows.map(row => [clean(row[headerMap.teamName]).toLowerCase(), clean(row[headerMap.uclGroup])])
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
    invalidateSheetCache(['Teams!']);

    const activeAfterDraw = updatedRows.filter(row => clean(row[headerMap.uclStatus]).toLowerCase() === 'active');
    const groupedFields = buildGroupedOutput(activeAfterDraw, headerMap, groupNames)
      .filter(field => field.value !== 'No teams drawn.');

    const summary = buildDrawSummary(activeAfterDraw, headerMap, groupNames);

    sendAuditLog(interaction, {
      title: '🏆 UCL Group Draw Generated',
      description: 'UCL groups were drawn from existing UCL pots and saved into Teams sheet.',
      color: 0x5865F2,
      fields: [
        { name: 'Active Teams', value: String(activeUclTeams.length), inline: true },
        { name: 'Groups', value: groupNames.join(', '), inline: true },
        { name: 'Teams / Group', value: '6', inline: true },
        { name: 'Pots', value: '6 pots of 3', inline: true },
        { name: 'Qualification', value: 'Top 2 + best 2 third-place teams', inline: false }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.UCL, '✅')} UCL Group Draw Generated`)
          .setDescription(buildDrawDescription(true))
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Groups', value: String(summary.groupsUsed), inline: true },
            { name: 'Teams / Group', value: String(summary.teamsPerGroup), inline: true },
            { name: 'Format', value: summary.format, inline: true },
            { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
            { name: 'Group List', value: summary.groupList, inline: true },
            { name: 'Top Seed', value: summary.topSeed, inline: true },
            { name: 'Saved To', value: 'Teams', inline: true },
            ...groupedFields
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'UCL Draw • 3 groups of 6 format' })
      ]
    };
  }
};