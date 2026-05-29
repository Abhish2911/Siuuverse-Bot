const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData, getData } = require('../utils/sheets');
const { clean, toNumber, getTeamsHeaderMap } = require('../utils/competitionHelpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return ownerIds.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;
}

function buildStandingsRows(rows) {
  return rows
    .slice(1)
    .filter(row => clean(row[0]) || clean(row[1]))
    .map(row => ({
      team: clean(row[0]),
      teamNormalized: normalize(row[0]),

      seasons: toNumber(row[1]),
      matches: toNumber(row[2]),
      wins: toNumber(row[3]),
      draws: toNumber(row[4]),
      losses: toNumber(row[5]),
      goals: toNumber(row[6]),
      goalsAgainst: toNumber(row[7]),
      gd: toNumber(row[8]),
      points: toNumber(row[9]),

      leagueTitles: toNumber(row[10]),
      runnerUps: toNumber(row[11]),

      faCups: toNumber(row[12]),
      faRunnerUps: toNumber(row[13]),

      carabaoCups: toNumber(row[14]),
      carabaoRunnerUps: toNumber(row[15]),

      ucl: toNumber(row[16]),
      uclRunnerUps: toNumber(row[17]),

      fairPlayRaw: clean(row[18]),
      type: clean(row[19])
    }));
}

function getFairPlayScore(raw) {
  if (!raw || raw.toUpperCase() === 'N/A') return 0;
  return toNumber(raw);
}

function buildPowerRanking(standingsRows) {
  const filtered = standingsRows.filter(row => row.team);

  return filtered
    .map(row => {
      const fairPlayScore = getFairPlayScore(row.fairPlayRaw);

      const trophyScore =
        row.leagueTitles * 40 +
        row.ucl * 35 +
        row.faCups * 25 +
        row.carabaoCups * 20 +
        row.runnerUps * 10 +
        row.uclRunnerUps * 8 +
        row.faRunnerUps * 6 +
        row.carabaoRunnerUps * 4;

      const performanceScore =
        row.points * 5 +
        row.gd * 2 +
        row.goals -
        fairPlayScore;

      return {
        ...row,
        powerScore: trophyScore + performanceScore
      };
    })
    .sort((a, b) => {
      if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.goals !== a.goals) return b.goals - a.goals;

      return a.team.localeCompare(b.team);
    })
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));
}

async function buildTeamIdMap() {
  try {
    const rows = await getData('Team_ID_Map!A:Z');

    if (!Array.isArray(rows) || rows.length <= 1) {
      return new Map();
    }

    const map = new Map();

    rows.slice(1).forEach(row => {
      const currentShort = clean(row[0]);
      const teamId = clean(row[1]).toUpperCase();
      const currentName = clean(row[2]);
      const previousName = clean(row[3]);
      const previousShort = clean(row[4]);

      if (!teamId) return;

      const aliases = [
        currentName,
        previousName,
        currentShort,
        previousShort
      ]
        .filter(Boolean)
        .map(normalize);

      map.set(teamId, {
        currentName,
        aliases
      });
    });

    return map;
  } catch {
    return new Map();
  }
}

function findBestRankingMatch({
  teamName,
  shortName,
  teamId,
  ranking,
  teamIdMap
}) {
  const normalizedTeam = normalize(teamName);
  const normalizedShort = normalize(shortName);

  let matched =
    ranking.find(r => r.teamNormalized === normalizedTeam) ||
    ranking.find(r => r.teamNormalized.includes(normalizedTeam)) ||
    ranking.find(r => normalizedTeam.includes(r.teamNormalized));

  if (matched) return matched;

  if (normalizedShort) {
    matched =
      ranking.find(r => normalize(r.team).includes(normalizedShort));

    if (matched) return matched;
  }

  if (teamId && teamIdMap.has(teamId)) {
    const mapped = teamIdMap.get(teamId);

    matched = ranking.find(rankRow => {
      const normalizedRankTeam = normalize(rankRow.team);

      return mapped.aliases.some(alias => {
        return (
          alias === normalizedRankTeam ||
          normalizedRankTeam.includes(alias) ||
          alias.includes(normalizedRankTeam)
        );
      });
    });

    if (matched) return matched;
  }

  return null;
}

