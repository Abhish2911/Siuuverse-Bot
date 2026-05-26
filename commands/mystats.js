const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const normalize = (value) => String(value || '').toLowerCase().trim();

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
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

function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

function addTeamPrefix(playerName, shortName) {
  const player = String(playerName || '').trim();
  const short = String(shortName || '').trim().toUpperCase();

  if (!player) return 'Unknown Player';
  if (!short || short === 'FA') return player;

  const upperPlayer = player.toUpperCase();
  if (upperPlayer.startsWith(`${short}-`) || upperPlayer.startsWith(`${short} -`)) {
    return player;
  }

  return `${short}-${player}`;
}

function rankBadge(rank) {
  const n = Number(rank);
  if (n === 1) return '🥇';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  if (n > 3 && n <= 10) return '🏅';
  return '▫️';
}

function buildBadges(goals, assists, ga, mvp, extraStats) {
  const badges = [];

  if (goals.rank === 1) badges.push(`${safeEmoji(E.goldenBoot, '👟')} Top Scorer`);
  if (assists.rank === 1) badges.push(`${safeEmoji(E.playmaker, '🎯')} Playmaker`);
  if (ga.rank === 1) badges.push(`${safeEmoji(E.fire, '🔥')} GA King`);
  if (mvp.rank === 1) badges.push(`${safeEmoji(E.mvp, '⭐')} MVP King`);
  if (goals.rank === 1 && assists.rank === 1 && ga.rank === 1) badges.push('👑 GOAT');

  if (goals.value >= 50) badges.push(`👑 Goal Machine`);
  else if (goals.value >= 25) badges.push(`🔥 Elite Finisher`);
  else if (goals.value >= 10) badges.push(`${safeEmoji(E.goal, '⚽')} Goal Poacher`);

  if (assists.value >= 50) badges.push(`🎩 Assist King`);
  else if (assists.value >= 25) badges.push(`🧠 Playmaking Genius`);
  else if (assists.value >= 10) badges.push(`${safeEmoji(E.assist, '🎯')} Chance Creator`);

  if (ga.value >= 75) badges.push(`🐐 Offensive Monster`);
  else if (ga.value >= 40) badges.push(`💀 Nightmare Forward`);
  else if (ga.value >= 20) badges.push(`⚡ GA Threat`);

  if (mvp.value >= 20) badges.push(`👑 MVP Emperor`);
  else if (mvp.value >= 10) badges.push(`🌟 Big Match Hero`);
  else if (mvp.value >= 5) badges.push(`${safeEmoji(E.mvp, '⭐')} Clutch Player`);

  if (goals.value >= 25 && assists.value >= 25) {
    badges.push(`⚔️ Complete Attacker`);
  }

  if (
    Number(goals.rank) > 0 && Number(goals.rank) <= 3 &&
    Number(assists.rank) > 0 && Number(assists.rank) <= 3
  ) {
    badges.push(`🔥 Double Threat`);
  }

  if (ga.value >= 50 && mvp.value >= 10) {
    badges.push(`🏆 Franchise Player`);
  }

  if (goals.rank === 1 && assists.rank === 1 && ga.rank === 1) {
    badges.push(`☠️ Untouchable`);
  }

  if (extraStats.tackles >= 50) badges.push(`${safeEmoji(E.tackle, '🛡️')} Tackle Machine`);
  else if (extraStats.tackles >= 25) badges.push(`${safeEmoji(E.tackle, '🛡️')} Ball Winner`);
  else if (extraStats.tackles >= 10) badges.push(`${safeEmoji(E.tackle, '🛡️')} Tackler`);

  if (extraStats.interceptions >= 50) badges.push(`${safeEmoji(E.interception, '✂️')} Interception King`);
  else if (extraStats.interceptions >= 25) badges.push(`${safeEmoji(E.interception, '✂️')} Passing Lane Hunter`);
  else if (extraStats.interceptions >= 10) badges.push(`${safeEmoji(E.interception, '✂️')} Reader`);

  if (extraStats.tackles >= 25 && extraStats.interceptions >= 25) badges.push(`${safeEmoji(E.defense, '🛡️')} Defensive Wall`);
  if (extraStats.tackles >= 50 && extraStats.interceptions >= 50) badges.push(`🚫 Lockdown Defender`);


  return badges.length ? badges.join('\n') : 'No badges yet';
}

