const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const PAGE_SIZE = 1;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function buildHeaderMap(headers = []) {
  const map = new Map();
  headers.forEach((header, index) => {
    map.set(normalize(header), index);
  });
  return map;
}

function findColumn(headerMap, names, fallback = -1) {
  for (const name of names) {
    const key = normalize(name);
    if (headerMap.has(key)) return headerMap.get(key);
  }
  return fallback;
}

function textAt(row, index, fallback = 'N/A') {
  if (index < 0) return fallback;
  const value = String(row[index] || '').trim();
  return value || fallback;
}

function getSeasonLabel(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+)/);
  return match ? match[1] : text || 'N/A';
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

function buildSeasonArchiveSummary(rows, columns) {
  const seasonSummaries = rows.map(row => ({
    season: textAt(row, columns.season, 'N/A'),
    champion: textAt(row, columns.champion, 'N/A'),
    runnerUp: textAt(row, columns.runnerUp, 'N/A'),
    fairPlay: textAt(row, columns.fairPlay, 'N/A'),
    type: textAt(row, columns.type, 'Coop / League')
  }));

  const championLeaders = getLeaders(
    seasonSummaries.filter(item => item.champion !== 'N/A'),
    item => seasonSummaries.filter(row => row.champion === item.champion).length
  );

  const runnerUpLeaders = getLeaders(
    seasonSummaries.filter(item => item.runnerUp !== 'N/A'),
    item => seasonSummaries.filter(row => row.runnerUp === item.runnerUp).length
  );

  const fairPlayLeaders = getLeaders(
    seasonSummaries.filter(item => item.fairPlay !== 'N/A'),
    item => seasonSummaries.filter(row => row.fairPlay === item.fairPlay).length
  );

  return {
    seasons: rows.length,
    latestSeason: rows[0] ? getSeasonLabel(textAt(rows[0], columns.season, 'N/A')) : 'N/A',
    mostTitles: championLeaders.length
      ? `${joinLeaders(
          championLeaders
            .map(item => item.champion)
            .filter((value, index, arr) => arr.indexOf(value) === index),
          value => value
        )} (${seasonSummaries.filter(row => row.champion === championLeaders[0].champion).length})`
      : 'N/A',
    mostRunnerUps: runnerUpLeaders.length
      ? `${joinLeaders(
          runnerUpLeaders
            .map(item => item.runnerUp)
            .filter((value, index, arr) => arr.indexOf(value) === index),
          value => value
        )} (${seasonSummaries.filter(row => row.runnerUp === runnerUpLeaders[0].runnerUp).length})`
      : 'N/A',
    mostFairPlay: fairPlayLeaders.length
      ? `${joinLeaders(
          fairPlayLeaders
            .map(item => item.fairPlay)
            .filter((value, index, arr) => arr.indexOf(value) === index),
          value => value
        )} (${seasonSummaries.filter(row => row.fairPlay === fairPlayLeaders[0].fairPlay).length})`
      : 'N/A'
  };
}

function buildSeasonHistoryDescription(summary, currentPage, totalPages) {
  return (
    `${safeEmoji(E.archive || E.calendar, '🗃️')} **Season Archive Overview**\n` +
    `Historic SiuuVerse competition results, award winners and fair play records.\n\n` +
    `${safeEmoji(E.calendar, '📅')} **Archived Seasons:** ${summary.seasons}\n` +
    `${safeEmoji(E.calendar, '📅')} **Latest Season:** S${summary.latestSeason}\n` +
    `${safeEmoji(E.trophy || E.winner || E.leagueWinner, '🏆')} **Most Titles:** ${summary.mostTitles}\n` +
    `${safeEmoji(E.medal || E.runnerUp, '🥈')} **Most Runner-Ups:** ${summary.mostRunnerUps}\n` +
    `${safeEmoji(E.fairplay || E.fairPlay, '🕊️')} **Most Fair Play:** ${summary.mostFairPlay}\n` +
    `${safeEmoji(E.page || E.calendar, '📄')} **Page:** ${currentPage + 1}/${totalPages}`
  );
}

function createButtons(page, totalPages) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`seasonhistory_prev_${page}_all`)
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId('seasonhistory_refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`seasonhistory_next_${page}_all`)
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  ];
}

