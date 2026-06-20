const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const MEDALS = [
  E.winner || '🥇',
  E.runnerUp || '🥈',
  E.medal || '🥉',
  E.medal || '🏅',
  E.medal || '🏅'
];

const HALL_OF_FAME_LIMIT = 10;
const HALL_OF_FAME_PAGE_SIZE = 3;

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toNumber(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => clean(cell)))
    : [];
}

function makeHeaderMap(headers = []) {
  const map = new Map();
  headers.forEach((header, index) => map.set(normalize(header), index));
  return map;
}

function findColumn(headerMap, names = []) {
  for (const name of names) {
    const index = headerMap.get(normalize(name));
    if (index !== undefined) return index;
  }
  return -1;
}

function textAt(row, index) {
  return index >= 0 ? clean(row[index]) : '';
}

function numberAt(row, index) {
  return index >= 0 ? toNumber(row[index]) : 0;
}

function isCountableIndividualAward(awardName) {
  const award = normalize(awardName);
  return award && !award.includes('winner') && !award.includes('champion') && !award.includes('runner') && !award.includes('relegated');
}

function aggregatePlayerAwards(awardRows = []) {
  const counts = new Map();

  cleanRows(awardRows).forEach(row => {
    const player = clean(row[1]);
    const award = clean(row[2]);
    if (!player || !isCountableIndividualAward(award)) return;

    counts.set(normalize(player), (counts.get(normalize(player)) || 0) + 1);
  });

  return counts;
}

function aggregatePlayers(playerRows = [], awardCounts = new Map()) {
  const headerMap = makeHeaderMap(playerRows[0] || []);

  const playerNameCol = findColumn(headerMap, ['Player', 'Name']);
  const playerTeamCol = findColumn(headerMap, ['Team']);
  const playerTeamIdCol = findColumn(headerMap, ['Team ID', 'TeamID', 'Club ID']);
  const playerSeasonsCol = findColumn(headerMap, ['Seasons', 'Season']);
  const playerGoalsCol = findColumn(headerMap, ['Goals']);
  const playerAssistsCol = findColumn(headerMap, ['Assists']);
  const playerGaCol = findColumn(headerMap, ['GA', 'G/A']);
  const playerMvpCol = findColumn(headerMap, ['MVP']);
  const playerTrophiesCol = findColumn(headerMap, ['Trophies']);
  const playerLeagueTitlesCol = findColumn(headerMap, ['League Titles']);
  const playerLeagueRunnerUpsCol = findColumn(headerMap, ['League Runner-Ups', 'League Runner Ups']);
  const playerFaCupsCol = findColumn(headerMap, ['FA Cups', 'FA Cup']);
  const playerFaRunnerUpsCol = findColumn(headerMap, ['FA Runner-Ups', 'FA Runner Ups']);
  const playerCarabaoCupsCol = findColumn(headerMap, ['Carabao Cups', 'Carabao Cup']);
  const playerCarabaoRunnerUpsCol = findColumn(headerMap, ['Carabao Runner-Ups', 'Carabao Runner Ups']);
  const playerUclCol = findColumn(headerMap, ['UCL']);
  const playerUclRunnerUpsCol = findColumn(headerMap, ['UCL Runner-Ups', 'UCL Runner Ups']);
  const playerAwardsCol = findColumn(headerMap, ['Awards', 'Total Awards']);

  const map = new Map();

  cleanRows(playerRows).forEach(row => {
    const name = textAt(row, playerNameCol);
    if (!name) return;

    const key = normalize(name);
    if (!map.has(key)) {
      map.set(key, {
        name,
        teams: new Set(),
        teamIds: new Set(),
        seasons: 0,
        goals: 0,
        assists: 0,
        ga: 0,
        mvps: 0,
        trophies: 0,
        leagueTitles: 0,
        leagueRunnerUps: 0,
        runnerUps: 0,
        faCups: 0,
        faRunnerUps: 0,
        carabaoCups: 0,
        carabaoRunnerUps: 0,
        ucl: 0,
        uclRunnerUps: 0,
        awards: 0
      });
    }

    const player = map.get(key);
    const team = textAt(row, playerTeamCol);
    const teamId = textAt(row, playerTeamIdCol) || row.map(cell => clean(cell)).find(cell => /^T\d+$/i.test(cell)) || '';

    if (team) player.teams.add(team);
    if (teamId) player.teamIds.add(teamId.toUpperCase());

    player.seasons += numberAt(row, playerSeasonsCol);
    player.goals += numberAt(row, playerGoalsCol);
    player.assists += numberAt(row, playerAssistsCol);
    player.ga += numberAt(row, playerGaCol) || (numberAt(row, playerGoalsCol) + numberAt(row, playerAssistsCol));
    player.mvps += numberAt(row, playerMvpCol);
    player.trophies += numberAt(row, playerTrophiesCol);
    player.leagueTitles += numberAt(row, playerLeagueTitlesCol);
    player.leagueRunnerUps += numberAt(row, playerLeagueRunnerUpsCol);
    player.faCups += numberAt(row, playerFaCupsCol);
    player.faRunnerUps += numberAt(row, playerFaRunnerUpsCol);
    player.carabaoCups += numberAt(row, playerCarabaoCupsCol);
    player.carabaoRunnerUps += numberAt(row, playerCarabaoRunnerUpsCol);
    player.ucl += numberAt(row, playerUclCol);
    player.uclRunnerUps += numberAt(row, playerUclRunnerUpsCol);
    player.runnerUps +=
      numberAt(row, playerLeagueRunnerUpsCol) +
      numberAt(row, playerFaRunnerUpsCol) +
      numberAt(row, playerCarabaoRunnerUpsCol) +
      numberAt(row, playerUclRunnerUpsCol);
    player.awards += numberAt(row, playerAwardsCol);
  });

  return [...map.values()]
    .map(player => {
      const fallbackAwards = awardCounts.get(normalize(player.name)) || 0;
      player.awards = Math.max(player.awards, fallbackAwards);
      player.teamLine = [...player.teams].filter(Boolean).join(' / ') || 'N/A';
      player.teamIdLine = [...player.teamIds].filter(Boolean).join(' / ') || 'N/A';
      player.score =
        (player.trophies * 100) +
        (player.ucl * 90) +
        (player.leagueTitles * 70) +
        (player.faCups * 45) +
        (player.carabaoCups * 35) +
        (player.awards * 35) +
        (player.runnerUps * 20) +
        (player.mvps * 18) +
        (player.goals * 2) +
        player.assists +
        (player.seasons * 8);
      return player;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.trophies !== a.trophies) return b.trophies - a.trophies;
      if (b.awards !== a.awards) return b.awards - a.awards;
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.name.localeCompare(b.name);
    })
    .slice(0, HALL_OF_FAME_LIMIT)
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