function getTeamDataFromUserId(teams, userId) {
  if (!Array.isArray(teams)) return null;
  const id = String(userId || '').trim();

  for (const team of teams.slice(1)) {
    const teamName = team[0] || 'Free Agent';
    const players = String(team[1] || '').split(',').map(p => p.trim()).filter(Boolean);
    const shortName = team[2] || 'FA';
    const logo = String(team[3] || '').trim();
    const captainId = extractDiscordId(team[4]);
    const userIds = String(team[5] || '').split(',').map(extractDiscordId).filter(Boolean);
    const stadium = team[6] || 'Not set';
    const color = team[7] || '';

    if (captainId && captainId === id && players[0]) {
      return { player: players[0], teamName, shortName, logo, stadium, color, memberId: captainId };
    }

    const memberIndex = userIds.findIndex(x => x === id);
    if (memberIndex !== -1 && players[memberIndex + 1]) {
      return { player: players[memberIndex + 1], teamName, shortName, logo, stadium, color, memberId: userIds[memberIndex] };
    }
  }

  return null;
}

function getTeamDataFromPlayer(teams, playerName) {
  if (!Array.isArray(teams)) return null;
  const key = normalize(playerName);

  for (const team of teams.slice(1)) {
    const playerList = String(team[1] || '').split(',').map(p => p.trim()).filter(Boolean);
    const playerIndex = playerList.findIndex(p => normalize(p) === key);

    if (playerIndex !== -1) {
      const captainId = extractDiscordId(team[4]);
      const userIds = String(team[5] || '').split(',').map(extractDiscordId).filter(Boolean);
      const color = team[7] || '';

      return {
        player: playerList[playerIndex],
        teamName: team[0] || 'Free Agent',
        shortName: team[2] || 'FA',
        logo: String(team[3] || '').trim(),
        stadium: team[6] || 'Not set',
        color,
        memberId: playerIndex === 0 ? captainId : (userIds[playerIndex - 1] || '')
      };
    }
  }

  return null;
}

function findHeaderIndex(headers, keywords) {
  return headers.findIndex(header => {
    const text = normalize(header);
    return keywords.some(keyword => text.includes(keyword));
  });
}

function sumExtraStats(matchesEntry, playerName, teamData = null) {
  const totals = { tackles: 0, interceptions: 0 };
  if (!Array.isArray(matchesEntry) || matchesEntry.length <= 1) return totals;

  const playerKey = normalize(playerName);
  const shortKey = normalize(teamData?.shortName);
  const possibleNames = new Set([
    playerKey,
    normalize(`${teamData?.shortName || ''}-${playerName}`),
    normalize(stripTeamPrefix(playerName))
  ].filter(Boolean));

  matchesEntry.slice(1).forEach(row => {
    const homeTeam = normalize(row[1]);
    const awayTeam = normalize(row[2]);
    const isHomePlayer = shortKey && (homeTeam === shortKey || homeTeam === normalize(teamData?.teamName));
    const isAwayPlayer = shortKey && (awayTeam === shortKey || awayTeam === normalize(teamData?.teamName));

    const rowText = row.map(cell => normalize(stripTeamPrefix(cell))).join(' ');
    const appearsInText = [...possibleNames].some(name => name && rowText.includes(name));

    if (isHomePlayer || appearsInText) {
      totals.tackles += toNumber(row[10]);
      totals.interceptions += toNumber(row[12]);
    }

    if (isAwayPlayer || appearsInText) {
      totals.tackles += toNumber(row[11]);
      totals.interceptions += toNumber(row[13]);
    }
  });

  return totals;
}

function getTeamLeagueRecord(standings, teamName, shortName) {
  const empty = { played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 };
  if (!Array.isArray(standings) || standings.length <= 1) return empty;

  const headers = (standings[0] || []).map(h => normalize(h));

  const findCol = (keywords, fallback) => {
    const index = headers.findIndex(h => keywords.some(k => h === k || h.includes(k)));
    return index === -1 ? fallback : index;
  };

  const teamCol = findCol(['team', 'club', 'name'], 1);
  const playedCol = findCol(['p', 'played', 'matches'], 2);
  const winsCol = findCol(['w', 'win'], 3);
  const drawsCol = findCol(['d', 'draw'], 4);
  const lossesCol = findCol(['l', 'loss'], 5);

  const teamKey = normalize(teamName);
  const shortKey = normalize(shortName);

  const row = standings.slice(1).find(r =>
    normalize(r[teamCol]) === teamKey ||
    normalize(r[teamCol]) === shortKey ||
    r.some(cell => normalize(cell) === teamKey || normalize(cell) === shortKey)
  );

  if (!row) return empty;

  const played = toNumber(row[playedCol]);
  const wins = toNumber(row[winsCol]);
  const draws = toNumber(row[drawsCol]);
  const losses = toNumber(row[lossesCol]);
  const winRate = played ? Math.round((wins / played) * 100) : 0;

  return { played, wins, draws, losses, winRate };
}

