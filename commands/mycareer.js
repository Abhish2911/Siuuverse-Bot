const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractDiscordId(value) {
  const text = String(value || '').trim();
  const mentionMatch = text.match(/<@!?(\d{15,25})>/);
  if (mentionMatch) return mentionMatch[1];

  const rawIdMatch = text.match(/\b\d{15,25}\b/);
  return rawIdMatch ? rawIdMatch[0] : '';
}

function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

// Team ID is currently stored after Last Updated in All_Time_Player_Stats.
// Prefer the final archive columns first, then fall back to scanning for T001-style IDs.
function getCareerTeamId(row) {
  const preferredIndexes = [32, 31, 30]; // AG, AF, AE fallback if sheet shifts

  for (const index of preferredIndexes) {
    const value = String(row[index] || '').trim();
    if (/^T\d+$/i.test(value)) return value.toUpperCase();
  }

  return row
    .map(cell => String(cell || '').trim())
    .find(cell => /^T\d+$/i.test(cell))
    ?.toUpperCase() || '';
}

function buildTeamIdDirectory(teamIdRows) {
  const byId = new Map();
  const byShort = new Map();
  const byName = new Map();

  cleanRows(teamIdRows).forEach(row => {
    const currentShort = String(row[0] || '').trim().toUpperCase();
    const teamId = String(row[1] || '').trim();
    const currentName = String(row[2] || '').trim();
    const previousName = String(row[3] || '').trim();
    const previousShort = String(row[4] || '').trim().toUpperCase();

    const info = {
      currentShort,
      teamId,
      currentName,
      previousName,
      previousShort
    };

    if (teamId) byId.set(normalize(teamId), info);
    if (currentShort) byShort.set(normalize(currentShort), info);
    if (previousShort) byShort.set(normalize(previousShort), info);
    if (currentName) byName.set(normalize(currentName), info);
    if (previousName) byName.set(normalize(previousName), info);
  });

  return { byId, byShort, byName };
}

function getTeamInfoForCareerRow(row, teamDirectory) {
  const teamShort = String(row[2] || '').trim();
  const teamId = getCareerTeamId(row);

  return (
    teamDirectory.byId.get(normalize(teamId)) ||
    teamDirectory.byShort.get(normalize(teamShort)) ||
    teamDirectory.byName.get(normalize(teamShort)) ||
    null
  );
}

function formatTeamHistory(rows, teamDirectory) {
  const seen = new Set();
  const lines = [];

  rows.forEach(row => {
    const info = getTeamInfoForCareerRow(row, teamDirectory);
    const archiveShort = String(row[2] || '').trim();
    const teamId = getCareerTeamId(row);
    const currentName = info?.currentName || archiveShort || 'Unknown Team';
    const currentShort = info?.currentShort || archiveShort || 'N/A';
    const previousName = info?.previousName || currentName;
    const previousShort = info?.previousShort || currentShort;
    const stableId = info?.teamId || teamId || 'NO_ID';
    const key = normalize(`${stableId}-${currentShort}-${previousShort}`);

    if (seen.has(key)) return;
    seen.add(key);

    const changed = normalize(currentName) !== normalize(previousName) || normalize(currentShort) !== normalize(previousShort);
    const idText = stableId && stableId !== 'NO_ID' ? ` • ${stableId}` : '';

    lines.push(
      changed
        ? `> **${currentShort}** — ${currentName}${idText}\n> ↳ Previous: **${previousShort}** — ${previousName}`
        : `> **${currentShort}** — ${currentName}${idText}`
    );
  });

  return lines.length ? lines.join('\n') : 'N/A';
}

function playerMatches(row, query, userId) {
  const player = String(row[0] || '').trim();
  const discordId = extractDiscordId(row[1]);

  if (userId && discordId && discordId === userId) return true;
  if (!query) return false;

  const keys = [
    normalize(player),
    normalize(stripTeamPrefix(player)),
    normalize(query),
    normalize(stripTeamPrefix(query))
  ];

  return keys[0] === keys[2] || keys[1] === keys[2] || keys[0] === keys[3] || keys[1] === keys[3];
}

function awardMatches(row, careerNames) {
  const player = normalize(row[1]);
  return careerNames.has(player) || careerNames.has(normalize(stripTeamPrefix(row[1])));
}