function aggregateTeams(teamRows = []) {
  const headerMap = makeHeaderMap(teamRows[0] || []);

  const teamNameCol = findColumn(headerMap, ['Team', 'Name']);
  const teamIdCol = findColumn(headerMap, ['Team ID', 'TeamID', 'Club ID']);
  const teamSeasonCol = findColumn(headerMap, ['Seasons', 'Season']);
  const teamTitlesCol = findColumn(headerMap, ['League Titles', 'Titles']);
  const teamLeagueRunnerUpsCol = findColumn(headerMap, ['League Runner-Ups', 'League Runner Ups', 'Runner-Ups', 'Runner Ups']);
  const teamFaCupsCol = findColumn(headerMap, ['FA Cups', 'FA Cup', 'Cups']);
  const teamFaRunnerUpsCol = findColumn(headerMap, ['FA Runner-Ups', 'FA Runner Ups']);
  const teamCarabaoCupsCol = findColumn(headerMap, ['Carabao Cups', 'Carabao Cup']);
  const teamCarabaoRunnerUpsCol = findColumn(headerMap, ['Carabao Runner-Ups', 'Carabao Runner Ups']);
  const teamUclCol = findColumn(headerMap, ['UCL']);
  const teamUclRunnerUpsCol = findColumn(headerMap, ['UCL Runner-Ups', 'UCL Runner Ups']);
  const teamFairPlayCol = findColumn(headerMap, ['Fair Play', 'Fairplay']);

  const map = new Map();

  cleanRows(teamRows).forEach(row => {
    const name = textAt(row, teamNameCol);
    if (!name) return;

    const key = normalize(name);
    if (!map.has(key)) {
      map.set(key, {
        name,
        teamId: '',
        seasons: 0,
        titles: 0,
        leagueRunnerUps: 0,
        runnerUps: 0,
        faCups: 0,
        faRunnerUps: 0,
        carabaoCups: 0,
        carabaoRunnerUps: 0,
        ucl: 0,
        uclRunnerUps: 0,
        fairPlay: 0
      });
    }

    const team = map.get(key);
    const teamId = textAt(row, teamIdCol) || row.map(cell => clean(cell)).find(cell => /^T\d+$/i.test(cell)) || '';
    if (teamId && !team.teamId) team.teamId = teamId.toUpperCase();

    team.seasons += numberAt(row, teamSeasonCol);
    team.titles += numberAt(row, teamTitlesCol);
    team.leagueRunnerUps += numberAt(row, teamLeagueRunnerUpsCol);
    team.faCups += numberAt(row, teamFaCupsCol);
    team.faRunnerUps += numberAt(row, teamFaRunnerUpsCol);
    team.carabaoCups += numberAt(row, teamCarabaoCupsCol);
    team.carabaoRunnerUps += numberAt(row, teamCarabaoRunnerUpsCol);
    team.ucl += numberAt(row, teamUclCol);
    team.uclRunnerUps += numberAt(row, teamUclRunnerUpsCol);
    team.runnerUps +=
      numberAt(row, teamLeagueRunnerUpsCol) +
      numberAt(row, teamFaRunnerUpsCol) +
      numberAt(row, teamCarabaoRunnerUpsCol) +
      numberAt(row, teamUclRunnerUpsCol);
    team.fairPlay += numberAt(row, teamFairPlayCol);
  });

  return [...map.values()]
    .map(team => {
      team.score =
        (team.titles * 100) +
        (team.ucl * 100) +
        (team.faCups * 70) +
        (team.carabaoCups * 55) +
        (team.runnerUps * 25) +
        (team.fairPlay * 15) +
        (team.seasons * 8);
      return team;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.titles !== a.titles) return b.titles - a.titles;
      if (b.ucl !== a.ucl) return b.ucl - a.ucl;
      if (b.faCups !== a.faCups) return b.faCups - a.faCups;
      if (b.carabaoCups !== a.carabaoCups) return b.carabaoCups - a.carabaoCups;
      if (b.runnerUps !== a.runnerUps) return b.runnerUps - a.runnerUps;
      return a.name.localeCompare(b.name);
    })
    .slice(0, HALL_OF_FAME_LIMIT)
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

