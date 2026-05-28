const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => clean(cell)))
    : [];
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function getTeamRowMeta(row) {
  return {
    type: normalize(row[18]),
    leagueTitles: toNumber(row[10]),
    leagueRunnerUps: toNumber(row[11]),
    faCups: toNumber(row[12]),
    faRunnerUps: toNumber(row[13]),
    carabaoCups: toNumber(row[14]),
    carabaoRunnerUps: toNumber(row[15]),
    ucl: toNumber(row[16]),
    uclRunnerUps: toNumber(row[17]),
    fairPlay: 0
  };
}

function topRowsByValue(rows, getter) {
  if (!rows.length) return [];
  const maxValue = Math.max(...rows.map(row => getter(row)));
  if (maxValue <= 0) return [];
  return rows.filter(row => getter(row) === maxValue);
}

function joinNames(rows, getter) {
  return rows.map(getter).filter(Boolean).join(' / ') || 'Unknown';
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

function buildRecordsSummary(players, teams, rawPlayers, rawTeams) {
  const goalLeaders = getLeaders(players, row => row.goals);
  const trophyLeaders = getLeaders(players, row => row.trophies);
  const titleLeaders = getLeaders(teams, row => row.totalTitles);
  const fairPlayLeaders = getLeaders(teams, row => row.fairPlay);

  return {
    playerRows: rawPlayers.length,
    teamRows: rawTeams.length,
    mostGoals: goalLeaders.length
      ? `${joinLeaders(goalLeaders, row => row.name)} (${goalLeaders[0].goals})`
      : 'N/A',
    mostTrophies: trophyLeaders.length
      ? `${joinLeaders(trophyLeaders, row => row.name)} (${trophyLeaders[0].trophies})`
      : 'N/A',
    mostTitles: titleLeaders.length
      ? `${joinLeaders(titleLeaders, row => row.team)} (${titleLeaders[0].totalTitles})`
      : 'N/A',
    mostFairPlay: fairPlayLeaders.length
      ? `${joinLeaders(fairPlayLeaders, row => row.team)} (${fairPlayLeaders[0].fairPlay})`
      : 'N/A'
  };
}

function buildRecordsDescription(summary) {
  return (
    `${safeEmoji(E.Stats, '📊')} **Historic all-competition records from archive**\n` +
    `All-time player and club record leaders across scoring, awards, trophies, fair play and league achievements.\n\n` +
    `${safeEmoji(E.profile, '👤')} **Player Rows:** ${summary.playerRows}\n` +
    `${safeEmoji(E.team, '👥')} **Team Rows:** ${summary.teamRows}\n` +
    `${safeEmoji(E.goal, '⚽')} **Most Goals:** ${summary.mostGoals}\n` +
    `${safeEmoji(E.trophy_animated, '🏆')} **Most Trophies:** ${summary.mostTrophies}\n` +
    `${safeEmoji(E.trophy_animated, '🏆')} **Most Titles:** ${summary.mostTitles}\n` +
    `${safeEmoji(E.fairplay || E.fairPlay, '🕊️')} **Most Fair Play:** ${summary.mostFairPlay}`
  );
}

function makeRecordField(rows, label, emoji, valueGetter, nameGetter, sublineGetter) {
  const winners = topRowsByValue(rows, valueGetter);
  if (!winners.length) {
    return {
      name: `${emoji} ${label}`,
      value: 'N/A',
      inline: true
    };
  }

  const value = valueGetter(winners[0]);
  const subline = sublineGetter ? sublineGetter(winners) : '';

  return {
    name: `${emoji} ${label}`,
    value:
      `**${joinNames(winners, nameGetter)}**\n` +
      `${subline ? `${subline}\n` : ''}` +
      `${emoji} ${value}`,
    inline: true
  };
}

function aggregatePlayers(rows) {
  const map = new Map();

  rows.forEach(row => {
    const name = clean(row[0]);
    if (!name) return;

    if (!map.has(name)) {
      map.set(name, {
        name,
        teams: new Set(),
        goals: 0,
        assists: 0,
        ga: 0,
        mvp: 0,
        tackles: 0,
        interceptions: 0,
        saves: 0,
        trophies: 0,
        leagueTitles: 0,
        runnerUps: 0,
        faCups: 0,
        carabaoCups: 0,
        ucl: 0,
        awards: 0,
        motm: 0
      });
    }

    const player = map.get(name);
    if (row[2]) player.teams.add(clean(row[2]));
    player.goals += toNumber(row[8]);
    player.assists += toNumber(row[9]);
    player.ga += toNumber(row[10]);
    player.mvp += toNumber(row[11]);
    player.tackles += toNumber(row[12]);
    player.interceptions += toNumber(row[13]);
    player.saves += toNumber(row[14]);
    player.trophies += toNumber(row[17]);
    player.leagueTitles += toNumber(row[18]);
    player.runnerUps += toNumber(row[19]) + toNumber(row[21]) + toNumber(row[23]) + toNumber(row[25]);
    player.faCups += toNumber(row[20]);
    player.carabaoCups += toNumber(row[22]);

    player.ucl += toNumber(row[24]);

    player.awards += toNumber(row[27]);
    player.motm += toNumber(row[28]);
  });

  return [...map.values()].map(player => ({
    ...player,
    teamLine: [...player.teams].filter(Boolean).join(' / ') || 'N/A'
  }));
}

function aggregateTeams(rows) {
  const map = new Map();

  rows.forEach(row => {
    const teamName = clean(row[0]);
    if (!teamName) return;

    if (!map.has(teamName)) {
      map.set(teamName, {
        team: teamName,
        seasons: new Set(),
        points: 0,
        wins: 0,
        gd: 0,
        leagueTitles: 0,
        runnerUps: 0,
        faCups: 0,
        carabaoCups: 0,
        ucl: 0,
        fairPlay: 0
      });
    }

    const team = map.get(teamName);
    const meta = getTeamRowMeta(row);

    if (row[1]) team.seasons.add(`S${clean(row[1])}`);
    team.points += toNumber(row[9]);
    team.wins += toNumber(row[3]);
    team.gd += toNumber(row[8]);
    team.leagueTitles += meta.leagueTitles;
    team.runnerUps += meta.leagueRunnerUps + meta.faRunnerUps + meta.carabaoRunnerUps + meta.uclRunnerUps;
    team.faCups += meta.faCups;
    team.carabaoCups += meta.carabaoCups;
    team.ucl += meta.ucl;
    team.fairPlay += meta.fairPlay;
  });

  return [...map.values()].map(team => ({
    ...team,
    totalTitles: team.leagueTitles + team.faCups + team.carabaoCups + team.ucl,
    runnerUps: team.runnerUps,
    seasonLine: [...team.seasons].filter(Boolean).join(' / ') || 'N/A'
  }));
}

async function buildPage() {
  const [playerData, teamData] = await Promise.all([
    cachedGetData('All_Time_Player_Stats!A:AG'),
    cachedGetData('All_Time_Team_Stats!A:V')
  ]);

  const rawPlayers = cleanRows(playerData);
  const rawTeams = cleanRows(teamData);

  const players = aggregatePlayers(rawPlayers);
  const teams = aggregateTeams(rawTeams);
  const summary = buildRecordsSummary(players, teams, rawPlayers, rawTeams);

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.rank, '🏅')} SIUUVERSE ALL-TIME RECORDS`)
    .setDescription(buildRecordsDescription(summary))
    .addFields(
      makeRecordField(players, 'Most Goals', safeEmoji(E.goal, '⚽'), row => row.goals, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Assists', safeEmoji(E.assist, '🎯'), row => row.assists, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most G/A', safeEmoji(E.fire, '🔥'), row => row.ga, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most MVP', safeEmoji(E.mvp, '⭐'), row => row.mvp, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Tackles', safeEmoji(E.tackle, '🛡️'), row => row.tackles, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Interceptions', safeEmoji(E.interception, '✂️'), row => row.interceptions, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Saves', safeEmoji(E.save, '🧤'), row => row.saves, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Trophies', safeEmoji(E.trophy_animated, '🏆'), row => row.trophies, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Awards', safeEmoji(E.winner || E.leagueWinner, '👑'), row => row.awards, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(players, 'Most Runner-Ups', safeEmoji(E.runnerUp || E.leagueRunnerUp, '🥈'), row => row.runnerUps, row => row.name, winners => `${safeEmoji(E.team, '👥')} ${joinNames(winners, row => row.teamLine)}`),
      makeRecordField(teams, 'Most Points (League)', safeEmoji(E.league, '🏆'), row => row.points, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`),
      makeRecordField(teams, 'Most Wins (League)', safeEmoji(E.win, '✅'), row => row.wins, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`),
      makeRecordField(teams, 'Best Goal Difference (League)', safeEmoji(E.up, '📈'), row => row.gd, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`),
      makeRecordField(teams, 'Most Titles', safeEmoji(E.trophy_animated, '🏆'), row => row.totalTitles, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`),
      makeRecordField(teams, 'Most Runner-Ups', safeEmoji(E.runnerUp || E.leagueRunnerUp, '🥈'), row => row.runnerUps, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`),
      makeRecordField(teams, 'Most Fair Play', safeEmoji(E.fairplay || E.fairPlay, '🕊️'), row => row.fairPlay, row => row.team, winners => `${safeEmoji(E.calendar, '📅')} ${joinNames(winners, row => row.seasonLine)}`)
    )
    .setColor(0x9B59B6)
    .setFooter({ text: 'Records Archive • All-time player and club records' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: []
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('records')
    .setDescription('Show all-time archive records across all competitions'),

  async execute() {
    return buildPage();
  }
};