function isCountableProfileAward(row) {
  const award = String(row[2] || '').toLowerCase();
  return !award.includes('winner') && !award.includes('champion') && !award.includes('runner') && !award.includes('relegated');
}

function buildCareerTotals(rows) {
  const totals = {
    seasons: new Set(),
    teams: new Set(),
    teamIds: new Set(),
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    assists: 0,
    ga: 0,
    mvp: 0,
    tackles: 0,
    interceptions: 0,
    yellow: 0,
    red: 0,
    trophies: 0,
    leagueTitles: 0,
    leagueRunnerUps: 0,
    faCups: 0,
    faRunnerUps: 0,
    carabaoCups: 0,
    carabaoRunnerUps: 0,
    ucl: 0,
    uclRunnerUps: 0,
    awards: 0,
    motm: 0
  };

  rows.forEach(row => {
    if (row[3]) totals.seasons.add(String(row[3]).trim());
    if (row[2]) totals.teams.add(String(row[2]).trim());
    const teamId = getCareerTeamId(row);
    if (teamId) totals.teamIds.add(teamId);

    totals.matches += toNumber(row[4]);
    totals.wins += toNumber(row[5]);
    totals.draws += toNumber(row[6]);
    totals.losses += toNumber(row[7]);
    totals.goals += toNumber(row[8]);
    totals.assists += toNumber(row[9]);
    totals.ga += toNumber(row[10]);
    totals.mvp += toNumber(row[11]);
    totals.tackles += toNumber(row[12]);
    totals.interceptions += toNumber(row[13]);
    // Removed: totals.saves += toNumber(row[14]);
    totals.yellow += toNumber(row[15]);
    totals.red += toNumber(row[16]);
    totals.trophies += toNumber(row[17]);
    totals.leagueTitles += toNumber(row[18]);
    totals.leagueRunnerUps += toNumber(row[19]);
    totals.faCups += toNumber(row[20]);
    totals.faRunnerUps += toNumber(row[21]);
    totals.carabaoCups += toNumber(row[22]);
    totals.carabaoRunnerUps += toNumber(row[23]);
    totals.ucl += toNumber(row[24]);
    totals.uclRunnerUps += toNumber(row[25]);
    totals.awards += toNumber(row[26]);
    totals.motm += toNumber(row[27]);
  });

  totals.winRate = totals.matches ? Math.round((totals.wins / totals.matches) * 100) : 0;
  return totals;
}

function getBestSeason(rows) {
  if (!rows.length) return null;

  const sorted = [...rows].sort((a, b) => {
    const aScore = toNumber(a[10]) + toNumber(a[11]) + toNumber(a[12]) + toNumber(a[13]) + toNumber(a[14]);
    const bScore = toNumber(b[10]) + toNumber(b[11]) + toNumber(b[12]) + toNumber(b[13]) + toNumber(b[14]);
    return bScore - aScore;
  });

  return sorted[0];
}

function getAwardEmoji(awardName) {
  const award = String(awardName || '').toLowerCase();

  if (award.includes('golden') || award.includes('boot')) {
    return safeEmoji(E.goldenBoot || E.goal, '⚽');
  }

  if (award.includes('playmaker')) {
    return safeEmoji(E.playmaker || E.assist, '🎯');
  }

  if (award.includes('mvp')) {
    return safeEmoji(E.mvp, '⭐');
  }

  if (award.includes('defender')) {
    return safeEmoji(E.bestDefender || E.defense || E.tackle, '🛡️');
  }

  if (award.includes('gk') || award.includes('keeper') || award.includes('glove')) {
    return safeEmoji(E.goalkeeper || E.save, '🧤');
  }

  if (award.includes('fair play') || award.includes('fairplay')) {
    return safeEmoji(E.fairplay || E.fairPlay, '🕊️');
  }

  if (award.includes('runner')) {
    return safeEmoji(E.runnerUp || E.leagueRunnerUp, '🥈');
  }

  if (award.includes('winner') || award.includes('champion') || award.includes('title')) {
    return safeEmoji(E.winner || E.leagueWinner, '👑');
  }

  if (award.includes('relegated')) {
    return safeEmoji(E.relegated || E.down || E.lose, '🔻');
  }

  return safeEmoji(E.badge || E.Badge, '🏅');
}

