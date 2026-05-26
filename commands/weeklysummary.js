const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function parseCustomEmoji(emojiString) {
  const match = String(emojiString || '').match(/^<a?:(\w+):(\d+)>$/);
  if (!match) return undefined;
  return { name: match[1], id: match[2] };
}

function getMatchdayKey(value) {
  return String(value || '').split('.')[0].trim();
}

function hasScore(row) {
  return row[4] !== '' && row[4] !== undefined && row[5] !== '' && row[5] !== undefined;
}

function cleanPlayerName(value) {
  const raw = String(value || '').trim();
  return raw.includes('-') ? raw.split('-').slice(1).join('-').trim() : raw;
}

function splitNames(value) {
  return String(value || '')
    .split(',')
    .map(v => cleanPlayerName(v).trim())
    .filter(Boolean);
}

function getPrefix(value) {
  const raw = String(value || '').trim();
  if (!raw.includes('-')) return '';
  return raw.split('-')[0].trim();
}

function suspendedPlayersForMd(suspensionRows, md) {
  const currentMd = Number(md);

  return suspensionRows
    .slice(1)
    .filter(r => String(r[0] || '').trim())
    .map(r => {
      const prefix = getPrefix(r[0]);
      const player = cleanPlayerName(r[0]);
      const banMatch = String(r[4] || '-').trim();
      const redMatch = String(r[2] || '-').trim();
      const yellowBan = String(r[3] || '-').trim();
      const status = String(r[5] || '').trim();
      const banMd = Number(String(banMatch).split('.')[0]);

      return {
        prefix,
        player,
        banMatch,
        redMatch,
        yellowBan,
        status,
        banMd
      };
    })
    .filter(s => {
      const hasBanMatch = s.banMatch && s.banMatch !== '-';
      const saysSuspended = s.status && s.status.toLowerCase().includes('suspend');
      const isCurrentOrUpcomingBan = Number.isFinite(s.banMd) && Number.isFinite(currentMd)
        ? s.banMd >= currentMd
        : hasBanMatch;

      return hasBanMatch && (saysSuspended || isCurrentOrUpcomingBan);
    })
    .sort((a, b) => {
      const aVal = Number.isFinite(a.banMd) ? a.banMd : Number.MAX_SAFE_INTEGER;
      const bVal = Number.isFinite(b.banMd) ? b.banMd : Number.MAX_SAFE_INTEGER;
      return aVal - bVal || a.player.localeCompare(b.player);
    });
}

function getCompletedMatchdays(fixtures) {
  const rows = fixtures.slice(1).filter(r => r[0]);

  const grouped = new Map();
  for (const row of rows) {
    const md = getMatchdayKey(row[0]);
    if (!grouped.has(md)) grouped.set(md, []);
    grouped.get(md).push(row);
  }

  const completed = [];
  for (const [md, matches] of grouped.entries()) {
    if (matches.length && matches.every(hasScore)) {
      completed.push(md);
    }
  }

  completed.sort((a, b) => Number(a) - Number(b));
  return completed;
}

function getLatestCompletedMatchday(fixtures) {
  const completed = getCompletedMatchdays(fixtures);
  return completed.length ? completed[completed.length - 1] : null;
}

