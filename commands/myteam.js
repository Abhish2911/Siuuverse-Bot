const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, cleanId, normalize, parseHexColor, splitList } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

const parseTeamColor = (value) => {
  const color = String(value || '').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return 0x5865F2;
  return parseInt(color.replace('#', ''), 16);
};
const stripTeamPrefix = (value) => {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
};

function buildTeamIdMap(teamIdRows) {
  const byShort = new Map();
  const byName = new Map();

  if (!Array.isArray(teamIdRows)) return { byShort, byName };

  teamIdRows.slice(1).forEach(row => {
    const currentShort = String(row[0] || '').trim().toUpperCase();
    const teamId = String(row[1] || '').trim().toUpperCase();
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

    if (currentShort) byShort.set(normalize(currentShort), info);
    if (previousShort) byShort.set(normalize(previousShort), info);
    if (currentName) byName.set(normalize(currentName), info);
    if (previousName) byName.set(normalize(previousName), info);
  });

  return { byShort, byName };
}

function findTeamIdInfo(teamIdMap, teamName, shortName) {
  return (
    teamIdMap.byShort.get(normalize(shortName)) ||
    teamIdMap.byName.get(normalize(teamName)) ||
    null
  );
}

const hasScore = row =>
  row[4] !== '' && row[4] !== undefined &&
  row[5] !== '' && row[5] !== undefined;

const resultEmoji = result => {
  if (result === 'W') return `${E.win} W`;
  if (result === 'D') return `${E.draw} D`;
  if (result === 'L') return `${E.lose} L`;
  return `${E.equal} -`;
};

function getTeamForm(fixtures, teamName, shortName) {
  if (!Array.isArray(fixtures)) return 'No recent form.';

  const teamKey = normalize(teamName);
  const shortKey = normalize(shortName);

  const rows = fixtures
    .slice(1)
    .filter(row => row[0] && hasScore(row))
    .filter(row => {
      const homeTeam = normalize(row[2]);
      const awayTeam = normalize(row[3]);
      const homeShort = normalize(row[7]);
      const awayShort = normalize(row[8]);

      return homeTeam === teamKey || awayTeam === teamKey || homeShort === shortKey || awayShort === shortKey;
    })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-5);

  if (!rows.length) return 'No recent form.';

  return rows.map(row => {
    const homeTeam = normalize(row[2]);
    const homeShort = normalize(row[7]);
    const isHome = homeTeam === teamKey || homeShort === shortKey;

    const home = String(row[7] || row[2] || 'HOME').trim();
    const away = String(row[8] || row[3] || 'AWAY').trim();
    const hg = Number(row[4] || 0);
    const ag = Number(row[5] || 0);

    let result = 'D';
    if (isHome) {
      if (hg > ag) result = 'W';
      else if (hg < ag) result = 'L';
    } else {
      if (ag > hg) result = 'W';
      else if (ag < hg) result = 'L';
    }

    return `${resultEmoji(result)} • ${row[0]} • ${home} ${hg}-${ag} ${away}`;
  }).join('\n');
}

function formatSuspensions(suspensionRows, shortName) {
  const teamShort = normalize(shortName);

  if (!Array.isArray(suspensionRows)) {
    return '```ini\nNone\n```';
  }

  const rows = suspensionRows
    .slice(1)
    .filter(r => r[0] && r[5] && String(r[5]).toLowerCase().includes('suspend'))
    .filter(r => normalize(r[0] || '').startsWith(`${teamShort}-`));

  if (!rows.length) {
    return '```ini\nNone\n```';
  }

  const text = rows.map((r, i) => {
    const rawPlayer = String(r[0] || '-');
    const player = rawPlayer.includes('-') ? rawPlayer.split('-').slice(1).join('-') : rawPlayer;
    const yellowCards = r[1] || 0;
    const redMatch = r[2] || '-';
    const yellowBan = r[3] || '-';
    const banMatch = r[4] || '-';

    return `**${i + 1}. ${player}**\n` +
      `${E.ban} **Ban Match:** ${banMatch}`;
  }).join('\n\n');

  if (text.length > 1000) {
    return `${text.slice(0, 980).trim()}\n\n+ more suspended players...`;
  }

  return text;
}