function buildCareerBadges(totals, awards) {
  const badges = [];

  if (totals.goals >= 100) badges.push('👑 Century Scorer');
  else if (totals.goals >= 50) badges.push('🔥 Goal Machine');
  else if (totals.goals >= 25) badges.push('⚽ Proven Finisher');

  if (totals.assists >= 75) badges.push('🎩 Assist Legend');
  else if (totals.assists >= 40) badges.push('🧠 Playmaking Genius');
  else if (totals.assists >= 20) badges.push('🎯 Creator');

  if (totals.ga >= 150) badges.push('🐐 All-Time Monster');
  else if (totals.ga >= 75) badges.push('💀 Career Threat');
  else if (totals.ga >= 40) badges.push('⚡ G/A Machine');

  if (totals.tackles >= 100) badges.push('🛡️ Defensive General');
  else if (totals.tackles >= 50) badges.push('🛡️ Tackle Machine');

  if (totals.interceptions >= 100) badges.push('✂️ Interception Legend');
  else if (totals.interceptions >= 50) badges.push('✂️ Passing Lane Hunter');


  if (totals.trophies >= 5 || totals.awards >= 10 || awards.length >= 10) badges.push('🏆 Trophy Cabinet');
  if (totals.winRate >= 70 && totals.matches >= 20) badges.push('👑 Elite Winner');
  if (totals.red === 0 && totals.yellow === 0 && totals.matches > 0) badges.push('🕊️ Clean Career');

  return badges.length ? badges.join('\n') : 'No career badges yet';
}

function getDisplayName(rows, fallback) {
  const best = rows.find(row => row[0]);
  const rawName = best?.[0] || fallback || 'Unknown Player';
  return stripTeamPrefix(rawName);
}

function createCareerButtons(activeView, targetType, targetValue) {
  const rawValue = String(targetValue || '').split('_')[0];
  const encodedValue = encodeURIComponent(rawValue).slice(0, 45);

  const makeButton = (view, label, emoji, style) =>
    new ButtonBuilder()
      .setCustomId(`mycareer_${view}_${targetType}_${encodedValue}`)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(style)
      .setDisabled(activeView === view);

  return new ActionRowBuilder().addComponents(
    makeButton('profile', 'Profile', '🖼️', ButtonStyle.Primary),
    makeButton('history', 'Career History', '📜', ButtonStyle.Secondary),
    makeButton('trophies', 'Trophies', '🏆', ButtonStyle.Success),
    makeButton('awards', 'Awards', '🏅', ButtonStyle.Danger)
  );
}

function getSeasonNumberLabel(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+)/);
  return match ? `S${match[1]}` : text || 'S?';
}

function formatCompactSeasonList(rows) {
  if (!rows.length) return '';

  return rows
    .map(row => `> ${safeEmoji(E.calendar, '📅')} ${getSeasonNumberLabel(row[0])}`)
    .join('\n');
}

function formatCompactAwardList(rows) {
  if (!rows.length) return '';

  const grouped = new Map();

  rows.forEach(row => {
    const awardName = String(row[2] || '').trim() || 'Award';
    if (!grouped.has(awardName)) grouped.set(awardName, []);
    grouped.get(awardName).push(row);
  });

  return [...grouped.entries()]
    .map(([awardName, awardRows], index) => {
      const seasons = awardRows
        .map(row => {
          const seasonLabel = `${safeEmoji(E.calendar, '📅')} ${getSeasonNumberLabel(row[0])}`;
          const value = String(row[3] || '').trim();
          return value ? `> ${seasonLabel} • ${value}` : `> ${seasonLabel}`;
        })
        .join('\n');

      return (
        `**${index + 1}.** ${getAwardEmoji(awardName)} **${awardName} (${awardRows.length})**\n` +
        `${seasons}`
      );
    })
    .join('\n\n');
}