function formatPlayer(player, index) {
  const rankIndex = Math.max((player.rank || index + 1) - 1, 0);
  return `${MEDALS[rankIndex] || safeEmoji(E.medal, '🏅')} **#${player.rank || index + 1} ${player.name}**\n` +
    `> ${safeEmoji(E.team, '👥')} ${player.teamLine} • 🆔 ${player.teamIdLine}\n` +
    `> ${safeEmoji(E.trophy_animated, '🏆')} ${player.trophies} • ${safeEmoji(E.PL, '🏆')} ${player.leagueTitles} • ${safeEmoji(E.runnerUp, '🥈')} ${player.runnerUps}\n` +
    `> ${safeEmoji(E.FA, '🏆')} ${player.faCups} • ${safeEmoji(E.Carabao, '🏆')} ${player.carabaoCups} • ${safeEmoji(E.UCL, '🌍')} ${player.ucl}\n` +
    `> ${safeEmoji(E.badge, '🏅')} ${player.awards} • ${safeEmoji(E.goal, '⚽')} ${player.goals} • ${safeEmoji(E.assist, '🎯')} ${player.assists} • ${safeEmoji(E.mvp, '⭐')} ${player.mvps}\n` +
    `> ${safeEmoji(E.calendar, '📅')} ${player.seasons}`;
}

function formatTeam(team, index) {
  const rankIndex = Math.max((team.rank || index + 1) - 1, 0);
  const teamIdText = team.teamId ? ` • 🆔 ${team.teamId}` : '';
  return `${MEDALS[rankIndex] || safeEmoji(E.medal, '🏅')} **#${team.rank || index + 1} ${team.name}**${teamIdText}\n` +
    `> ${safeEmoji(E.trophy_animated, '🏆')} ${team.titles} • ${safeEmoji(E.runnerUp, '🥈')} ${team.runnerUps} • ${safeEmoji(E.FA, '🏆')} ${team.faCups}\n` +
    `> ${safeEmoji(E.Carabao, '🏆')} ${team.carabaoCups} • ${safeEmoji(E.UCL, '🌍')} ${team.ucl} • ${safeEmoji(E.fairplay, '🕊️')} ${team.fairPlay}\n` +
    `> ${safeEmoji(E.calendar, '📅')} ${team.seasons}`;
}

function joinLeaders(items = [], formatter, empty = 'N/A') {
  if (!items.length) return empty;
  return items.map(formatter).join(' / ');
}

