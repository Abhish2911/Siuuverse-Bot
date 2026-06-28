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

  if (extraStats.tackles >= 80) badges.push(`${safeEmoji(E.tackle, '🛡️')} Tackle Machine`);
  else if (extraStats.tackles >= 50) badges.push(`${safeEmoji(E.tackle, '🛡️')} Ball Winner`);
  else if (extraStats.tackles >= 20) badges.push(`${safeEmoji(E.tackle, '🛡️')} Tackler`);

  if (extraStats.interceptions >= 80) badges.push(`${safeEmoji(E.interception, '✂️')} Interception King`);
  else if (extraStats.interceptions >= 50) badges.push(`${safeEmoji(E.interception, '✂️')} Passing Lane Hunter`);
  else if (extraStats.interceptions >= 25) badges.push(`${safeEmoji(E.interception, '✂️')} Reader`);

  if (extraStats.tackles >= 50 && extraStats.interceptions >= 50) badges.push(`${safeEmoji(E.defense, '🛡️')} Defensive Wall`);
  if (extraStats.tackles >= 75 && extraStats.interceptions >= 75) badges.push(`🚫 Lockdown Defender`);


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
    )
    .addStringOption(opt =>
      opt
        .setName('competition')
        .setDescription('Competition to view stats for')
        .setRequired(false)
        .addChoices(
          { name: 'Overall', value: 'overall' },
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const [
      rankingLeague,
      rankingFA,
      rankingCarabao,
      rankingUCL,
      teams,
      standings,
      matchesEntry
    ] = await Promise.all([
      cachedGetData('Ranking!A:AA'),
      cachedGetData('FA_Cup_Coop_Ranking!A:AA'),
      cachedGetData('Carabao_Coop_Ranking!A:AA'),
      cachedGetData('UCL_Coop_Ranking!A:AA'),
      cachedGetData('Teams!A:Z'),
      cachedGetData('Standings!A:J'),
      cachedGetData('Matches_Entry!A:P')
    ]);

    // Read competition option
    const competition = interaction.options.getString('competition') || 'overall';
    // Map for footer/label
    const competitionLabelMap = {
      overall: 'Overall Career',
      league: 'League',
      fa: 'FA Cup',
      carabao: 'Carabao Cup',
      ucl: 'UCL'
    };
    const competitionLabel = competitionLabelMap[competition] || 'Overall Career';

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

    // Helper: build competition rows and overall aggregates
    // Sheet layout: Rank | Golden Boot | Rank | Playmaker | Rank | Yellow Cards | Rank | Red Cards | Rank | MVP | Rank | Goals Contribution | Rank | Tackles | Rank | Interceptions | Rank | Saves
    // Value columns: 2=Golden Boot (Goals), 5=Playmaker (Assists), 14=MVP, 17=Goals Contribution, 20=Tackles, 23=Interceptions, 26=Saves
    function buildCompetitionRows(competition, rankingLeague, rankingFA, rankingCarabao, rankingUCL) {
      // For individual competitions, just return the raw rows (skip headers)
      if (competition === 'league') {
        return Array.isArray(rankingLeague) ? rankingLeague.slice(1).filter(r => r && String(r[1] || '').trim()) : [];
      }
      if (competition === 'fa') {
        return Array.isArray(rankingFA) ? rankingFA.slice(1).filter(r => r && String(r[1] || '').trim()) : [];
      }
      if (competition === 'carabao') {
        return Array.isArray(rankingCarabao) ? rankingCarabao.slice(1).filter(r => r && String(r[1] || '').trim()) : [];
      }
      if (competition === 'ucl') {
        return Array.isArray(rankingUCL) ? rankingUCL.slice(1).filter(r => r && String(r[1] || '').trim()) : [];
      }
      // For "overall", aggregate stats by player using correct value columns from each ranking sheet
      // Columns: 1=name, 2=goals, 5=assists, 14=mvp, 17=ga, 20=tackles, 23=interceptions
      const sheets = [
        Array.isArray(rankingLeague) ? rankingLeague.slice(1).filter(r => r && String(r[1] || '').trim()) : [],
        Array.isArray(rankingFA) ? rankingFA.slice(1).filter(r => r && String(r[1] || '').trim()) : [],
        Array.isArray(rankingCarabao) ? rankingCarabao.slice(1).filter(r => r && String(r[1] || '').trim()) : [],
        Array.isArray(rankingUCL) ? rankingUCL.slice(1).filter(r => r && String(r[1] || '').trim()) : []
      ];
      // Object keyed by normalized player name (without team prefix)
      const playerMap = {};
      for (const rows of sheets) {
        for (const row of rows) {
          const rawName = row[1] || '';
          const normName = normalize(stripTeamPrefix(rawName));
          if (!normName) continue;
          if (!playerMap[normName]) {
            playerMap[normName] = {
              displayName: rawName,
              goals: 0,
              assists: 0,
              mvp: 0,
              ga: 0,
              tackles: 0,
              interceptions: 0
            };
          }
          playerMap[normName].goals += toNumber(row[2]);
          playerMap[normName].assists += toNumber(row[5]);
          playerMap[normName].mvp += toNumber(row[14]);
          playerMap[normName].ga += toNumber(row[17]);
          playerMap[normName].tackles += toNumber(row[20]);
          playerMap[normName].interceptions += toNumber(row[23]);
        }
      }
      // Now create six independently sorted arrays (goals, assists, mvp, ga, tackles, interceptions)
      const allPlayers = Object.values(playerMap);
      // Each array is [{displayName, value, ...}], sorted descending by stat
      const goals = [...allPlayers].sort((a, b) => b.goals - a.goals);
      const assists = [...allPlayers].sort((a, b) => b.assists - a.assists);
      const mvp = [...allPlayers].sort((a, b) => b.mvp - a.mvp);
      const ga = [...allPlayers].sort((a, b) => b.ga - a.ga);
      const tackles = [...allPlayers].sort((a, b) => b.tackles - a.tackles);
      const interceptions = [...allPlayers].sort((a, b) => b.interceptions - a.interceptions);
      // Return as object for "overall"
      return {
        overall: {
          goals,
          assists,
          mvp,
          ga,
          tackles,
          interceptions
        }
      };
    }

    // Use the helper to get rankingRows or overall aggregates for the selected competition
    const rankingRowsOrObj = buildCompetitionRows(competition, rankingLeague, rankingFA, rankingCarabao, rankingUCL);

    // getStat: for overall, use the stat-specific sorted arrays; for other competitions, use raw rows
    function getStat(type) {
      // For "overall", use the six separate sorted arrays for each stat
      if (competition === 'overall' && rankingRowsOrObj && rankingRowsOrObj.overall) {
        const statMap = {
          goals: 'goals',
          assists: 'assists',
          mvp: 'mvp',
          ga: 'ga',
          tackles: 'tackles',
          interceptions: 'interceptions'
        };
        const arr = rankingRowsOrObj.overall[statMap[type]];
        if (!Array.isArray(arr)) return { rank: '-', value: 0 };
        // Find index by displayName, or by stripped team prefix
        const idx = arr.findIndex(entry =>
          normalize(entry.displayName) === name ||
          normalize(stripTeamPrefix(entry.displayName)) === name
        );
        if (idx === -1) return { rank: '-', value: 0 };
        return {
          rank: idx + 1,
          value: arr[idx][type]
        };
      }
      // For specific competitions, search only column 1 for player name, read value from correct stat column
      // Value columns: 2=Golden Boot (Goals), 5=Playmaker (Assists), 14=MVP, 17=Goals Contribution, 20=Tackles, 23=Interceptions
      let valueIndex;
      if (type === 'goals') valueIndex = 2;
      else if (type === 'assists') valueIndex = 5;
      else if (type === 'mvp') valueIndex = 14;
      else if (type === 'ga') valueIndex = 17;
      else if (type === 'tackles') valueIndex = 20;
      else if (type === 'interceptions') valueIndex = 23;
      else return { rank: '-', value: 0 };
      // rankingRowsOrObj is an array in this case
      const rows = Array.isArray(rankingRowsOrObj) ? rankingRowsOrObj : [];
      // Build sorted array for this stat
      const filtered = rows
        .filter(r => {
          const player = String(r[1] || '').trim();
          if (!player) return false;
          return true;
        })
        .sort((a, b) => {
          const diff = toNumber(b[valueIndex]) - toNumber(a[valueIndex]);
          if (diff !== 0) return diff;
          return String(a[1] || '').localeCompare(String(b[1] || ''));
        });
      // Find player by name in column 1, or by stripped team prefix
      const idx = filtered.findIndex(r => {
        const player = String(r[1] || '').trim();
        return (
          normalize(player) === name ||
          normalize(stripTeamPrefix(player)) === name
        );
      });
      if (idx === -1) return { rank: '-', value: 0 };
      const value = toNumber(filtered[idx][valueIndex]);
      return {
        rank: idx + 1,
        value
      };
    }

    const goals = getStat('goals');
    const assists = getStat('assists');
    const mvp = getStat('mvp');
    const ga = getStat('ga');

    if (!teamData) teamData = getTeamDataFromPlayer(teams, inputName);

    const tackleStats = getStat('tackles');
    const interceptionStats = getStat('interceptions');

    const extraStats = {
      tackles: tackleStats.value,
      interceptions: interceptionStats.value
    };

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

    // Build description to include the selected competition label
    function buildMystatsDescriptionWithCompetition(summary, mention, stadium, competitionLabel) {
      return (
        `# ${summary.player}\n` +
        `${safeEmoji(E.profile, '👤')} **Coop League Profile**\n` +
        `**Competition:** ${competitionLabel}\n` +
        `${safeEmoji(E.blueIcon, '🔵')} **User:** ${mention}\n` +
        `${safeEmoji(E.team, '👥')} **Team:** ${summary.teamName} • **${summary.shortName}**\n` +
        `🏟️ **Stadium:** ${stadium}\n` +
        `${safeEmoji(E.fire, '🔥')} **Win Rate:** ${summary.winRate}%\n\n`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.played, '🎮')} Coop Player Card`)
      .setDescription(buildMystatsDescriptionWithCompetition(summary, mention, stadium, competitionLabel))
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
            `${safeEmoji(E.tackle, '🛡️')} **Tackles:** ${extraStats.tackles} (#${tackleStats.rank}) ${rankBadge(tackleStats.rank)}\n` +
            `${safeEmoji(E.interception, '✂️')} **Interceptions:** ${extraStats.interceptions} (#${interceptionStats.rank}) ${rankBadge(interceptionStats.rank)}`,
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
      .setFooter({ text: `Mystats • ${competitionLabel}` })
      .setTimestamp();

    if (logo && /^https?:\/\//i.test(logo)) {
      embed.setThumbnail(logo);
    }

    return { embeds: [embed] };
  }
};
