const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn,
  assignSequentialValues
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

function formatSeedLines(rows) {
  return rows
    .map(row => `**${row.seed}.** \`${clean(row.shortName)}\` ${clean(row.team)}`)
    .join('\n') || 'No seeded teams found.';
}

function getCupSeedStage(seed) {
  const value = toNumber(seed);

  if (value >= 1 && value <= 4) {
    return {
      key: 'top4',
      label: 'Direct Quarter Final',
      emoji: safeEmoji(E.trophy_animated || E.Carabao, '🏆')
    };
  }

  return {
    key: 'round1',
    label: 'Round 1 / QFQ Path',
    emoji: safeEmoji(E.played, '🎮')
  };
}

function groupSeedsByCupStage(rows) {
  return {
    top4: rows.filter(row => getCupSeedStage(row.seed).key === 'top4'),
    round1: rows.filter(row => getCupSeedStage(row.seed).key === 'round1')
  };
}

function formatStageRows(rows) {
  return rows.length
    ? rows.map(row => `**${row.seed}.** \`${clean(row.shortName)}\` ${clean(row.team)} • PR ${row.rank}`).join('\n')
    : 'No teams.';
}

function buildSeedFields(rows) {
  const grouped = groupSeedsByCupStage(rows);

  return [
    {
      name: `${safeEmoji(E.trophy_animated || E.Carabao, '🏆')} Seeds 1–4 → Direct QF`,
      value: formatStageRows(grouped.top4),
      inline: false
    },
    {
      name: `${safeEmoji(E.played, '🎮')} Seeds 5–18 → Round 1 / QFQ Path`,
      value: formatStageRows(grouped.round1),
      inline: false
    }
  ];
}

function buildSeedSummary(rows, activeTeams) {
  const topSeed = rows[0]
    ? `\`${clean(rows[0].shortName)}\` ${clean(rows[0].team)}`
    : 'N/A';

  const lastSeed = rows.length
    ? `\`${clean(rows[rows.length - 1].shortName)}\` ${clean(rows[rows.length - 1].team)}`
    : 'N/A';

  const grouped = groupSeedsByCupStage(rows);

  return {
    activeTeams,
    seededTeams: rows.length,
    topSeed,
    lastSeed,
    top4Count: grouped.top4.length,
    qfqPathCount: grouped.round1.length,
    round1Count: grouped.round1.length
  };
}