function top3FromStandings(standingsRows) {
  const rows = standingsRows.slice(1).filter(r => r.some(Boolean));

  const parsed = rows.map((row, i) => {
    const values = row.map(v => String(v || '').trim());

    const team = values.find(v => v && !/^#?\d+$/.test(v) && !/^[-+]?\d+(\.\d+)?%?$/.test(v)) || 'Unknown';

    const rank = Number(row[0]);
    const pts = [...row]
      .reverse()
      .map(v => Number(String(v || '').replace('%', '')))
      .find(v => Number.isFinite(v));

    return {
      rank: Number.isFinite(rank) && rank > 0 ? rank : i + 1,
      team,
      pts: Number.isFinite(pts) ? pts : null
    };
  }).filter(item => item.team !== 'Unknown');

  parsed.sort((a, b) => a.rank - b.rank);
  return parsed.slice(0, 3);
}

function bestFairPlayTeam(fairPlayRows) {
  const rows = fairPlayRows.slice(1).filter(r => r.some(Boolean));

  const parsed = rows.map((row, i) => {
    const values = row.map(v => String(v || '').trim());

    const team = values.find(v => v && !/^\d+$/.test(v) && !/^[-+]?\d+(\.\d+)?$/.test(v)) || null;

    const numeric = row
      .map(v => Number(v))
      .filter(v => Number.isFinite(v));

    const points = numeric.length ? Math.max(...numeric) : null;
    const rank = numeric.length ? Math.min(...numeric) : i + 1;

    return { team, points, rank };
  }).filter(x => x.team && x.points !== null);

  if (!parsed.length) return null;

  parsed.sort((a, b) => a.rank - b.rank || a.points - b.points);
  return parsed[0];
}

function biggestWin(matches) {
  if (!matches.length) return null;

  let best = null;

  for (const row of matches) {
    const isMatchesEntry = row.length >= 10;
    const hg = Number(isMatchesEntry ? row[3] : row[4]);
    const ag = Number(isMatchesEntry ? row[4] : row[5]);
    const home = String(isMatchesEntry ? row[1] : (row[2] || row[7] || 'HOME')).trim();
    const away = String(isMatchesEntry ? row[2] : (row[3] || row[8] || 'AWAY')).trim();

    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    if (hg === ag) continue;

    const diff = Math.abs(hg - ag);

    if (!best || diff > best.diff || (diff === best.diff && Math.max(hg, ag) > Math.max(best.hg, best.ag))) {
      best = {
        matchNo: String(row[0] || '-'),
        home,
        away,
        hg,
        ag,
        diff
      };
    }
  }

  return best;
}

function buildMatchResultsText(matches) {
  const rows = matches.filter(row => {
    const isMatchesEntry = row.length >= 10;
    const hg = Number(isMatchesEntry ? row[3] : row[4]);
    const ag = Number(isMatchesEntry ? row[4] : row[5]);
    return Number.isFinite(hg) && Number.isFinite(ag);
  });

  if (!rows.length) return 'N/A';

  return rows.map(row => {
    const isMatchesEntry = row.length >= 10;
    const matchNo = String(row[0] || '-').trim();
    const home = String(isMatchesEntry ? row[1] : (row[2] || row[7] || 'HOME')).trim();
    const away = String(isMatchesEntry ? row[2] : (row[3] || row[8] || 'AWAY')).trim();
    const hg = Number(isMatchesEntry ? row[3] : row[4]);
    const ag = Number(isMatchesEntry ? row[4] : row[5]);

    const homeMark = hg > ag ? E.correct : hg === ag ? E.equal : E.wrong;
    const awayMark = ag > hg ? E.correct : hg === ag ? E.equal : E.wrong;

    return `**${matchNo}** ${homeMark} ${home} **${hg}-${ag}** ${awayMark} ${away}`;
  }).join('\n');
}

function getFixtureTeam(row, home = true) {
  return String(home ? (row[2] || row[7] || '') : (row[3] || row[8] || '')).trim();
}

function buildRankMapFromFixtures(fixtures, maxMd) {
  const table = new Map();

  const ensure = team => {
    const key = String(team || '').trim();
    if (!key) return null;
    if (!table.has(key)) {
      table.set(key, {
        team: key,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0
      });
    }
    return table.get(key);
  };

  fixtures.slice(1).forEach(row => {
    const mdNo = Number(getMatchdayKey(row[0]));
    if (!Number.isFinite(mdNo) || mdNo > Number(maxMd)) return;
    if (!hasScore(row)) return;

    const home = getFixtureTeam(row, true);
    const away = getFixtureTeam(row, false);
    const hg = Number(row[4]);
    const ag = Number(row[5]);

    if (!home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) return;

    const h = ensure(home);
    const a = ensure(away);
    if (!h || !a) return;

    h.played += 1;
    a.played += 1;
    h.gf += hg;
    h.ga += ag;
    a.gf += ag;
    a.ga += hg;

    if (hg > ag) {
      h.wins += 1;
      a.losses += 1;
      h.pts += 3;
    } else if (hg < ag) {
      a.wins += 1;
      h.losses += 1;
      a.pts += 3;
    } else {
      h.draws += 1;
      a.draws += 1;
      h.pts += 1;
      a.pts += 1;
    }
  });

  const rows = [...table.values()].map(t => ({
    ...t,
    gd: t.gf - t.ga
  }));

  rows.sort((a, b) =>
    b.pts - a.pts ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.team.localeCompare(b.team)
  );

  const rankMap = new Map();
  rows.forEach((row, index) => {
    rankMap.set(row.team.toLowerCase(), index + 1);
  });

  return rankMap;
}

function movementIcon(team, beforeRankMap, afterRankMap) {
  const key = String(team || '').trim().toLowerCase();
  const before = beforeRankMap.get(key);
  const after = afterRankMap.get(key);

  if (!before || !after) return E.equal;
  if (after < before) return E.up;
  if (after > before) return E.down;
  return E.equal;
}

function buildWeeklyOverview(md, completedMatchdays, mdMatches, suspended, top3, fairPlayWinner, bigWin, potw) {
  return {
    matchday: String(md),
    completedCount: completedMatchdays.length,
    matches: mdMatches.length,
    suspended: suspended.length,
    topTeam: top3[0]?.team || 'N/A',
    fairPlayTeam: fairPlayWinner?.team || 'N/A',
    biggestWin: bigWin ? `${bigWin.home} ${bigWin.hg}-${bigWin.ag} ${bigWin.away}` : 'N/A',
    potw: potw ? `${potw.prefix ? `[${potw.prefix}] ` : ''}${potw.name}` : 'N/A'
  };
}

function buildWeeklyDescription(overview) {
  return (
    `${safeEmoji(E.calendar, '📅')} **Completed Matchday Summary**\n` +
    `Latest fully completed league matchday recap based on the current sheet data.\n\n` +
    `${safeEmoji(E.calendar, '📅')} **Matchday:** ${overview.matchday}\n` +
    `${safeEmoji(E.correct, '✅')} **Completed Matchdays:** ${overview.completedCount}\n` +
    `${safeEmoji(E.ball || E.goal, '⚽')} **Matches Played:** ${overview.matches}\n` +
    `${safeEmoji(E.Stats || E.rank, '📊')} **Current Leader:** ${overview.topTeam}\n` +
    `${safeEmoji(E.fairplay || E.fairPlay, '🕊️')} **Fair Play Leader:** ${overview.fairPlayTeam}\n` +
    `${safeEmoji(E.fire, '🔥')} **Biggest Win:** ${overview.biggestWin}\n` +
    `${safeEmoji(E.mvp, '⭐')} **Player of the Week:** ${overview.potw}\n` +
    `${safeEmoji(E.suspend, '🚫')} **Suspended Players:** ${overview.suspended}`
  );
}

function calculatePlayerStats(matches) {
  const stats = new Map();

  const ensure = (name) => {
    const raw = String(name || '').trim();
    const prefix = getPrefix(raw);
    const key = cleanPlayerName(raw);
    if (!key) return null;
    if (!stats.has(key)) {
      stats.set(key, {
        name: key,
        prefix,
        goals: 0,
        assists: 0,
        mvp: 0,
        score: 0
      });
    }

    const player = stats.get(key);
    if (!player.prefix && prefix) player.prefix = prefix;
    return player;
  };

  for (const row of matches) {
    for (const name of splitNames(row[5])) {
      const p = ensure(name);
      if (p) p.goals += 1;
    }

    for (const name of splitNames(row[6])) {
      const p = ensure(name);
      if (p) p.assists += 1;
    }

    for (const name of splitNames(row[9])) {
      const p = ensure(name);
      if (p) p.mvp += 1;
    }
  }

  for (const player of stats.values()) {
    player.score =
      player.goals * 3 +
      player.assists * 2 +
      player.mvp * 3;
  }

  return [...stats.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.assists !== a.assists) return b.assists - a.assists;
    return a.name.localeCompare(b.name);
  });
}

