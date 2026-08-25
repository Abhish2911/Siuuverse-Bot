const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const HFLiveMessage = require('../models/HFLiveMessage');
const TournamentStats = require('../models/TournamentStats');
const E = require('./emojis');
const { buildHFStandingsImage } = require('./hfStandingsImage');
const { calculatePerformanceRating, getPlayedMatchdayCount } = require('./hfStatsRating');
const {
  findPlayerByUserId,
  getTeamRecord,
  loadHandFootballData,
  sameTeam,
  toNumber,
  truncateField
} = require('./handfootball');

const LIVE_TYPES = new Set(['stats', 'standings']);

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function normalizeLiveType(type) {
  const value = String(type || '').trim().toLowerCase();
  return LIVE_TYPES.has(value) ? value : '';
}

function parseHexColor(value, fallback = 0xF1C40F) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color)
    ? Number.parseInt(color.slice(1), 16)
    : fallback;
}

function getAllTeamNames(data) {
  const namesByKey = new Map();
  for (const name of [
    ...data.teams.map(team => team.team),
    ...data.players.map(player => player.team),
    ...data.fixtures.flatMap(fixture => [fixture.home, fixture.away])
  ].filter(Boolean)) {
    const key = String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && !namesByKey.has(key)) namesByKey.set(key, name);
  }
  return [...namesByKey.values()];
}

function getTeamMeta(data, teamName) {
  return data.teams.find(team => sameTeam(team.team, teamName)) || {
    team: teamName,
    color: ''
  };
}

function pad(value, size) {
  return String(value ?? '').slice(0, size).padEnd(size, ' ');
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function topList(rows, label, valueGetter) {
  const rankedRows = rows
    .map(row => ({
      ...row,
      value: valueGetter(row.stats)
    }))
    .filter(row => row.value > 0)
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 5);

  const nameWidth = Math.max(...rankedRows.map(row => String(row.name).length), 1);
  const valueWidth = Math.max(...rankedRows.map(row => String(row.value).length), 1);
  const list = rankedRows
    .map((row, index) => {
      const rank = `${index + 1}.`;
      const name = String(row.name).padEnd(nameWidth, ' ');
      const value = String(row.value).padStart(valueWidth, ' ');
      return `\`${rank} ${name}  ${value}\``;
    })
    .join('\n');

  return list || `No ${label} yet.`;
}

function getStatsRows(data, statsDocs) {
  return statsDocs.map(stats => {
    const player = findPlayerByUserId(data.players, stats.userId);

    return {
      stats,
      name: player?.player || stats.userId,
      team: player?.team || 'No Team'
    };
  });
}

async function buildHFStatsEmbed() {
  const [data, statsDocs] = await Promise.all([
    loadHandFootballData(),
    TournamentStats.find({}).lean()
  ]);
  const rows = getStatsRows(data, statsDocs);
  const expectedMatches = getPlayedMatchdayCount(data.fixtures);
  const totalMatches = statsDocs.reduce((sum, stats) => sum + toNumber(stats.matches), 0);
  const totalGoals = statsDocs.reduce((sum, stats) => sum + toNumber(stats.goals), 0);

  return new EmbedBuilder()
    .setTitle(`${safeEmoji(E.Stats || E.stats, 'Stats')} HandFootball Live Stats`)
    .setDescription(
      [
        `Players tracked: **${statsDocs.length}**`,
        `Player match entries: **${totalMatches}**`,
        `Total goals: **${totalGoals}**`
      ].join('\n')
    )
    .addFields(
      { name: `${safeEmoji(E.goldenBoot, 'Goals')} Top Goals`, value: topList(rows, 'goals', stats => toNumber(stats.goals)), inline: true },
      { name: `${safeEmoji(E.assist, 'Assists')} Top Assists`, value: topList(rows, 'assists', stats => toNumber(stats.assists)), inline: true },
      { name: `${safeEmoji(E.fire, 'G+A')} G+A`, value: topList(rows, 'G+A', stats => toNumber(stats.goals) + toNumber(stats.assists)), inline: true },
      { name: `${safeEmoji(E.mvp, 'MVP')} MVPs`, value: topList(rows, 'MVPs', stats => toNumber(stats.mvps)), inline: true },
      { name: `${safeEmoji(E.trophy, '🎩')} Hattricks`, value: topList(rows, 'hattricks', stats => toNumber(stats.hattricks)), inline: true },
      { name: '⭐ Rating', value: topList(rows, 'ratings', stats => calculatePerformanceRating(stats, { expectedMatches })), inline: true },
      { name: `${safeEmoji(E.save, 'Saves')} Saves`, value: topList(rows, 'saves', stats => toNumber(stats.saves)), inline: true },
      { name: `${safeEmoji(E.tackle, 'Tackles')} Tackles`, value: topList(rows, 'tackles', stats => toNumber(stats.tackles)), inline: true },
      { name: `${safeEmoji(E.interception, 'Interceptions')} Interceptions`, value: topList(rows, 'interceptions', stats => toNumber(stats.interceptions)), inline: true }
    )
    .setColor(0xF1C40F)
    .setFooter({ text: 'HandFootball Stats - Auto Updating' })
    .setTimestamp();
}