function getTopValue(items = [], accessor) {
  if (!items.length) return 0;
  return Math.max(...items.map(accessor));
}

function getLeaders(items = [], accessor) {
  const top = getTopValue(items, accessor);
  if (!top) return [];
  return items.filter(item => accessor(item) === top);
}

function buildPlayerSummary(players = []) {
  const mostTitles = getLeaders(players, row => row.trophies);
  const mostAwards = getLeaders(players, row => row.awards);
  const mostRunnerUps = getLeaders(players, row => row.runnerUps);

  return {
    total: players.length,
    topLegend: players[0]
      ? `\`${clean(players[0].name)}\``
      : 'N/A',
    mostTitles: mostTitles.length
      ? `${joinLeaders(mostTitles, row => row.name)} (${mostTitles[0].trophies})`
      : 'N/A',
    mostAwards: mostAwards.length
      ? `${joinLeaders(mostAwards, row => row.name)} (${mostAwards[0].awards})`
      : 'N/A',
    mostRunnerUps: mostRunnerUps.length
      ? `${joinLeaders(mostRunnerUps, row => row.name)} (${mostRunnerUps[0].runnerUps})`
      : 'N/A'
  };
}

function buildTeamSummary(teams = []) {
  const mostTitles = getLeaders(teams, row => row.titles + row.ucl + row.faCups + row.carabaoCups);
  const mostRunnerUps = getLeaders(teams, row => row.runnerUps);
  const mostFairPlay = getLeaders(teams, row => row.fairPlay);

  return {
    total: teams.length,
    topLegend: teams[0]
      ? `\`${clean(teams[0].name)}\``
      : 'N/A',
    mostTitles: mostTitles.length
      ? `${joinLeaders(mostTitles, row => row.name)} (${(mostTitles[0].titles + mostTitles[0].ucl + mostTitles[0].faCups + mostTitles[0].carabaoCups)})`
      : 'N/A',
    mostRunnerUps: mostRunnerUps.length
      ? `${joinLeaders(mostRunnerUps, row => row.name)} (${mostRunnerUps[0].runnerUps})`
      : 'N/A',
    mostFairPlay: mostFairPlay.length
      ? `${joinLeaders(mostFairPlay, row => row.name)} (${mostFairPlay[0].fairPlay})`
      : 'N/A'
  };
}

function buildHallDescription(isClubView, summary, currentPage, totalPages) {
  if (isClubView) {
    return (
      `${safeEmoji(E.team, '👥')} **Club Legends**\n` +
      `Greatest clubs in SiuuVerse history across league titles, cups, UCL runs and fair play.\n\n` +
      `${safeEmoji(E.trophy_animated, '🏆')} **Top Club:** ${summary.topLegend}\n` +
      `${safeEmoji(E.trophy_animated, '🏆')} **Most Titles:** ${summary.mostTitles}\n` +
      `${safeEmoji(E.runnerUp, '🥈')} **Most Runner-Ups:** ${summary.mostRunnerUps}\n` +
      `${safeEmoji(E.fairplay, '🕊️')} **Most Fair Play:** ${summary.mostFairPlay}\n` +
      `${safeEmoji(E.page || E.calendar, '📄')} **Page:** ${currentPage + 1}/${totalPages}`
    );
  }

  return (
    `${safeEmoji(E.profile, '👤')} **Player Legends**\n` +
    `Greatest players in SiuuVerse history across trophies, awards, goals, assists and long-term legacy.\n\n` +
    `${safeEmoji(E.trophy_animated, '🏆')} **Top Legend:** ${summary.topLegend}\n` +
    `${safeEmoji(E.trophy_animated, '🏆')} **Most Titles:** ${summary.mostTitles}\n` +
    `${safeEmoji(E.badge, '🏅')} **Most Awards:** ${summary.mostAwards}\n` +
    `${safeEmoji(E.runnerUp, '🥈')} **Most Runner-Ups:** ${summary.mostRunnerUps}\n` +
    `${safeEmoji(E.page || E.calendar, '📄')} **Page:** ${currentPage + 1}/${totalPages}`
    );
}

function safeFieldValue(lines) {
  const text = Array.isArray(lines) ? lines.join('\n\n') : String(lines || '');

  if (!text) return ['N/A'];

  const chunks = [];

  for (let i = 0; i < text.length; i += 1024) {
    chunks.push(text.slice(i, i + 1024));
  }

  return chunks.length ? chunks : ['N/A'];
}