function buildRankingWithTeamMap(ranking, teamRows, headerMap, teamIdMap) {
  return teamRows
    .map(row => {
      const teamName = clean(row[headerMap.teamName]);
      const shortName = clean(row[headerMap.shortName]);
      const teamId = clean(row[headerMap.teamId] || '').toUpperCase();

      const matchedRanking = findBestRankingMatch({
        teamName,
        shortName,
        teamId,
        ranking,
        teamIdMap
      });

      return {
        team: teamName,
        shortName,

        powerScore: matchedRanking?.powerScore || 0,
        points: matchedRanking?.points || 0,
        gd: matchedRanking?.gd || 0,
        goals: matchedRanking?.goals || 0,

        sourceTeam: matchedRanking?.team || teamName
      };
    })
    .sort((a, b) => {
      if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.goals !== a.goals) return b.goals - a.goals;

      return a.team.localeCompare(b.team);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1
    }));
}

function applyRanksToTeams(teamRows, headerMap, ranking, targetColumn) {
  return teamRows.map(row => {
    const next = [...row];

    const teamName = clean(row[headerMap.teamName]);
    const shortName = clean(row[headerMap.shortName]);

    const rankingRow =
      ranking.find(r => normalize(r.team) === normalize(teamName)) ||
      ranking.find(r => normalize(r.shortName) === normalize(shortName));

    next[targetColumn] = rankingRow?.rank || '';

    if (headerMap.powerScore !== -1) {
      next[headerMap.powerScore] = rankingRow
        ? toNumber(rankingRow.powerScore)
        : 0;
    }

    return next;
  });
}

function buildRankingSummary(rows, type) {
  const topTeam = rows[0]
    ? `\`${clean(rows[0].shortName || rows[0].team)}\` ${clean(rows[0].team)}`
    : 'N/A';

  const secondTeam = rows[1]
    ? `\`${clean(rows[1].shortName || rows[1].team)}\` ${clean(rows[1].team)}`
    : 'N/A';

  const lastTeam = rows.length
    ? `\`${clean(rows[rows.length - 1].shortName || rows[rows.length - 1].team)}\` ${clean(rows[rows.length - 1].team)}`
    : 'N/A';

  return {
    teams: rows.length,
    topTeam,
    secondTeam,
    lastTeam,
    type:
      type === 'power'
        ? 'Power Rank'
        : type === 'fa'
          ? 'FA Cup Seed'
          : 'Carabao Seed'
  };
}

function buildRankingFields(rows, type) {
  const topHalf = rows.slice(0, Math.ceil(rows.length / 2));
  const bottomHalf = rows.slice(Math.ceil(rows.length / 2));

  const formatHalf = items =>
    items.length
      ? items
          .map(row => {
            const label =
              type === 'power'
                ? `${toNumber(row.powerScore)} pts`
                : `Seed ${row.rank}`;

            return `**${row.rank}.** \`${clean(row.shortName || row.team)}\` ${clean(row.team)} • ${label}`;
          })
          .join('\n')
      : 'No teams found.';

  return [
    {
      name: `${safeEmoji(E.rank, '🏅')} Top Order`,
      value: formatHalf(topHalf),
      inline: true
    },
    {
      name: `${safeEmoji(E.rank, '🏅')} Remaining Order`,
      value: formatHalf(bottomHalf),
      inline: true
    }
  ];
}