function safeEmoji(emoji, fallback) {
  return emoji ? emoji : fallback;
}

async function buildWeeklySummaryPayload(forcedMd = null) {
  const [fixtures, standings, fairPlay, suspension, matchesEntry] = await Promise.all([
    cachedGetData('Fixtures!A:I'),
    cachedGetData('Standings!A:J'),
    cachedGetData('Fair_Play!H:K'),
    cachedGetData('Suspension!A:G'),
    cachedGetData('Matches_Entry!A:M')
  ]);

  if (!Array.isArray(fixtures) || fixtures.length <= 1) {
    return { error: `${E.wrong} Fixtures sheet is empty.` };
  }

  const completedMatchdays = getCompletedMatchdays(fixtures);
  const md = forcedMd ? getMatchdayKey(forcedMd) : getLatestCompletedMatchday(fixtures);

  if (!md) {
    return { error: `${E.wrong} No fully completed matchday found yet.` };
  }

  if (!completedMatchdays.includes(String(md))) {
    return { error: `${E.wrong} Matchday ${md} is not fully completed yet.` };
  }

  const mdFixtures = fixtures
    .slice(1)
    .filter(r => getMatchdayKey(r[0]) === String(md));

  const mdMatches = matchesEntry
    .slice(1)
    .filter(r => getMatchdayKey(r[0]) === String(md));

  const top3 = top3FromStandings(standings);
  const beforeRankMap = buildRankMapFromFixtures(fixtures, Number(md) - 1);
  const afterRankMap = buildRankMapFromFixtures(fixtures, Number(md));
  const fairPlayWinner = bestFairPlayTeam(fairPlay);
  const suspended = suspendedPlayersForMd(suspension, md);
  const bigWin = biggestWin(mdMatches.length ? mdMatches : mdFixtures);
  const matchResultsText = buildMatchResultsText(mdMatches.length ? mdMatches : mdFixtures);

  const playerStats = calculatePlayerStats(mdMatches);
  const topScorer = [...playerStats]
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name))[0];
  const topAssister = [...playerStats]
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.name.localeCompare(b.name))[0];
  const potw = playerStats[0];
  const overview = buildWeeklyOverview(md, completedMatchdays, mdMatches, suspended, top3, fairPlayWinner, bigWin, potw);

  const top3Text = top3.length
    ? top3.map(t => {
        const icon = movementIcon(t.team, beforeRankMap, afterRankMap);
        const before = beforeRankMap.get(String(t.team || '').trim().toLowerCase());
        const after = afterRankMap.get(String(t.team || '').trim().toLowerCase()) || t.rank;
        const movement = before ? ` #${before} ${E.shortArrow} #${after}` : ` Now #${after}`;
        return `${icon} ${t.team}${t.pts !== null ? ` — ${t.pts} pts` : ''}${movement}`;
      }).join('\n')
    : 'N/A';

  const scorerText = topScorer
    ? `${E.underArrow} **${topScorer.prefix ? `[${topScorer.prefix}] ` : ''}${topScorer.name}** ${E.shortArrow} ${topScorer.goals} goals`
    : 'N/A';
  const assisterText = topAssister
    ? `${E.underArrow} **${topAssister.prefix ? `[${topAssister.prefix}] ` : ''}${topAssister.name}** ${E.shortArrow} ${topAssister.assists} assists`
    : 'N/A';

  const fairPlayText = fairPlayWinner
    ? `${E.underArrow} **${fairPlayWinner.team}** ${E.shortArrow} ${fairPlayWinner.points} pts`
    : 'N/A';

  const suspensionFields = suspended.length
    ? [{ name: `${E.suspend} Suspended Players`, value: 'Showing active/current bans below.', inline: false }]
    : [{ name: `${E.suspend} Suspended Players`, value: 'None', inline: false }];

  for (let i = 0; i < suspended.length; i += 2) {
    const left = suspended[i];
    const right = suspended[i + 1];

    const formatCard = (s, index) => {
      if (!s) return '\u200B';
      return `${E.suspend} **${index + 1}. ${s.prefix ? `[${s.prefix}] ` : ''}${s.player}**\n` +
        `${E.shortArrow} Ban: **${s.banMatch}**\n` +
        `${E.shortArrow} Red: **${s.redMatch}**\n` +
        `${E.shortArrow} Yellow Ban: **${s.yellowBan}**`;
    };

    suspensionFields.push(
      {
        name: '\u200B',
        value: formatCard(left, i),
        inline: true
      },
      {
        name: '\u200B',
        value: formatCard(right, i + 1),
        inline: true
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true
      }
    );
  }

  const short = name => String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase() || String(name || 'N/A').slice(0, 4).toUpperCase();

  const biggestWinText = bigWin
    ? `**${bigWin.matchNo}** ${short(bigWin.home)} **${bigWin.hg}-${bigWin.ag}** ${short(bigWin.away)} (${bigWin.diff} GD)`
    : 'N/A';

  const potwText = potw
    ? `**${potw.prefix ? `[${potw.prefix}] ` : ''}${potw.name}**\n${E.goal} Goals: **${potw.goals}**\n${E.assist} Assists: **${potw.assists}**\n${E.mvp} MVP: **${potw.mvp}**\n${E.fire} Score: **${potw.score}**`
    : 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(`${E.calendar} Matchday ${md} Weekly Summary`)
    .setDescription(buildWeeklyDescription(overview))
    .addFields(
      { name: `${E.Stats} Standings Top 3`, value: top3Text, inline: false },
      { name: `${E.ball} Match Results`, value: matchResultsText.slice(0, 1024), inline: false },
      { name: `${E.goal} Top Scorer`, value: scorerText, inline: true },
      { name: `${E.assist} Top Assister`, value: assisterText, inline: true },
      { name: `${E.fairplay} Best Fair Play`, value: fairPlayText, inline: false },
      ...suspensionFields,
      { name: `${E.fire} Biggest Win`, value: biggestWinText, inline: false },
      { name: `${E.mvp} Player of the Week`, value: potwText, inline: false }
    )
    .setColor(0x2ECC71)
    .setFooter({ text: `Weekly Summary • MD ${md} • POTW score: goals(3) + assists(2) + MVP(3)` });

  return { md: String(md), embed, completedMatchdays };
}