async function buildHFStandingsEmbed() {
  const data = await loadHandFootballData();
  const standings = getAllTeamNames(data)
    .map(teamName => {
      const record = getTeamRecord(data.fixtures, teamName);
      const goalDifference = record.goalsFor - record.goalsAgainst;

      return {
        teamName,
        record,
        goalDifference,
        meta: getTeamMeta(data, teamName)
      };
    })
    .sort((left, right) => {
      if (right.record.points !== left.record.points) return right.record.points - left.record.points;
      if (right.goalDifference !== left.goalDifference) return right.goalDifference - left.goalDifference;
      if (right.record.goalsFor !== left.record.goalsFor) return right.record.goalsFor - left.record.goalsFor;
      return left.teamName.localeCompare(right.teamName);
    });

  const visibleStandings = standings.slice(0, 30);
  const table = visibleStandings.map((row, index) => {
    return [
      String(index + 1).padStart(2, ' '),
      pad(row.teamName, 18),
      String(row.record.played).padStart(2, ' '),
      String(row.record.wins).padStart(2, ' '),
      String(row.record.draws).padStart(2, ' '),
      String(row.record.losses).padStart(2, ' '),
      String(row.record.goalsFor).padStart(2, ' '),
      String(row.record.goalsAgainst).padStart(2, ' '),
      signed(row.goalDifference).padStart(3, ' '),
      String(row.record.points).padStart(3, ' ')
    ].join(' ');
  }).join('\n');
  const moreText = standings.length > visibleStandings.length
    ? `\n...and ${standings.length - visibleStandings.length} more teams`
    : '';

  const leader = standings[0];
  const color = leader ? parseHexColor(leader.meta.color, 0xF1C40F) : 0xF1C40F;

  return new EmbedBuilder()
    .setTitle(`${safeEmoji(E.trophy_animated || E.trophy, 'Trophy')} HandFootball Live Standings`)
    .setDescription(
      `\`\`\`text\n # Team               P  W  D  L GF GA  GD Pts\n${table || 'No teams found.'}${moreText}\n\`\`\``
    )
    .addFields(
      {
        name: 'Summary',
        value: [
          `Teams: **${standings.length}**`,
          `Fixtures: **${data.fixtures.length}**`,
          `Played: **${data.fixtures.filter(fixture => fixture.played).length}**`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Leader',
        value: leader ? `**${leader.teamName}** - ${leader.record.points} pts` : 'N/A',
        inline: true
      }
    )
    .setColor(color)
    .setFooter({ text: 'HandFootball Standings - Auto Updating' })
    .setTimestamp();
}

async function buildHFStandingsPayload(edit = false) {
  const buffer = await buildHFStandingsImage();
  const attachment = new AttachmentBuilder(buffer, { name: 'hf-live-standings.png' });
  const leagueName = process.env.HF_LEAGUE_NAME || 'HandFootball League';
  const unix = Math.floor(Date.now() / 1000);
  const payload = {
    content: `**${leagueName} — HF LIVE STANDINGS**\nUpdated: <t:${unix}:R>`,
    embeds: [],
    files: [attachment]
  };

  if (edit) payload.attachments = [];
  return payload;
}

async function buildHFLivePayload(type, { edit = false } = {}) {
  const liveType = normalizeLiveType(type);

  if (liveType === 'stats') {
    const payload = {
      content: null,
      embeds: [await buildHFStatsEmbed()],
      files: []
    };

    if (edit) payload.attachments = [];
    return payload;
  }

  if (liveType === 'standings') {
    return buildHFStandingsPayload(edit);
  }

  throw new Error(`Unknown HF live type: ${type}`);
}

async function buildHFLiveEmbed(type) {
  const liveType = normalizeLiveType(type);

  if (liveType === 'stats') return buildHFStatsEmbed();
  if (liveType === 'standings') return buildHFStandingsEmbed();

  throw new Error(`Unknown HF live type: ${type}`);
}

async function fetchSavedMessage(client, liveConfig) {
  const channel = await client.channels.fetch(liveConfig.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  return channel.messages.fetch(liveConfig.messageId).catch(() => null);
}

async function createHFLiveMessage({ client, guildId, channel, type, createdBy }) {
  const liveType = normalizeLiveType(type);
  if (!liveType) throw new Error('Invalid HF live message type');

  const payload = await buildHFLivePayload(liveType);
  const sent = await channel.send(payload);

  await HFLiveMessage.findOneAndUpdate(
    { guildId, type: liveType },
    {
      guildId,
      type: liveType,
      channelId: channel.id,
      messageId: sent.id,
      createdBy,
      updatedAt: new Date()
    },
    {
      upsert: true,
      returnDocument: 'after'
    }
  );

  await startHFLiveUpdater(client);
  return sent;
}

async function refreshHFLiveMessage(client, guildId, type) {
  const liveType = normalizeLiveType(type);
  if (!liveType) return { ok: false, reason: 'Invalid live message type' };

  const liveConfig = await HFLiveMessage.findOne({ guildId, type: liveType }).lean();
  if (!liveConfig) return { ok: false, reason: `No saved HF ${liveType} message` };

  const message = await fetchSavedMessage(client, liveConfig);
  if (!message) return { ok: false, reason: 'Saved message could not be fetched' };

  const payload = await buildHFLivePayload(liveType, { edit: true });
  await message.edit(payload);
  await HFLiveMessage.updateOne(
    { guildId, type: liveType },
    { updatedAt: new Date() }
  );

  return { ok: true, reason: `HF ${liveType} message refreshed` };
}

async function refreshAllHFLiveMessages(client, type = '') {
  const query = normalizeLiveType(type) ? { type: normalizeLiveType(type) } : {};
  const configs = await HFLiveMessage.find(query).lean();
  const results = [];

  for (const config of configs) {
    results.push(await refreshHFLiveMessage(client, config.guildId, config.type).catch(error => ({
      ok: false,
      reason: error.message
    })));
  }

  return results;
}

async function startHFLiveUpdater(client) {
  if (!client || global.hfLiveInterval) return false;

  const intervalMs = Number(process.env.HF_LIVE_REFRESH_MS || 180000);
  global.hfLiveInterval = setInterval(async () => {
    try {
      await refreshAllHFLiveMessages(client);
    } catch (error) {
      console.error('HF live auto refresh failed:', error);
    }
  }, Math.max(30000, intervalMs));

  return true;
}

module.exports = {
  buildHFStatsEmbed,
  buildHFStandingsEmbed,
  buildHFLiveEmbed,
  buildHFLivePayload,
  createHFLiveMessage,
  refreshHFLiveMessage,
  refreshAllHFLiveMessages,
  startHFLiveUpdater
};
