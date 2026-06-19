const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData } = require('../utils/sheets');
const { splitPlayers } = require('../utils/format');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      statsRange: 'FA_Cup_Coop_Team_Stats!A:C'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      statsRange: 'Carabao_Coop_Team_Stats!A:C'
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      statsRange: 'UCL_Coop_Team_Stats!A:C'
    };
  }

  return {
    key: 'league',
    label: 'League',
    statsRange: 'Team_Stats!A:C'
  };
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractDiscordId(value) {
  const text = String(value || '').trim();
  const mentionMatch = text.match(/<@!?(\d{15,25})>/);
  if (mentionMatch) return mentionMatch[1];

  const rawIdMatch = text.match(/\b\d{15,25}\b/);
  return rawIdMatch ? rawIdMatch[0] : null;
}

function parseTeamColor(value) {
  const color = String(value || '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return null;
  return parseInt(color.replace('#', ''), 16);
}

function getStatIcon(stat) {
  const lower = String(stat || '').toLowerCase();

  if (lower.includes('goal')) return safeEmoji(E.goal, '⚽');
  if (lower.includes('point') || lower.includes('pts')) return safeEmoji(E.goldenBoot, '🏆');
  if (lower.includes('win')) return safeEmoji(E.win, '✅');
  if (lower.includes('draw')) return safeEmoji(E.draw, '🤝');
  if (lower.includes('loss') || lower.includes('lose')) return safeEmoji(E.lose, '❌');
  if (lower.includes('fair')) return safeEmoji(E.fairplay || E.fairPlay, '🕊️');
  if (lower.includes('yellow')) return safeEmoji(E.yellowCard, '🟨');
  if (lower.includes('red')) return safeEmoji(E.redCard, '🟥');
  if (lower.includes('tackle')) return safeEmoji(E.tackle, '🛡️');
  if (lower.includes('interception') || lower.includes('intercept')) return safeEmoji(E.interception, '✂️');
  if (lower.includes('save')) return safeEmoji(E.save, '🧤');
  if (lower.includes('assist')) return safeEmoji(E.assist || E.playmaker, '🎯');
  if (lower.includes('mvp')) return safeEmoji(E.mvp, '⭐');
  if (lower.includes('defense') || lower.includes('defence')) return safeEmoji(E.defense, '🛡️');

  return safeEmoji(E.Stats, '📊');
}

function buildTeamMap(teamsRows) {
  const map = new Map();

  if (!Array.isArray(teamsRows)) return map;

  teamsRows.slice(1).forEach(row => {
    const teamName = String(row[0] || '').trim();
    const players = splitPlayers(row[1]);
    const shortName = String(row[2] || '').trim().toUpperCase();
    const logo = String(row[3] || '').trim();
    const captainId = extractDiscordId(row[4]);
    const userIds = String(row[5] || '').split(',').map(extractDiscordId).filter(Boolean);
    const stadium = String(row[6] || '').trim();
    const color = String(row[7] || '').trim();

    const info = { teamName, shortName, logo, stadium, color, players, captainId, userIds };

    [teamName, shortName].filter(Boolean).forEach(key => {
      map.set(normalize(key), info);
    });
  });

  return map;
}

function getTeamInfo(teamMap, teamValue) {
  const value = String(teamValue || '').trim();
  const key = normalize(value);
  return teamMap.get(key) || null;
}

function formatTeamValue(teamValue, teamMap) {
  const value = String(teamValue || '').trim();
  const info = getTeamInfo(teamMap, value);

  if (!info) return `\`${value || 'N/A'}\``;

  const captainMention = info.captainId ? ` • <@${info.captainId}>` : '';
  return `\`${info.shortName || value}\` **${info.teamName || value}**${captainMention}`;
}

function buildRecordRows(rows, teamMap) {
  return rows.slice(0, 10).map((row, index) => {
    const stat = String(row[0] || '').trim();
    const team = String(row[1] || '').trim();
    const value = String(row[2] || '').trim();
    const icon = getStatIcon(stat);
    const statValue = value ? ` - **${value}** ${icon}` : ` ${icon}`;

    return `**${index + 1}.** ${formatTeamValue(team, teamMap)}${statValue}\n> ${icon} ${stat}`;
  }).join('\n');
}

function buildTeamStatsSummary(rows, competition, teamMap, standingsRows = []) {
  const standings = Array.isArray(standingsRows)
    ? standingsRows.slice(1).filter(row => String(row[1] || '').trim())
    : [];

  standings.sort((a, b) => {
    const ptsA = Number(a[9] || 0);
    const ptsB = Number(b[9] || 0);

    if (ptsB !== ptsA) return ptsB - ptsA;

    const gdA = Number(a[8] || 0);
    const gdB = Number(b[8] || 0);

    return gdB - gdA;
  });

  const formatStandingTeam = row => {
    if (!row) return 'N/A';

    const teamName = String(row[1] || '').trim();
    const info = getTeamInfo(teamMap, teamName);

    return `\`${info?.shortName || teamName}\` ${info?.teamName || teamName} • ${row[9] || 0} pts`;
  };

  return {
    competition: competition.label,
    records: rows.length,
    teamsLinked: Math.floor(teamMap.size / 2),
    leader: formatStandingTeam(standings[0]),
    second: formatStandingTeam(standings[1]),
    third: formatStandingTeam(standings[2])
  };
}

function buildTeamStatsDescription(summary) {
  return (
    `${safeEmoji(E.Stats, '📊')} **Competition:** ${summary.competition}\n` +
    `${safeEmoji(E.played, '🎮')} **Records Found:** ${summary.records}\n` +
    `${safeEmoji(E.team, '🏟️')} **Teams Linked:** ${summary.teamsLinked}\n\n` +
    `${safeEmoji(E.goldenBoot || E.goal, '🥇')} **Leader:** ${summary.leader}\n` +
    `${safeEmoji(E.runnerUp || E.medal, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamstats')
    .setDescription('Show competition team stats')
    .addStringOption(option =>
      option
        .setName('competition')
        .setDescription('Competition to show team stats for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const competitionKey = interaction.options.getString('competition') || 'league';
    const competition = getCompetitionConfig(competitionKey);
    const [data, teams, standings] = await Promise.all([
      getData(competition.statsRange).catch(() => []),
      getData('Teams!A:Z'),
      getData('Standings!A:Z').catch(() => [])
    ]);

    const rows = Array.isArray(data)
      ? data.slice(1).filter(r => String(r[0] || '').trim() && String(r[1] || '').trim())
      : [];
    if (!rows.length) {
      return { content: `${safeEmoji(E.wrong, '❌')} No ${competition.label} team stats found.` };
    }

    const teamMap = buildTeamMap(teams);
    const summary = buildTeamStatsSummary(
      rows,
      competition,
      teamMap,
      standings
    );
    const topRows = rows.slice(0, 5);
    const defensiveRows = rows.filter(row => {
      const stat = String(row[0] || '').toLowerCase();
      return stat.includes('tackle') || stat.includes('interception') || stat.includes('intercept') || stat.includes('save') || stat.includes('defense') || stat.includes('defence');
    }).slice(0, 5);

    const standingsLeader = Array.isArray(standings)
      ? standings.slice(1).sort((a, b) => {
          const ptsA = Number(a[9] || 0);
          const ptsB = Number(b[9] || 0);
          if (ptsB !== ptsA) return ptsB - ptsA;
          return Number(b[8] || 0) - Number(a[8] || 0);
        })[0]
      : null;

    const leader = getTeamInfo(teamMap, standingsLeader?.[1]);
    const embedColor = parseTeamColor(leader?.color) || 0x00ffff;

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.Stats, '📊')} ${competition.label} Team Stats`)
      .setDescription(buildTeamStatsDescription(summary))
      .addFields(
        {
          name: `${safeEmoji(E.goldenBoot, '🏆')} Top Team Records`,
          value: buildRecordRows(topRows, teamMap) || 'No records',
          inline: false
        },
        {
          name: `${safeEmoji(E.defense, '🛡️')} Defensive Records`,
          value: buildRecordRows(defensiveRows, teamMap) || 'No defensive records',
          inline: false
        },
        {
          name: `${safeEmoji(E.fire, '🔥')} Leaderboard Focus`,
          value: 'Shows top team stat records with linked team tags, captain mentions and defensive tracking.',
          inline: false
        },
        {
          name: `${safeEmoji(E.team, '🏟️')} Records Found`,
          value: String(rows.length),
          inline: true
        },
        {
          name: `${safeEmoji(E.played, '🎮')} Teams Linked`,
          value: String(Math.floor(teamMap.size / 2)),
          inline: true
        },
        {
          name: `${safeEmoji(E.calendar, '📅')} Competition`,
          value: competition.label,
          inline: true
        }
      )
      .setColor(embedColor)
      .setFooter({ text: `${competition.label} Team Stats • Goals, discipline and defensive records` })
      .setTimestamp();

    if (leader?.logo && /^https?:\/\//i.test(leader.logo)) {
      embed.setThumbnail(leader.logo);
    }

    return {
      embeds: [embed]
    };
  }
};