function formatAllSeasonStats(rows) {
  if (!rows.length) return 'N/A';

  return [...rows]
    .sort((a, b) => String(a[3] || '').localeCompare(String(b[3] || ''), undefined, { numeric: true }))
    .map(row => {
      const season = getSeasonNumberLabel(row[3]);
      const team = String(row[2] || 'N/A').trim();
      const teamId = getCareerTeamId(row);
      const teamText = teamId ? `${team} • ${teamId}` : team;

      return (
        `> ${safeEmoji(E.calendar, '📅')} **${season}** — **${teamText}**\n` +
        `> ${safeEmoji(E.played, '🎮')} M: **${toNumber(row[4])}** • W: **${toNumber(row[5])}** • D: **${toNumber(row[6])}** • L: **${toNumber(row[7])}**\n` +
        `> ${safeEmoji(E.goal, '⚽')} G: **${toNumber(row[8])}** • ${safeEmoji(E.assist, '🎯')} A: **${toNumber(row[9])}** • ${safeEmoji(E.fire, '🔥')} G/A: **${toNumber(row[10])}** • ${safeEmoji(E.mvp, '⭐')} MVP: **${toNumber(row[11])}**\n` +
        `> ${safeEmoji(E.tackle, '🛡️')} Tackles: **${toNumber(row[12])}** • ${safeEmoji(E.interception, '✂️')} INT: **${toNumber(row[13])}**`
      );
    })
    .join('\n\n');
}

function buildTrophySummary(totals, awardRows, careerRows = []) {
  const grouped = {
    league: [],
    ucl: [],
    fa: [],
    carabao: [],
    other: []
  };

  const groupedRunnerUps = {
    league: [],
    ucl: [],
    fa: [],
    carabao: [],
    other: []
  };

  careerRows.forEach(row => {
    const season = row[3] || 'Season';

    if (toNumber(row[18]) > 0) grouped.league.push([season, '', 'Winner', row[18]]);
    if (toNumber(row[19]) > 0) groupedRunnerUps.league.push([season, '', 'Runner Up', row[19]]);

    if (toNumber(row[20]) > 0) grouped.fa.push([season, '', 'FA Cup Winner', row[20]]);
    if (toNumber(row[21]) > 0) groupedRunnerUps.fa.push([season, '', 'FA Cup Runner Up', row[21]]);

    if (toNumber(row[22]) > 0) grouped.carabao.push([season, '', 'Carabao Cup Winner', row[22]]);
    if (toNumber(row[23]) > 0) groupedRunnerUps.carabao.push([season, '', 'Carabao Cup Runner Up', row[23]]);

    if (toNumber(row[24]) > 0) grouped.ucl.push([season, '', 'UCL Winner', row[24]]);
    if (toNumber(row[25]) > 0) groupedRunnerUps.ucl.push([season, '', 'UCL Runner Up', row[25]]);
  });

  return {
    grouped,
    groupedRunnerUps,
    count: totals.trophies,
    runnerCount:
      totals.leagueRunnerUps +
      totals.faRunnerUps +
      totals.carabaoRunnerUps +
      totals.uclRunnerUps
  };
}

function buildAwardsOnly(awardRows) {
  const normalAwards = awardRows.filter(row => {
    const award = String(row[2] || '').toLowerCase();
    return !award.includes('winner') && !award.includes('champion') && !award.includes('runner') && !award.includes('relegated');
  });

  if (!normalAwards.length) {
    return {
      summary: '*No individual awards yet.*',
      attacking: '',
      defensive: '',
      special: ''
    };
  }

  const attacking = normalAwards.filter(row => {
    const award = String(row[2] || '').toLowerCase();
    return award.includes('golden') || award.includes('boot') || award.includes('playmaker') || award.includes('mvp');
  });

  const defensive = normalAwards.filter(row => {
    const award = String(row[2] || '').toLowerCase();
    return award.includes('defender') || award.includes('gk') || award.includes('keeper') || award.includes('glove');
  });

  const special = normalAwards.filter(row => !attacking.includes(row) && !defensive.includes(row));

  return {
    summary: `${safeEmoji(E.badge || E.Badge, '🏅')} **Total Individual Awards:** ${normalAwards.length}`,
    attacking: attacking.length ? formatCompactAwardList(attacking) : '',
    defensive: defensive.length ? formatCompactAwardList(defensive) : '',
    special: special.length ? formatCompactAwardList(special) : ''
  };
}