function buildWeeklySummaryButtons(currentMd, completedMatchdays) {
  const list = completedMatchdays.map(String);
  const index = list.indexOf(String(currentMd));
  const prevMd = index > 0 ? list[index - 1] : null;
  const nextMd = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`weeklysummary_prev_${prevMd || currentMd}`)
        .setEmoji(parseCustomEmoji(E.shortArrow))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!prevMd),
      new ButtonBuilder()
        .setCustomId(`weeklysummary_refresh_${currentMd}`)
        .setEmoji('🔄')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`weeklysummary_next_${nextMd || currentMd}`)
        .setEmoji(parseCustomEmoji(E.longArrow))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!nextMd)
    )
  ];
}

module.exports = {
  buildWeeklySummaryPayload,
  data: new SlashCommandBuilder()
    .setName('weeklysummary')
    .setDescription('Show summary for a completed matchday')
    .addIntegerOption(option =>
      option
        .setName('matchday')
        .setDescription('Matchday number to view. Leave empty for latest completed matchday.')
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction) {
    const requestedMd = interaction?.options?.getInteger('matchday') || null;
    const summary = await buildWeeklySummaryPayload(requestedMd);

    if (summary.error) {
      return { content: summary.error };
    }

    return {
      embeds: [summary.embed],
      components: buildWeeklySummaryButtons(summary.md, summary.completedMatchdays)
    };
  },

  async buttonHandler(interaction, action, value) {
    const targetMd = String(value || '').trim();
    const summary = await buildWeeklySummaryPayload(targetMd);

    if (summary.error) {
      return {
        content: summary.error,
        components: []
      };
    }

    return {
      embeds: [summary.embed],
      components: buildWeeklySummaryButtons(summary.md, summary.completedMatchdays)
    };
  }
};