function createHallButtons(view = 'players', page = 0, totalPages = 1) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('halloffame_players_players_0')
        .setLabel('Players')
        .setEmoji('👤')
        .setStyle(view === 'players' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('halloffame_clubs_clubs_0')
        .setLabel('Clubs')
        .setEmoji('🏟️')
        .setStyle(view === 'clubs' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`halloffame_refresh_${view}_${page}`)
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`halloffame_prev_${view}_${page}`)
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`halloffame_next_${view}_${page}`)
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  ];
}

async function buildHallPayload(view = 'players', page = 0) {
  const isClubView = view === 'clubs';

  const [playerRows, teamRows, awardRows] = await Promise.all([
    cachedGetData('All_Time_Player_Stats!A:AG'),
    cachedGetData('All_Time_Team_Stats!A:V'),
    cachedGetData('Awards!A:F')
  ]);

  const awardCounts = aggregatePlayerAwards(awardRows || []);
  const players = aggregatePlayers(playerRows || [], awardCounts);
  const teams = aggregateTeams(teamRows || []);

  const items = isClubView ? teams : players;
  const summary = isClubView ? buildTeamSummary(teams) : buildPlayerSummary(players);

  if (!items.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xD4AF37)
          .setTitle(`${safeEmoji(E.trophy_animated, '🏆')} SiuuVerse Hall of Fame`)
          .setDescription(isClubView
            ? `${safeEmoji(E.team, '👥')} **Club Legends**\nGreatest clubs in SiuuVerse history across league titles, cups, UCL runs and fair play.\n\nNo archived club legends yet.`
            : `${safeEmoji(E.profile, '👤')} **Player Legends**\nGreatest players in SiuuVerse history across trophies, awards, goals, assists and long-term legacy.\n\nNo archived player legends yet.`)
          .setTimestamp()
      ]
    };
  }

  const totalPages = Math.max(Math.ceil(items.length / HALL_OF_FAME_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageItems = items.slice(
    currentPage * HALL_OF_FAME_PAGE_SIZE,
    currentPage * HALL_OF_FAME_PAGE_SIZE + HALL_OF_FAME_PAGE_SIZE
  );
  const entries = pageItems.map((item, index) =>
    isClubView ? formatTeam(item, index) : formatPlayer(item, index)
  );
  const entryChunks = safeFieldValue(entries);

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle(`${safeEmoji(E.trophy_animated, '🏆')} SiuuVerse Hall of Fame`)
    .setDescription(buildHallDescription(isClubView, summary, currentPage, totalPages))
    .addFields(
      ...entryChunks.map((chunk, idx) => ({
        name: idx === 0
          ? (isClubView
              ? `${safeEmoji(E.team, '👥')} Club Ranking`
              : `${safeEmoji(E.profile, '👤')} Player Ranking`)
          : '\u200B',
        value: chunk,
        inline: false
      }))
    )
    .setFooter({ text: `Hall of Fame = overall legacy ranking • Records = category leaders • Page ${currentPage + 1}/${totalPages}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: createHallButtons(isClubView ? 'clubs' : 'players', currentPage, totalPages)
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('halloffame')
    .setDescription('View the SiuuVerse all-time Hall of Fame.'),

  async execute(interaction) {
    try {
      const payload = await buildHallPayload('players', 0);
      await interaction.editReply({ embeds: payload.embeds, components: payload.components });
    } catch (error) {
      console.error('HALL OF FAME ERROR:', error);
      await interaction.editReply(`${safeEmoji(E.error, '❌')} Could not load the Hall of Fame right now.`);
    }
  },

  async buttonHandler(interaction, action, viewOrPage, maybePage) {
    try {
      let view = 'players';
      let page = 0;

      if (action === 'players') {
        view = 'players';
        page = 0;
      } else if (action === 'clubs') {
        view = 'clubs';
        page = 0;
      } else if (action === 'refresh') {
        view = viewOrPage === 'clubs' ? 'clubs' : 'players';
        page = Number(maybePage) || 0;
      } else if (action === 'prev' || action === 'next') {
        view = viewOrPage === 'clubs' ? 'clubs' : 'players';
        page = Number(maybePage) || 0;
        page += action === 'next' ? 1 : -1;
      }

      return await buildHallPayload(view, page);
    } catch (error) {
      console.error('HALL OF FAME BUTTON ERROR:', error);
      return {
        content: `${safeEmoji(E.error, '❌')} Could not refresh Hall of Fame right now.`,
        embeds: [],
        components: []
      };
    }
  }
};