function buildSeasonField(row, columns) {
  const season = textAt(row, columns.season, 'N/A');
  const champion = textAt(row, columns.champion, 'N/A');
  const runnerUp = textAt(row, columns.runnerUp, 'N/A');
  const goldenBoot = textAt(row, columns.goldenBoot, 'N/A');
  const playmaker = textAt(row, columns.playmaker, 'N/A');
  const mvp = textAt(row, columns.mvp, 'N/A');
  const bestDefender = textAt(row, columns.bestDefender, 'N/A');
  const bestGk = textAt(row, columns.bestGk, 'N/A');
  const fairPlay = textAt(row, columns.fairPlay, 'N/A');
  const type = textAt(row, columns.type, 'Coop / League');

  return {
    name: `${safeEmoji(E.archive || E.calendar, '🗃️')} Season ${getSeasonLabel(season)}`,
    value:
      `${safeEmoji(E.coop || E.team, '🐉')} **${type}**\n\n` +
      `${safeEmoji(E.trophy || E.winner || E.leagueWinner, '🏆')} **Champion:** ${champion}\n` +
      `${safeEmoji(E.medal || E.runnerUp, '🥈')} **Runner Up:** ${runnerUp}\n\n` +
      `${safeEmoji(E.goldenBoot || E.goal, '👟')} **Golden Boot:** ${goldenBoot}\n` +
      `${safeEmoji(E.playmaker || E.assist, '🪄')} **Playmaker:** ${playmaker}\n` +
      `${safeEmoji(E.mvp, '👑')} **MVP:** ${mvp}\n` +
      `${safeEmoji(E.bestDefender || E.defense, '🛡️')} **Best Defender:** ${bestDefender}\n` +
      `${safeEmoji(E.goalkeeper || E.save, '🧤')} **Best GK Team:** ${bestGk}\n\n` +
      `${safeEmoji(E.fairplay || E.fairPlay, '🕊️')} **Fair Play:** ${fairPlay}`,
    inline: false
  };
}

async function buildPage(page = 0) {
  const data = await cachedGetData('Season_Archive!A:Z');
  const headers = Array.isArray(data?.[0]) ? data[0] : [];
  const rows = cleanRows(data);
  const headerMap = buildHeaderMap(headers);

  const columns = {
    season: findColumn(headerMap, ['Season', 'Season No', 'Season Number'], 0),
    champion: findColumn(headerMap, ['Champion', 'Winner', 'League Winner'], 1),
    runnerUp: findColumn(headerMap, ['Runner Up', 'Runner-Up', 'Runnerup'], 2),
    goldenBoot: findColumn(headerMap, ['Golden Boot', 'GoldenBoot', 'Top Scorer'], 3),
    playmaker: findColumn(headerMap, ['Playmaker', 'Top Assist', 'Top Assister'], 4),
    mvp: findColumn(headerMap, ['MVP', 'Best Player'], 5),
    bestDefender: findColumn(headerMap, ['Best Defender', 'Defender'], 6),
    bestGk: findColumn(headerMap, ['Best GK', 'Best Goalkeeper', 'Goalkeeper', 'Best GK Team'], 7),
    fairPlay: findColumn(headerMap, ['Fair Play', 'Fairplay'], 8),
    type: findColumn(headerMap, ['Type', 'Competition', 'Competition Type'], 10)
  };

  const summary = buildSeasonArchiveSummary(rows, columns);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const currentRows = rows.slice(start, start + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.archive || E.calendar, '🗃️')} SIUUVERSE SEASON HISTORY`)
    .setDescription(buildSeasonHistoryDescription(summary, currentPage, totalPages))
    .setColor(0x5865F2)
    .setFooter({ text: `Season History • Archived competition results • Page ${currentPage + 1}/${totalPages}` })
    .setTimestamp();

  if (currentRows.length) {
    embed.addFields(
      {
        name: `${safeEmoji(E.coop || E.team, '🐉')} Season Archive`,
        value: 'Archived season details for the current page are shown below.',
        inline: false
      },
      ...currentRows.map(row => buildSeasonField(row, columns))
    );
  } else {
    embed.addFields({
      name: `${safeEmoji(E.wrong, '❌')} No archive found`,
      value: 'No archived league seasons found yet.',
      inline: false
    });
  }

  return {
    embeds: [embed],
    components: createButtons(currentPage, totalPages)
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seasonhistory')
    .setDescription('View archived season history'),

  async execute(interaction) {
    return buildPage(0);
  },

  async buttonHandler(interaction, action, page) {
    let nextPage = Number(page) || 0;

    if (action === 'prev') nextPage--;
    if (action === 'next') nextPage++;
    if (action === 'refresh') nextPage = Number(page) || 0;

    return buildPage(nextPage);
  }
};