function buildRankingDescription(type, isGenerated = false) {
  const label =
    type === 'power'
      ? 'power ranking'
      : type === 'fa'
        ? 'FA Cup seed order'
        : 'Carabao Cup seed order';

  if (isGenerated) {
    return (
      `${safeEmoji(E.correct, '✅')} ${label.charAt(0).toUpperCase() + label.slice(1)} was generated from All_Time_Team_Stats and saved into Teams.\n` +
      `${safeEmoji(E.info || E.Badge, '📌')} Review the current order below before using it in draws or fixtures.`
    );
  }

  return (
    `${safeEmoji(E.info || E.Badge, '📌')} Current ${label} loaded from Teams.\n` +
    `${safeEmoji(E.rank, '🏅')} Teams are shown in saved order with score context where available.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('powerrank')
    .setDescription('Generate or view coop power rankings and cup seeds')
    .addSubcommand(subcommand =>
      subcommand
        .setName('generate')
        .setDescription('Generate power ranks or seeds from all-time team stats')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('What to generate')
            .setRequired(true)
            .addChoices(
              { name: 'Power Rank', value: 'power' },
              { name: 'FA Cup Seed', value: 'fa' },
              { name: 'Carabao Seed', value: 'carabao' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View power ranks or seeds from Teams sheet')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('What to view')
            .setRequired(true)
            .addChoices(
              { name: 'Power Rank', value: 'power' },
              { name: 'FA Cup Seed', value: 'fa' },
              { name: 'Carabao Seed', value: 'carabao' }
            )
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const type = interaction.options.getString('type');

    const [teamsSheet, allTimeTeams, teamIdMap] = await Promise.all([
      cachedGetData('Teams!A:Z'),
      cachedGetData('All_Time_Team_Stats!A:Z'),
      buildTeamIdMap()
    ]);

    if (!Array.isArray(teamsSheet) || teamsSheet.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} Teams sheet is empty.`
      };
    }

    if (!Array.isArray(allTimeTeams) || allTimeTeams.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong || E.error, '❌')} All_Time_Team_Stats sheet is empty.`
      };
    }

    const header = teamsSheet[0];
    const teamRows = teamsSheet.slice(1).filter(row => clean(row[0]));
    const headerMap = getTeamsHeaderMap(header);

    const standingsRows = buildStandingsRows(allTimeTeams);

    const baseRanking = buildPowerRanking(standingsRows);

    const ranking = buildRankingWithTeamMap(
      baseRanking,
      teamRows,
      headerMap,
      teamIdMap
    );

    if (subcommand === 'view') {
      const columnIndex =
        type === 'power'
          ? headerMap.powerRank
          : type === 'fa'
            ? headerMap.faSeed
            : headerMap.carabaoSeed;

      const viewRows = teamRows
        .map(row => ({
          team: clean(row[headerMap.teamName]),
          shortName: clean(row[headerMap.shortName]),
          rank: toNumber(row[columnIndex]),
          powerScore: toNumber(row[headerMap.powerScore])
        }))
        .filter(row => row.team && row.rank > 0)
        .sort((a, b) => a.rank - b.rank);

      const summary = buildRankingSummary(viewRows, type);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.stats || E.trophy_animated, '📊')} ${summary.type} Overview`)
            .setDescription(buildRankingDescription(type, false))
            .addFields(
              { name: 'Teams', value: String(summary.teams), inline: true },
              { name: 'Top Team', value: summary.topTeam, inline: true },
              { name: 'Second Team', value: summary.secondTeam, inline: true },
              { name: 'Last Team', value: summary.lastTeam, inline: true },
              ...buildRankingFields(viewRows, type)
            )
            .setColor(0x5865F2)
        ]
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: `${safeEmoji(E.lock || E.error, '🚫')} Owner only command.`
      };
    }

    const targetColumn =
      type === 'power'
        ? headerMap.powerRank
        : type === 'fa'
          ? headerMap.faSeed
          : headerMap.carabaoSeed;

    const updatedRows = applyRanksToTeams(
      teamRows,
      headerMap,
      ranking,
      targetColumn
    );

    await updateData('Teams!A2:Z', updatedRows);

    invalidateSheetCache(['Teams!']);

    const title =
      type === 'power'
        ? 'Power Rank Generated'
        : type === 'fa'
          ? 'FA Cup Seeds Generated'
          : 'Carabao Seeds Generated';

    sendAuditLog(interaction, {
      title: `📊 ${title}`,
      description: `${title} from All_Time_Team_Stats and saved into Teams.`,
      color: 0x5865F2
    });

    const summary = buildRankingSummary(ranking, type);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct || E.stats, '✅')} ${title}`)
          .setDescription(buildRankingDescription(type, true))
          .addFields(
            {
              name: 'Teams Updated',
              value: String(updatedRows.length),
              inline: true
            },
            {
              name: 'Top Team',
              value: summary.topTeam,
              inline: true
            },
            {
              name: 'Second Team',
              value: summary.secondTeam,
              inline: true
            },
            {
              name: 'Saved To',
              value: clean(header[targetColumn]) || 'Teams',
              inline: true
            },
            ...buildRankingFields(ranking, type)
          )
          .setColor(0x2ECC71)
          .setFooter({
            text: 'Power Ranking • Generated from All_Time_Team_Stats'
          })
      ]
    };
  }
};