function buildMystatsSummary(inputName, teamData, leagueRecord, goals, assists, ga, mvp, extraStats, badgeText) {
  const teamName = teamData?.teamName || 'Free Agent';
  const shortName = teamData?.shortName || 'FA';
  const totalGA = goals.value + assists.value;
  const impactScore = goals.value * 3 + assists.value * 2 + mvp.value * 3;
  const badgeCount = badgeText === 'No badges yet' ? 0 : badgeText.split('\n').length;

  const displayPlayer = addTeamPrefix(inputName, shortName);

  return {
    player: displayPlayer,
    teamName,
    shortName,
    winRate: leagueRecord.winRate,
    record: `${leagueRecord.wins}W / ${leagueRecord.draws}D / ${leagueRecord.losses}L`,
    leaderGoal: `Goals ${goals.value} (#${goals.rank})`,
    leaderAssist: `Assists ${assists.value} (#${assists.rank})`,
    leaderGa: `G/A ${ga.value} (#${ga.rank})`,
    leaderMvp: `MVP ${mvp.value} (#${mvp.rank})`,
    totalGA,
    impactScore,
    badgeCount,
    tackles: extraStats.tackles,
    interceptions: extraStats.interceptions
  };
}

function buildMystatsDescription(summary, mention, stadium) {
  return (
    `# ${summary.player}\n` +
    `${safeEmoji(E.profile, '👤')} **Coop League Profile**\n` +
    `${safeEmoji(E.blueIcon, '🔵')} **User:** ${mention}\n` +
    `${safeEmoji(E.team, '👥')} **Team:** ${summary.teamName} • **${summary.shortName}**\n` +
    `🏟️ **Stadium:** ${stadium}\n` +
    `${safeEmoji(E.fire, '🔥')} **Win Rate:** ${summary.winRate}%\n\n`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Show a coop league player profile')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Player name. Leave empty to show your linked player')
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Mention a user to show their linked player stats')
        .setRequired(false)
    ),

  async execute(interaction) {
    const [ranking, teams, standings, matchesEntry] = await Promise.all([
      cachedGetData('Ranking!A:AA'),
      cachedGetData('Teams!A:Z'),
      cachedGetData('Standings!A:J'),
      cachedGetData('Matches_Entry!A:P')
    ]);

    let inputName = interaction.options.getString('name');
    const targetUser = interaction.options.getUser('user');
    let teamData = null;

    if (targetUser) {
      teamData = getTeamDataFromUserId(teams, targetUser.id);

      if (!teamData) {
        return {
          content: `${safeEmoji(E.wrong, '❌')} No coop player linked to ${targetUser}. Add their Discord ID in **Teams** first.`
        };
      }

      inputName = teamData.player;
    }

    if (!inputName) {
      teamData = getTeamDataFromUserId(teams, interaction.user.id);

      if (!teamData) {
        return {
          content: `${safeEmoji(E.wrong, '❌')} No coop player linked to you. Use \`/mystats name:<player>\` or add your Discord ID in **Teams**.`
        };
      }

      inputName = teamData.player;
    }

    const name = normalize(inputName);

    const rankingRows = Array.isArray(ranking)
      ? ranking.slice(2).filter(r => r && r.length)
      : [];

    const getStat = (type) => {
      let nameIndex;
      let valueIndex;

      if (type === 'goals') {
        nameIndex = 1;
        valueIndex = 2;
      } else if (type === 'assists') {
        nameIndex = 4;
        valueIndex = 5;
      } else if (type === 'mvp') {
        nameIndex = 13;
        valueIndex = 14;
      } else if (type === 'ga') {
        nameIndex = 16;
        valueIndex = 17;
      } else {
        return { rank: '-', value: 0 };
      }

      const cleanRows = rankingRows.filter(r =>
        r[nameIndex] && r[valueIndex] !== undefined && r[valueIndex] !== ''
      );

      const rowIndex = cleanRows.findIndex(r => {
        const sheetName = String(r[nameIndex] || '').trim();
        return normalize(sheetName) === name || normalize(stripTeamPrefix(sheetName)) === name;
      });

      if (rowIndex === -1) return { rank: '-', value: 0 };

      return {
        rank: rowIndex + 1,
        value: toNumber(cleanRows[rowIndex][valueIndex])
      };
    };

    const goals = getStat('goals');
    const assists = getStat('assists');
    const mvp = getStat('mvp');
    const ga = getStat('ga');

    if (!teamData) teamData = getTeamDataFromPlayer(teams, inputName);
    const extraStats = sumExtraStats(matchesEntry, inputName, teamData);

    const teamName = teamData?.teamName || 'Free Agent';
    const shortName = teamData?.shortName || 'FA';
    const stadium = teamData?.stadium || 'Not set';
    const logo = teamData?.logo || '';
    const teamColor = teamData?.color || '';
    const memberId = teamData?.memberId || '';
    const mention = memberId ? `<@${memberId}>` : 'Not linked';

    const leagueRecord = getTeamLeagueRecord(standings, teamName, shortName);

    const badgeText = buildBadges(goals, assists, ga, mvp, extraStats);
    const summary = buildMystatsSummary(inputName, teamData, leagueRecord, goals, assists, ga, mvp, extraStats, badgeText);

    const winContribution = goals.value * 3 + assists.value * 2 + mvp.value * 3;
    const totalGA = goals.value + assists.value;

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.played, '🎮')} Coop Player Card`)
      .setDescription(buildMystatsDescription(summary, mention, stadium))
      .addFields(
        {
          name: `${safeEmoji(E.played, '🎮')} League Record`,
          value:
            `${safeEmoji(E.played, '🎮')} **Played:** ${leagueRecord.played}\n` +
            `${safeEmoji(E.win, '✅')} **Wins:** ${leagueRecord.wins}\n` +
            `${safeEmoji(E.draw, '🤝')} **Draws:** ${leagueRecord.draws}\n` +
            `${safeEmoji(E.lose, '❌')} **Losses:** ${leagueRecord.losses}`,
          inline: true
        },
        {
          name: `${safeEmoji(E.fire, '🔥')} Profile Snapshot`,
          value:
            `${safeEmoji(E.goal, '⚽')} **Goals + Assists:** ${summary.totalGA}\n` +
            `${safeEmoji(E.rank, '🏅')} **Impact Score:** ${summary.impactScore}\n` +
            `${safeEmoji(E.Badge, '🏅')} **Badge Count:** ${summary.badgeCount}`,
          inline: true
        },
        {
          name: '━━━━━━━━━━━━━━━━━━━━',
          value: '\u200B',
          inline: false
        },
        {
          name: `${safeEmoji(E.Stats, '📊')} Attacking Stats`,
          value:
            `${safeEmoji(E.goal, '⚽')} **Goals:** ${goals.value} (#${goals.rank}) ${rankBadge(goals.rank)}\n` +
            `${safeEmoji(E.assist, '🎯')} **Assists:** ${assists.value} (#${assists.rank}) ${rankBadge(assists.rank)}\n` +
            `${safeEmoji(E.fire, '🔥')} **G/A:** ${ga.value} (#${ga.rank}) ${rankBadge(ga.rank)}\n` +
            `${safeEmoji(E.mvp, '⭐')} **MVP:** ${mvp.value} (#${mvp.rank}) ${rankBadge(mvp.rank)}`,
          inline: true
        },
        {
          name: `${safeEmoji(E.defense, '🛡️')} Defensive Stats`,
          value:
            `${safeEmoji(E.tackle, '🛡️')} **Tackles:** ${extraStats.tackles}\n` +
            `${safeEmoji(E.interception, '✂️')} **Interceptions:** ${extraStats.interceptions}`,
          inline: true
        },
        {
          name: '━━━━━━━━━━━━━━━━━━━━',
          value: '\u200B',
          inline: false
        },
        {
          name: `${safeEmoji(E.Badge, '🏅')} Badges`,
          value: badgeText,
          inline: false
        }
      )
      .setColor(parseTeamColor(teamColor) || 0x5865F2)
      .setFooter({ text: `Mystats • SiuuVerse Coop Player Card • ${shortName}` })
      .setTimestamp();

    if (logo && /^https?:\/\//i.test(logo)) {
      embed.setThumbnail(logo);
    }

    return { embeds: [embed] };
  }
};