function buildSeedDescription(isGenerated = false) {
  const base = isGenerated
    ? `${safeEmoji(E.correct, '✅')} Carabao Cup seeds were generated from Power Rank and saved into the Teams sheet.\n`
    : `${safeEmoji(E.info || E.Badge, '📌')} Current Carabao Cup seeds loaded from the Teams sheet.\n`;

  return (
    base +
    `${safeEmoji(E.Carabao || E.trophy_animated, '🏆')} **Cup Format:** Top 4 go direct to QF.\n` +
    `${safeEmoji(E.played, '🎮')} **Seeds 5–18:** start Round 1.\n` +
    `${safeEmoji(E.rank, '🏅')} **QFQ:** 7 Round 1 winners → 3 matches + 1 random bye → 4 QF qualifiers.\n` +
    `${safeEmoji(E.info || E.Badge, '📌')} Run Carabao Cup draw after reviewing these groups.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carabaoseed')
    .setDescription('Generate or view Carabao Cup seeds from the Teams sheet')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate Carabao Cup seeds from Power Rank for active Carabao Cup teams')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View current Carabao Cup seeds from the Teams sheet')
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
      headerMap.carabaoSeed === -1 ||
      headerMap.carabaoStatus === -1
    ) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is missing one of these columns: Team Name, Short Name, Power Rank, Carabao Seed, Carabao Status.`
      };
    }

    const activeCarabaoTeams = getActiveTeamsByCompetition(teamRows, headerMap, 'carabao');

    if (!activeCarabaoTeams.length) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} No active Carabao Cup teams found. Set Carabao Status to Active first.`
      };
    }

    const sortedByPowerRank = sortTeamsByColumn(activeCarabaoTeams, headerMap.powerRank, headerMap.teamName);

    if (subcommand === 'view') {
      const rows = sortedByPowerRank
        .map(row => ({
          team: clean(row[headerMap.teamName]),
          shortName: clean(row[headerMap.shortName]),
          rank: toNumber(row[headerMap.powerRank]),
          seed: toNumber(row[headerMap.carabaoSeed])
        }))
        .filter(row => row.team && row.seed > 0)
        .sort((a, b) => a.seed - b.seed || a.rank - b.rank || a.team.localeCompare(b.team));

      const summary = buildSeedSummary(rows, activeCarabaoTeams.length);
      const seedFields = buildSeedFields(rows);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.Carabao || E.trophy_animated, '🏆')} Carabao Cup Seeds Overview`)
            .setDescription(buildSeedDescription(false))
            .addFields(
              { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
              { name: 'Seeded Teams', value: String(summary.seededTeams), inline: true },
              { name: 'Direct QF', value: String(summary.top4Count), inline: true },
              { name: 'QFQ Path', value: String(summary.qfqPathCount), inline: true },
              { name: 'Round 1 Teams', value: String(summary.round1Count), inline: true },
              { name: 'Top Seed', value: summary.topSeed, inline: true },
              { name: 'Last Seed', value: summary.lastSeed, inline: true },
              ...seedFields
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'Carabao Cup Seeds • Top 4 direct QF + QFQ format' })
        ]
      };
    }

    if (!isOwner(interaction)) {
      return { content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.` };
    }

    const updatedRows = assignSequentialValues(teamRows, headerMap, sortedByPowerRank, headerMap.carabaoSeed);
    await updateData('Teams!A2:Z', updatedRows);
    invalidateSheetCache(['Teams!']);

    const outputRows = updatedRows
      .filter(row => clean(row[headerMap.carabaoStatus]).toLowerCase() === 'active')
      .map(row => ({
        team: clean(row[headerMap.teamName]),
        shortName: clean(row[headerMap.shortName]),
        rank: toNumber(row[headerMap.powerRank]),
        seed: toNumber(row[headerMap.carabaoSeed])
      }))
      .filter(row => row.seed > 0)
      .sort((a, b) => a.seed - b.seed || a.rank - b.rank || a.team.localeCompare(b.team));

    sendAuditLog(interaction, {
      title: '🏆 Carabao Cup Seeds Generated',
      description: 'Carabao Cup seeds were generated from Power Rank and saved into Teams sheet.',
      color: 0x5865F2,
      fields: [
        { name: 'Active Teams', value: String(activeCarabaoTeams.length), inline: true },
        { name: 'Seeded Teams', value: String(outputRows.length), inline: true },
        { name: 'Direct QF', value: String(buildSeedSummary(outputRows, activeCarabaoTeams.length).top4Count), inline: true },
        { name: 'QFQ Path', value: String(buildSeedSummary(outputRows, activeCarabaoTeams.length).qfqPathCount), inline: true },
        { name: 'Round 1 Teams', value: String(buildSeedSummary(outputRows, activeCarabaoTeams.length).round1Count), inline: true }
      ]
    });

    const summary = buildSeedSummary(outputRows, activeCarabaoTeams.length);
    const seedFields = buildSeedFields(outputRows);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.Carabao, '✅')} Carabao Cup Seeds Generated`)
          .setDescription(buildSeedDescription(true))
          .addFields(
            { name: 'Active Teams', value: String(summary.activeTeams), inline: true },
            { name: 'Seeded Teams', value: String(summary.seededTeams), inline: true },
            { name: 'Direct QF', value: String(summary.top4Count), inline: true },
            { name: 'QFQ Path', value: String(summary.qfqPathCount), inline: true },
            { name: 'Round 1 Teams', value: String(summary.round1Count), inline: true },
            { name: 'Top Seed', value: summary.topSeed, inline: true },
            { name: 'Saved To', value: clean(header[headerMap.carabaoSeed]) || 'Carabao Seed', inline: true },
            ...seedFields
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Carabao Cup Seeds • Top 4 direct QF + QFQ format' })
      ]
    };
  }
};