// --- UI UPGRADE HELPERS ---
function buildTeamHubSummary(teamName, shortName, teamId, previousName, previousShort, stadium, pos, p, w, d, l, gd, pts, fairRank, fp, squadStats) {
  const topScorer = [...squadStats]
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.player.localeCompare(b.player))[0];

  const topAssister = [...squadStats]
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.player.localeCompare(b.player))[0];

  const topMvp = [...squadStats]
    .sort((a, b) => b.mvp - a.mvp || b.goals - a.goals || a.player.localeCompare(b.player))[0];

  return {
    teamName,
    shortName,
    teamId,
    previousName,
    previousShort,
    stadium,
    position: pos,
    played: p,
    wins: w,
    draws: d,
    losses: l,
    gd,
    pts,
    fairRank,
    fairPoints: fp,
    topScorer: topScorer ? `${topScorer.player} (${topScorer.goals})` : 'N/A',
    topAssister: topAssister ? `${topAssister.player} (${topAssister.assists})` : 'N/A',
    topMvp: topMvp ? `${topMvp.player} (${topMvp.mvp})` : 'N/A'
  };
}

function buildTeamHubDescription(summary) {
  return (
    `# ${summary.teamName}\n` +
    `${safeEmoji(E.Badge, '🏷️')} **Short:** ${summary.shortName}\n` +
    `🆔 **Team ID:** ${summary.teamId || 'N/A'}\n` +
    `🔁 **Previous:** ${summary.previousShort || 'N/A'} — ${summary.previousName || 'N/A'}\n` +
    `${safeEmoji(E.rank, '🏅')} **Rank:** #${summary.position}\n` +
    `🏟️ **Stadium:** ${summary.stadium}\n\n` +
    `${safeEmoji(E.played, '🎮')} **Record:** ${summary.wins}W / ${summary.draws}D / ${summary.losses}L\n` +
    `${safeEmoji(E.goal, '⚽')} **GD:** ${summary.gd} • **Pts:** ${summary.pts}\n` +
    `${safeEmoji(E.fairplay, '🕊️')} **Fair Play Rank:** #${summary.fairRank} • **Points:** ${summary.fairPoints}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myteam')
    .setDescription('Show your team hub or search another team')
    .addStringOption(opt =>
      opt
        .setName('team')
        .setDescription('Optional team name or short name to view')
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const teamInput = interaction.options.getString('team');

    const [teams, teamIdRows, standings, fairPlay, suspension, fixtures, ranking] = await Promise.all([
      cachedGetData('Teams!A:H'),
      cachedGetData('Team_ID_Map!A:E'),
      cachedGetData('Standings!A:J'),
      cachedGetData('Fair_Play!H:K'),
      cachedGetData('Suspension!A:G'),
      cachedGetData('Fixtures!A:I'),
      cachedGetData('Ranking!A:AA')
    ]);

    if (!teams || teams.length <= 1) {
      return { content: '❌ Teams sheet empty' };
    }

    const cleanTeams = teams.slice(1).filter(r => r[0]);
    const teamIdMap = buildTeamIdMap(teamIdRows);

    let team;

    if (teamInput) {
      const search = normalize(teamInput);
      team = cleanTeams.find(row =>
        normalize(row[0]) === search ||
        normalize(row[2]) === search ||
        normalize(row[0]).includes(search) ||
        normalize(row[2]).includes(search)
      );
    } else {
      team = cleanTeams.find(row => {
        const captain = cleanId(row[4]);
        const users = splitList(row[5]).map(cleanId);

        return captain === cleanId(userId) || users.includes(cleanId(userId));
      });
    }

    if (!team) {
      return {
        content: teamInput
          ? `❌ No team found for **${teamInput}**`
          : '❌ No team linked to you'
      };
    }

    const teamName = String(team[0] || 'Unknown Team');
    const players = String(team[1] || '');
    const shortName = String(team[2] || '');
    const logo = String(team[3] || '');
    const captainId = cleanId(team[4]);
    const stadium = String(team[6] || 'Not set').trim();
    const teamColor = String(team[7] || '').trim();
    const otherUserIds = splitList(team[5]).map(cleanId);
    const teamIdInfo = findTeamIdInfo(teamIdMap, teamName, shortName);
    const teamId = teamIdInfo?.teamId || 'N/A';
    const previousName = teamIdInfo?.previousName || teamName;
    const previousShort = teamIdInfo?.previousShort || shortName;

    const playerList = splitList(players);

    const captainPlayer = playerList[0] || 'Unknown';
    const otherPlayers = playerList.slice(1);

    const rankingRows = Array.isArray(ranking) ? ranking.slice(2).filter(r => r && r.length) : [];

    const getStat = (colName, playerName) => {
      let nameIndex;
      let valueIndex;

      if (colName === 'goals') {
        nameIndex = 1; valueIndex = 2;   // B:C
      } else if (colName === 'assists') {
        nameIndex = 4; valueIndex = 5;   // E:F
      } else if (colName === 'mvp') {
        nameIndex = 13; valueIndex = 14; // N:O
      } else if (colName === 'ga') {
        nameIndex = 16; valueIndex = 17; // Q:R
      } else if (colName === 'tackles') {
        nameIndex = 19; valueIndex = 20; // T:U
      } else if (colName === 'interceptions') {
        nameIndex = 22; valueIndex = 23; // W:X
      } else if (colName === 'saves') {
        nameIndex = 25; valueIndex = 26; // Z:AA
      } else {
        return 0;
      }

      const row = rankingRows.find(r => {
        const sheetName = String(r[nameIndex] || '').trim();
        return normalize(sheetName) === normalize(playerName) ||
          normalize(stripTeamPrefix(sheetName)) === normalize(playerName) ||
          normalize(sheetName) === normalize(`${shortName}-${playerName}`);
      });
      return row ? Number(row[valueIndex]) || 0 : 0;
    };

    const standingRow = Array.isArray(standings)
      ? standings.slice(1).find(r => normalize(r[1]) === normalize(teamName))
      : null;

    const pos = standingRow?.[0] || '-';
    const p = standingRow?.[2] || 0;
    const w = standingRow?.[3] || 0;
    const d = standingRow?.[4] || 0;
    const l = standingRow?.[5] || 0;
    const gd = standingRow?.[8] || 0;
    const pts = standingRow?.[9] || 0;

    const fairRows = Array.isArray(fairPlay) ? fairPlay.slice(1).filter(r => r[0]) : [];
    const fairIndex = fairRows.findIndex(r => normalize(r[0]) === normalize(teamName));
    const fairRow = fairIndex !== -1 ? fairRows[fairIndex] : null;

    const fairRank = fairIndex !== -1 ? fairIndex + 1 : '-';
    const yc = fairRow?.[1] || 0;
    const rc = fairRow?.[2] || 0;
    const fp = fairRow?.[3] || 0;

    const captainGoals = getStat('goals', captainPlayer);
    const captainAssists = getStat('assists', captainPlayer);
    const captainGA = getStat('ga', captainPlayer);
    const captainMvps = getStat('mvp', captainPlayer);
    const captainTackles = getStat('tackles', captainPlayer);
    const captainInterceptions = getStat('interceptions', captainPlayer);
    const captainSaves = getStat('saves', captainPlayer);

    const captainLine = `${E.captain} **${captainPlayer}** ${captainId ? `<@${captainId}>` : 'No ID'}\n   ${E.goal} G:${captainGoals} | ${E.assist} A:${captainAssists} | ${E.fire} GA:${captainGA} | ${E.mvp} MVP:${captainMvps}\n   ${E.tackle} T:${captainTackles} | ${E.interception || '🧠'} I:${captainInterceptions}`;

    const otherLines = otherPlayers.map((player, index) => {
      const discordId = otherUserIds[index] || '';
      const mention = discordId ? `<@${discordId}>` : 'No ID';
      const g = getStat('goals', player);
      const a = getStat('assists', player);
      const ga = getStat('ga', player);
      const mvps = getStat('mvp', player);
      const tackles = getStat('tackles', player);
      const interceptions = getStat('interceptions', player);
      // const saves = getStat('saves', player);
      return `${E.played} **${player}** ${mention}\n   ${E.goal} G:${g} | ${E.assist} A:${a} | ${E.fire} GA:${ga} | ${E.mvp} MVP:${mvps}\n   ${E.tackle} T:${tackles} | ${E.interception || '🧠'} I:${interceptions}`;
    });

    const squadLines = [captainLine, ...otherLines];
    const visibleSquadLines = squadLines.slice(0, 8);
    const hiddenSquadCount = Math.max(0, squadLines.length - visibleSquadLines.length);

    let squadDisplay = visibleSquadLines.join('\n') || 'None';

    if (hiddenSquadCount > 0) {
      squadDisplay += `\n\n+ ${hiddenSquadCount} more player${hiddenSquadCount === 1 ? '' : 's'} hidden`;
    }

    if (squadDisplay.length > 1000) {
      squadDisplay = squadDisplay.slice(0, 980).trim() + '\n\n+ more players...';
    }

    // Prepare squad stats for top scorer, assister, mvp leader
    const squadStats = playerList.map((player, index) => ({
      player,
      goals: getStat('goals', player),
      assists: getStat('assists', player),
      mvp: getStat('mvp', player),
      tackles: getStat('tackles', player),
      interceptions: getStat('interceptions', player),
      saves: getStat('saves', player)
    }));

    const topScorer = [...squadStats]
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.player.localeCompare(b.player))[0];

    const topAssister = [...squadStats]
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.player.localeCompare(b.player))[0];

    const topMvp = [...squadStats]
      .sort((a, b) => b.mvp - a.mvp || b.goals - a.goals || a.player.localeCompare(b.player))[0];

    const summary = buildTeamHubSummary(teamName, shortName, teamId, previousName, previousShort, stadium, pos, p, w, d, l, gd, pts, fairRank, fp, squadStats);

    const topDefender = [...squadStats]
      .sort((a, b) => (b.tackles + b.interceptions) - (a.tackles + a.interceptions) || a.player.localeCompare(b.player))[0];

    const topKeeper = [...squadStats]
      .sort((a, b) => b.saves - a.saves || a.player.localeCompare(b.player))[0];

    const teamTotalSaves = squadStats.reduce((sum, player) => sum + (player.saves || 0), 0);

    const highlightsText =
      `${E.goldenBoot} **Top Scorer:** ${topScorer?.player || 'N/A'} (${topScorer?.goals || 0})\n` +
      `${E.playmaker} **Top Assister:** ${topAssister?.player || 'N/A'} (${topAssister?.assists || 0})\n` +
      `${E.mvp} **MVP Leader:** ${topMvp?.player || 'N/A'} (${topMvp?.mvp || 0})\n` +
      `${E.defense || E.tackle} **Best Defender:** ${topDefender?.player || 'N/A'} (${(topDefender?.tackles || 0) + (topDefender?.interceptions || 0)})\n` +
      `${E.save} **Team Saves:** ${teamTotalSaves}`;

    const formText = getTeamForm(fixtures, teamName, shortName);

    const embed = new EmbedBuilder()
      .setTitle(`${E.team} TEAM HUB: ${teamName.toUpperCase()}`)
      .setDescription(buildTeamHubDescription(summary))
      .addFields(
        {
          name: `${E.Stats} Season Stats`,
          value:
            `**Played:** ${p}\n` +
            `**Wins:** ${w}\n` +
            `**Draws:** ${d}\n` +
            `**Losses:** ${l}\n` +
            `**Record:** ${w}W / ${d}D / ${l}L`,
          inline: true
        },
        {
          name: `${E.goal} Goals / Points`,
          value:
            `**GF:** ${standingRow?.[6] || 0}\n` +
            `**GA:** ${standingRow?.[7] || 0}\n` +
            `**GD:** ${gd}\n` +
            `**Pts:** ${pts}`,
          inline: true
        },
        {
          name: `${E.fairplay} Fair Play`,
          value:
            `**Rank:** #${fairRank}\n` +
            `**Yellow Cards:** ${yc}\n` +
            `**Red Cards:** ${rc}\n` +
            `**Fair Play Points:** ${fp}`,
          inline: true
        },
        {
          name: `${E.profile} Squad Members (${playerList.length})`,
          value: squadDisplay,
          inline: false
        },
        {
          name: `${E.fire} Team Leaders`,
          value: highlightsText,
          inline: false
        },
        {
          name: `${E.Stats} Last 5 Form`,
          value: formText,
          inline: true
        },
        {
          name: `${E.suspend} Suspensions`,
          value: formatSuspensions(suspension, shortName),
          inline: false
        }
      )
      .setColor(parseHexColor(teamColor, 0x5865F2))
      .setFooter({ text: `Myteam • Team ID: ${teamId} • Captain: ${captainId || 'Unknown'} • ${shortName}` })
      .setTimestamp();

    if (logo && /^https?:\/\//i.test(logo)) {
      embed.setThumbnail(logo);
    }

    return { embeds: [embed] };
  }
};
