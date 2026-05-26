const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn
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

function getUclPotForRank(index) {
  return String(Math.floor(index / 3) + 1);
}

function assignUclPotsForThreeGroups(rows, headerMap, potIndex) {
  return rows.map((row, index) => {
    const next = [...row];
    next[potIndex] = getUclPotForRank(index);
    return next;
  });
}

function getExpectedUclGroups() {
  return 3;
}

function getTeamsPerPot() {
  return 3;
}

function formatPotLines(rows) {
  return rows
    .map(row => {
      const pot = clean(row.pot);
      return `**${row.rank}.** \`${clean(row.shortName)}\` ${clean(row.team)} • Pot ${pot}`;
    })
    .join('\n') || 'No teams found.';
}

function buildPotFields(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    const pot = clean(row.pot) || 'Unassigned';
    if (!grouped.has(pot)) grouped.set(pot, []);
    grouped.get(pot).push(row);
  });

  return [...grouped.entries()]
    .sort((a, b) => toNumber(a[0]) - toNumber(b[0]))
    .map(([pot, items]) => ({
      name: `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} Pot ${pot}`,
      value: items
        .map((row, index) => `**${index + 1}.** \`${clean(row.shortName)}\` ${clean(row.team)} • PR ${row.rank}`)
        .join('\n') || 'No teams.',
      inline: false
    }));
}

function buildPotSummary(rows) {
  const potCount = new Set(rows.map(row => row.pot).filter(Boolean)).size || 0;
  const topSeed = rows[0];
  const expectedGroups = getExpectedUclGroups();
  const teamsPerPot = getTeamsPerPot();

  return {
    activeTeams: rows.length,
    potsUsed: potCount,
    expectedGroups,
    teamsPerPot,
    expectedPots: rows.length ? Math.ceil(rows.length / teamsPerPot) : 0,
    topSeed: topSeed ? `\`${clean(topSeed.shortName)}\` ${clean(topSeed.team)}` : 'N/A'
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uclpots')
    .setDescription('Generate or view UCL pots from the Teams sheet')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate UCL pots from Power Rank for active UCL teams')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View current UCL pots from the Teams sheet')
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
      headerMap.powerRank === -1 ||
      headerMap.uclPot === -1 ||
      headerMap.uclStatus === -1
    ) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is missing one of these columns: Team Name, Short Name, Power Rank, UCL Pot, UCL Status.`
      };
    }

    const activeUclTeams = getActiveTeamsByCompetition(teamRows, headerMap, 'ucl');

    if (!activeUclTeams.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No active UCL teams found. Set UCL Status to Active for participating teams first.`
      };
    }

    const sortedByPowerRank = sortTeamsByColumn(activeUclTeams, headerMap.powerRank, headerMap.teamName);

    if (subcommand === 'view') {
      const rows = sortedByPowerRank
        .map(row => ({
          team: clean(row[headerMap.teamName]),
          shortName: clean(row[headerMap.shortName]),
          rank: toNumber(row[headerMap.powerRank]),
          pot: clean(row[headerMap.uclPot])
        }))
        .filter(row => row.team && row.pot)
        .sort((a, b) => {
          const potDiff = toNumber(a.pot) - toNumber(b.pot);
          if (potDiff !== 0) return potDiff;
          return a.rank - b.rank;
        });

      const summary = buildPotSummary(rows);
      const potFields = buildPotFields(rows);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.UCL || E.trophy_animated, '🏆')} UCL Pots Overview`)
            .setDescription(
              `${safeEmoji(E.info || E.Badge, '📌')} Current UCL pots loaded from the Teams sheet.\n` +
              `${safeEmoji(E.rank, '🏅')} Format: **18 teams → 3 groups of 6**. Pots are built as **6 pots of 3 teams**.`
            )
            .addFields(
              { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
              { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
              { name: 'Groups', value: String(summary.expectedGroups), inline: true },
              { name: 'Teams / Pot', value: String(summary.teamsPerPot), inline: true },
              { name: 'Top Seed', value: summary.topSeed, inline: true },
              ...potFields
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'UCL Pots • 3 groups of 6 format' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    const potAssignedRows = assignUclPotsForThreeGroups(sortedByPowerRank, headerMap, headerMap.uclPot);

    if (activeUclTeams.length !== 18) {
      return {
        content:
          `${safeEmoji(E.wrong || E.error, '❌')} UCL format expects exactly **18 active teams**.\n` +
          `Current active UCL teams: **${activeUclTeams.length}**\n` +
          `Set UCL Status to Active for 18 teams before generating pots.`
      };
    }

    const assignedMap = new Map(
      potAssignedRows.map(row => [clean(row[headerMap.teamName]).toLowerCase(), clean(row[headerMap.uclPot])])
    );

    const updatedRows = teamRows.map(row => {
      const next = [...row];
      const teamName = clean(row[headerMap.teamName]).toLowerCase();

      if (assignedMap.has(teamName)) {
        next[headerMap.uclPot] = assignedMap.get(teamName);
      }

      return next;
    });

    await updateData('Teams!A2:Z', updatedRows);
    invalidateSheetCache(['Teams!']);

    const outputRows = updatedRows
      .filter(row => clean(row[headerMap.uclStatus]).toLowerCase() === 'active')
      .map(row => ({
        team: clean(row[headerMap.teamName]),
        shortName: clean(row[headerMap.shortName]),
        rank: toNumber(row[headerMap.powerRank]),
        pot: clean(row[headerMap.uclPot])
      }))
      .sort((a, b) => {
        const potDiff = toNumber(a.pot) - toNumber(b.pot);
        if (potDiff !== 0) return potDiff;
        return a.rank - b.rank;
      });

    sendAuditLog(interaction, {
      title: '🏆 UCL Pots Generated',
      description: 'UCL pots were generated from Power Rank and saved into Teams sheet.',
      color: 0x5865F2,
      fields: [
        { name: 'Active Teams', value: String(activeUclTeams.length), inline: true },
        { name: 'Groups', value: '3', inline: true },
        { name: 'Pots Used', value: String(new Set(outputRows.map(row => row.pot)).size || 0), inline: true },
        { name: 'Teams / Pot', value: '3', inline: true }
      ]
    });

    const summary = buildPotSummary(outputRows);
    const potFields = buildPotFields(outputRows);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.UCL, '✅')} UCL Pots Generated`)
          .setDescription(
            `${safeEmoji(E.correct, '✅')} UCL pots were generated from Power Rank and saved into the Teams sheet.\n` +
            `${safeEmoji(E.info || E.Badge, '📌')} Format: **18 teams → 3 groups of 6** using **6 pots of 3 teams**.`
          )
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Pots Used', value: String(summary.potsUsed), inline: true },
            { name: 'Groups', value: String(summary.expectedGroups), inline: true },
            { name: 'Teams / Pot', value: String(summary.teamsPerPot), inline: true },
            { name: 'Saved To', value: clean(header[headerMap.uclPot]) || 'UCL Pot', inline: true },
            ...potFields
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'UCL Pots • 3 groups of 6 format' })
      ]
    };
  }
};