function buildCareerEmbed(view, data) {
  const {
    displayName,
    mention,
    totals,
    awardRows,
    profileAwardRows,
    careerRows,
    bestSeason,
    badges,
    thumbnail,
    teamHistory
  } = data;

  if (view === 'history') {
    return new EmbedBuilder()
      .setAuthor({ name: `${displayName} • Career History`, iconURL: thumbnail })
      .setTitle('📜 Career History')
      .setDescription(
        `# ${displayName}\n` +
        `${safeEmoji(E.calendar, '📅')} **Archived Seasons:** ${totals.seasons.size} (${[...totals.seasons].sort().map(getSeasonNumberLabel).join(', ') || 'N/A'})\n` +
        `${safeEmoji(E.team, '👥')} **Archived Teams:** ${[...totals.teams].filter(Boolean).join(', ') || 'N/A'}\n` +
        `🆔 **Team IDs:** ${[...totals.teamIds].filter(Boolean).join(', ') || 'N/A'}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(
        {
          name: `${safeEmoji(E.team, '👥')} Team History`,
          value: teamHistory,
          inline: false
        },
        {
          name: '━━━━━━━━━━━━━━━━━━━━',
          value: '\u200B',
          inline: false
        },
        {
          name: '📊 All Season Stats',
          value: formatAllSeasonStats(careerRows),
          inline: false
        }
      )
      .setThumbnail(thumbnail)
      .setColor(0x95A5A6)
      .setFooter({ text: 'Career History • Team movement and season-by-season stats' })
      .setTimestamp();
  }

  if (view === 'trophies') {
    const summary = buildTrophySummary(totals, awardRows, careerRows);
    const trophyFields = [];

    if (summary.grouped.league.length) {
      trophyFields.push({
        name: `${safeEmoji(E.PL, '🏆')} PL (League Title) (${summary.grouped.league.length})`,
        value: formatCompactSeasonList(summary.grouped.league),
        inline: false
      });
    }

    if (summary.grouped.ucl.length) {
      trophyFields.push({
        name: `${safeEmoji(E.UCL, '🏆')} UCL (${summary.grouped.ucl.length})`,
        value: formatCompactSeasonList(summary.grouped.ucl),
        inline: false
      });
    }

    if (summary.grouped.fa.length) {
      trophyFields.push({
        name: `${safeEmoji(E.FA, '🏆')} FA Cup (${summary.grouped.fa.length})`,
        value: formatCompactSeasonList(summary.grouped.fa),
        inline: false
      });
    }

    if (summary.grouped.carabao.length) {
      trophyFields.push({
        name: `${safeEmoji(E.Carabao, '🏆')} Carabao Cup (${summary.grouped.carabao.length})`,
        value: formatCompactSeasonList(summary.grouped.carabao),
        inline: false
      });
    }

    const runnerUpSections = [];

    if (summary.groupedRunnerUps.league.length) {
      runnerUpSections.push(`**PL:**\n${formatCompactSeasonList(summary.groupedRunnerUps.league)}`);
    }

    if (summary.groupedRunnerUps.ucl.length) {
      runnerUpSections.push(`**UCL:**\n${formatCompactSeasonList(summary.groupedRunnerUps.ucl)}`);
    }

    if (summary.groupedRunnerUps.fa.length) {
      runnerUpSections.push(`**FA Cup:**\n${formatCompactSeasonList(summary.groupedRunnerUps.fa)}`);
    }

    if (summary.groupedRunnerUps.carabao.length) {
      runnerUpSections.push(`**Carabao Cup:**\n${formatCompactSeasonList(summary.groupedRunnerUps.carabao)}`);
    }

    if (runnerUpSections.length) {
      trophyFields.push({
        name: `${safeEmoji(E.runnerUp || E.leagueRunnerUp, '🥈')} Runner-Up Medals (${summary.runnerCount})`,
        value: runnerUpSections.join('\n'),
        inline: false
      });
    }

    if (!trophyFields.length) {
      trophyFields.push({
        name: `${safeEmoji(E.trophy_animated || E.trophy || E.Trophy_icon, '🏆')} Trophy Status`,
        value: '*No trophies or runner-up medals yet.*',
        inline: false
      });
    }

    return new EmbedBuilder()
      .setAuthor({ name: `${displayName} • Trophy Room`, iconURL: thumbnail })
      .setTitle(`${safeEmoji(E.trophy_animated || E.trophy || E.Trophy_icon, '🏆')} Trophy Cabinet`)
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${safeEmoji(E.trophy_animated || E.trophy || E.Trophy_icon, '🏆')} **Titles:** ${summary.count}\n` +
        `${safeEmoji(E.leagueRunnerUp || E.runnerUp, '🥈')} **Runner Ups:** ${summary.runnerCount}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(...trophyFields)
      .setThumbnail(thumbnail)
      .setColor(0xF1C40F)
      .setFooter({ text: 'Trophy Room • Team titles and finals history' })
      .setTimestamp();
  }

  if (view === 'awards') {
    const awardData = buildAwardsOnly(awardRows);
    const awardFields = [];

    if (awardData.attacking) {
      awardFields.push({
        name: `${safeEmoji(E.goldenBoot || E.goal, '⚽')} Attacking Awards`,
        value: awardData.attacking,
        inline: false
      });
    }

    if (awardData.defensive) {
      awardFields.push({
        name: `${safeEmoji(E.bestDefender || E.defense, '🛡️')} Defensive Awards`,
        value: awardData.defensive,
        inline: false
      });
    }

    if (awardData.special) {
      awardFields.push({
        name: `${safeEmoji(E.medal || E.rank, '🎖️')} Special Awards`,
        value: awardData.special,
        inline: false
      });
    }

    if (!awardFields.length) {
      awardFields.push({
        name: `${safeEmoji(E.badge || E.Badge, '🏅')} Award Status`,
        value: '*No individual awards yet.*',
        inline: false
      });
    }

    return new EmbedBuilder()
      .setAuthor({ name: `${displayName} • Awards Gallery`, iconURL: thumbnail })
      .setTitle(`${safeEmoji(E.badge || E.Badge, '🏅')} Individual Awards`)
      .setDescription(
        `${awardData.summary}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(...awardFields)
      .setThumbnail(thumbnail)
      .setColor(0xE67E22)
      .setFooter({ text: 'Awards Gallery • Individual season awards' })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setTitle(`${safeEmoji(E.profile, '👤')} Career Card`)
    .setDescription(
      `# ${displayName}\n` +
      `${safeEmoji(E.blueIcon, '🔵')} **User:** ${mention}\n` +
      `${safeEmoji(E.calendar, '📅')} **Seasons:** ${totals.seasons.size} (${[...totals.seasons].sort().map(getSeasonNumberLabel).join(', ') || 'N/A'})\n` +
      `${safeEmoji(E.team, '👥')} **Teams:** ${[...totals.teams].filter(Boolean).join(', ') || 'N/A'}\n` +
      `🆔 **Team IDs:** ${[...totals.teamIds].filter(Boolean).join(', ') || 'N/A'}`
    )
    .addFields(
      {
        name: `${safeEmoji(E.played, '🎮')} Career Record`,
        value:
          `${safeEmoji(E.played, '🎮')} **Matches:** ${totals.matches}\n` +
          `${safeEmoji(E.win, '✅')} **Wins:** ${totals.wins}\n` +
          `${safeEmoji(E.draw, '🤝')} **Draws:** ${totals.draws}\n` +
          `${safeEmoji(E.lose, '❌')} **Losses:** ${totals.losses}\n` +
          `${safeEmoji(E.fire, '🔥')} **Win Rate:** ${totals.winRate}%`,
        inline: true
      },
      {
        name: `${safeEmoji(E.goal, '⚽')} Attacking Career`,
        value:
          `${safeEmoji(E.goal, '⚽')} **Goals:** ${totals.goals}\n` +
          `${safeEmoji(E.assist, '🎯')} **Assists:** ${totals.assists}\n` +
          `${safeEmoji(E.fire, '🔥')} **G/A:** ${totals.ga}\n` +
          `${safeEmoji(E.mvp, '⭐')} **MVP/MOTM:** ${totals.mvp}`,
        inline: true
      },
      {
        name: `${safeEmoji(E.defense, '🛡️')} Defensive Career`,
        value:
          `${safeEmoji(E.tackle, '🛡️')} **Tackles:** ${totals.tackles}\n` +
          `${safeEmoji(E.interception, '✂️')} **Interceptions:** ${totals.interceptions}`,
        inline: true
      },
      {
        name: '━━━━━━━━━━━━━━━━━━━━',
        value: '\u200B',
        inline: false
      },
      {
        name: `${safeEmoji(E.trophy_animated || E.trophy || E.Trophy_icon, '🏆')} Trophy Cabinet`,
        value:
          `**Trophies:** ${totals.trophies}\n` +
          `**Awards:** ${Math.max(profileAwardRows.length, totals.awards)}`,
        inline: false
      },
      {
        name: '━━━━━━━━━━━━━━━━━━━━',
        value: '\u200B',
        inline: false
      },
      {
        name: `${safeEmoji(E.badge || E.Badge, '🏅')} Career Badges`,
        value: badges,
        inline: false
      }
    )
    .setThumbnail(thumbnail)
    .setColor(0x5865F2)
    .setFooter({ text: 'SiuuVerse Career Archive • Profile' })
    .setTimestamp();
}

async function buildCareerResponse(interaction, view = 'profile', targetType = 'self', targetValue = '') {
  const decodedTarget = decodeURIComponent(String(targetValue || '').split('_')[0]);
  let playerInput = null;
  let userId = null;
  let query = interaction.user.username;

  if (targetType === 'player') {
    playerInput = decodedTarget;
    query = decodedTarget;
  } else if (targetType === 'user') {
    userId = decodedTarget;
    query = decodedTarget;
  } else {
    userId = decodedTarget || interaction.user.id;
    query = decodedTarget || interaction.user.username;
  }

  const [allTimePlayers, awards, teamIdRows] = await Promise.all([
    cachedGetData('All_Time_Player_Stats!A:AG'),
    cachedGetData('Awards!A:F'),
    cachedGetData('Team_ID_Map!A:E')
  ]);

  const careerRows = cleanRows(allTimePlayers).filter(row => playerMatches(row, playerInput, userId));
  const teamDirectory = buildTeamIdDirectory(teamIdRows);

  if (!careerRows.length) {
    return {
      content:
        `${safeEmoji(E.wrong, '❌')} No career data found for **${query}**.\n` +
        `Contact Bot Owner.`,
      components: []
    };
  }

  const careerNames = new Set();
  careerRows.forEach(row => {
    careerNames.add(normalize(row[0]));
    careerNames.add(normalize(stripTeamPrefix(row[0])));
  });

  const awardRows = cleanRows(awards).filter(row => awardMatches(row, careerNames));
  const profileAwardRows = awardRows.filter(isCountableProfileAward);
  const totals = buildCareerTotals(careerRows);
  const bestSeason = getBestSeason(careerRows);
  const displayName = getDisplayName(careerRows, query);
  const mentionId = careerRows.map(row => extractDiscordId(row[1])).find(Boolean);
  const mention = mentionId ? `<@${mentionId}>` : displayName;
  const avatarUser = mentionId
    ? await interaction.client.users.fetch(mentionId).catch(() => null)
    : null;
  const thumbnail = avatarUser?.displayAvatarURL({ size: 256 }) || interaction.user.displayAvatarURL({ size: 256 });
  const badges = buildCareerBadges(totals, awardRows);
  const teamHistory = formatTeamHistory(careerRows, teamDirectory);
  const embed = buildCareerEmbed(view, {
    displayName,
    mention,
    totals,
    awardRows,
    profileAwardRows,
    careerRows,
    bestSeason,
    badges,
    thumbnail,
    teamHistory
  });

  return {
    embeds: [embed],
    components: [createCareerButtons(view, targetType, decodedTarget || userId || playerInput || '')]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mycareer')
    .setDescription('Show all-time career stats, trophies and awards')
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Player name to search, example: LL-Piyush')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Discord user to search')
        .setRequired(false)
    ),

  async execute(interaction) {
    const playerInput = interaction.options.getString('player');
    const userInput = interaction.options.getUser('user');

    if (playerInput) {
      return buildCareerResponse(interaction, 'profile', 'player', playerInput);
    }

    if (userInput) {
      return buildCareerResponse(interaction, 'profile', 'user', userInput.id);
    }

    return buildCareerResponse(interaction, 'profile', 'user', interaction.user.id);
  },

  async buttonHandler(interaction, action, page, targetType = 'self', targetValue = '') {
    const view = ['profile', 'history', 'trophies', 'awards'].includes(action)
      ? action
      : 'profile';

    // Custom ID format:
    // mycareer_<view>_<targetType>_<targetValue>
    // Example:
    // mycareer_history_user_123456789
    // action = history
    // page = user
    // targetType = 123456789

    const realTargetType = ['user', 'player', 'self'].includes(page)
      ? page
      : 'self';

    const realTargetValue = String(targetType || '');

    return buildCareerResponse(
      interaction,
      view,
      realTargetType,
      realTargetValue
    );
  }
};
