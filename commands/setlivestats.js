const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'liveStats.json');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...config, type: 'league' }, null, 2));
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ live stats config read error:', error);
    return null;
  }
}

async function finishInteraction(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return null;
  }

  await interaction.reply(payload);
  return null;
}

function buildLiveStatsSetupSummary(channel, message = null) {
  return {
    channel: channel ? `<#${channel.id}>` : 'N/A',
    messageId: message?.id || 'Pending',
    type: 'League Stats',
    status: message ? 'Live stats updater active' : 'Ready to create/update live stats'
  };
}

function buildLiveStatsSetupDescription(summary, isCreated = false) {
  if (isCreated) {
    return (
      `📊 **Live Stats Configured**\n` +
      `The bot will keep one live stats message updated automatically in the selected channel.\n\n` +
      `📢 **Channel:** ${summary.channel}\n` +
      `🏷️ **Type:** ${summary.type}\n` +
      `🆔 **Message ID:** ${summary.messageId}\n` +
      `✅ **Status:** ${summary.status}`
    );
  }

  return (
    `📊 **Live Stats Setup**\n` +
    `Creates or replaces the live stats message and keeps it refreshed automatically.\n\n` +
    `📢 **Channel:** ${summary.channel}\n` +
    `🏷️ **Type:** ${summary.type}\n` +
    `📌 **Status:** ${summary.status}`
  );
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(2).filter(row => row[1] && Number(row[2] || 0) > 0)
    : [];
}

function getRankingSectionRows(rankingRows, startIndex) {
  if (!Array.isArray(rankingRows)) return [];

  return rankingRows.map(row => [
    row[startIndex] || '',
    row[startIndex + 1] || '',
    row[startIndex + 2] || ''
  ]);
}

function top5RankingRows(rows, icon = '') {
  const list = cleanRows(rows)
    .slice(0, 5)
    .map((row, i) => `${i + 1}. **${row[1]}** - **${row[2]}**`)
    .join('\n');

  return list || `${safeEmoji(E.missing, '➖')} No data yet.`;
}

async function buildLiveStatsEmbed() {
  const [ranking, matches] = await Promise.all([
    cachedGetData('Ranking!A:AA'),
    cachedGetData('Matches!A:Z').catch(() => [])
  ]);

  const goals = getRankingSectionRows(ranking, 0);
  const assists = getRankingSectionRows(ranking, 3);
  const yellow = getRankingSectionRows(ranking, 6);
  const red = getRankingSectionRows(ranking, 9);
  const mvp = getRankingSectionRows(ranking, 12);
  const ga = getRankingSectionRows(ranking, 15);
  const tackles = getRankingSectionRows(ranking, 18);
  const interceptions = getRankingSectionRows(ranking, 21);
  const saves = getRankingSectionRows(ranking, 24);

  const matchesRecorded = Array.isArray(matches)
    ? matches.slice(1).filter(row => {
        const status = String(row?.[9] ?? '').trim().toLowerCase();

        return status && !['pending', 'upcoming', 'scheduled', 'not played'].includes(status);
      }).length
    : 0;
  const totalGoals = cleanRows(goals).reduce((sum, row) => sum + Number(row[2] || 0), 0);
  const totalCards =
    cleanRows(yellow).reduce((sum, row) => sum + Number(row[2] || 0), 0) +
    cleanRows(red).reduce((sum, row) => sum + Number(row[2] || 0), 0);

  return new EmbedBuilder()
    .setTitle(`${safeEmoji(E.fire, '🔥')} Stats Leaders`)
    .setDescription(
      `${safeEmoji(E.calendar, '📅')} **League Stats Hub**\n` +
      `${safeEmoji(E.played, '🎮')} Matches Recorded: **${matchesRecorded}**\n` +
      `${safeEmoji(E.goal, '⚽')} Total Goals: **${totalGoals}**\n` +
      `${safeEmoji(E.fairplay, '🕊️')} Total Cards: **${totalCards}**`
    )
    .addFields(
      { name: `${safeEmoji(E.goldenBoot, '👟')} Top Scorers`, value: top5RankingRows(goals, '⚽'), inline: true },
      { name: `${safeEmoji(E.playmaker, '🎯')} Top Assisters`, value: top5RankingRows(assists, '🎯'), inline: true },
      { name: `${safeEmoji(E.fire, '🔥')} G/A Leaders`, value: top5RankingRows(ga, '🔥'), inline: true },
      { name: `${safeEmoji(E.mvp, '⭐')} MVP Leaders`, value: top5RankingRows(mvp, '⭐'), inline: true },
      { name: `${safeEmoji(E.tackle, '🛡️')} Top Tackles`, value: top5RankingRows(tackles, '🛡️'), inline: true },
      { name: `${safeEmoji(E.interception, '✂️')} Top Interceptions`, value: top5RankingRows(interceptions, '✂️'), inline: true },
      { name: `${safeEmoji(E.save, '🧤')} Top Saves`, value: top5RankingRows(saves, '🧤'), inline: true },
      { name: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`, value: top5RankingRows(yellow, '🟨'), inline: true },
      { name: `${safeEmoji(E.redCard, '🟥')} Red Cards`, value: top5RankingRows(red, '🟥'), inline: true }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'SiuuVerse League Stats • Live Auto Updating' })
    .setTimestamp();
}

async function updateLiveStatsMessage(message) {
  const embed = await buildLiveStatsEmbed();
  await message.edit({ embeds: [embed] });
}

async function startLiveStats(client, config) {
  if (!config?.channelId || !config?.messageId) return false;

  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  const message = await channel.messages.fetch(config.messageId).catch(() => null);
  if (!message) return false;

  if (global.liveStatsInterval) {
    clearInterval(global.liveStatsInterval);
  }

  global.liveStatsMessage = message;
  global.liveStatsInterval = setInterval(async () => {
    try {
      if (!global.liveStatsMessage) return;
      await updateLiveStatsMessage(global.liveStatsMessage);
    } catch (error) {
      console.error('❌ live stats auto-update error:', error);
    }
  }, Number(process.env.LIVE_STATS_REFRESH_MS || 180000));

  await updateLiveStatsMessage(message);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlivestats')
    .setDescription('Set auto-updating live stats in a channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where live stats will be posted')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!channel || !channel.isTextBased()) {
      return finishInteraction(interaction, { content: `${safeEmoji(E.wrong, '❌')} Please select a valid text channel.` });
    }

    const setupPreview = buildLiveStatsSetupSummary(channel);
    const embed = await buildLiveStatsEmbed();
    const message = await channel.send({ embeds: [embed] });
    const setupSummary = buildLiveStatsSetupSummary(channel, message);

    if (global.liveStatsInterval) {
      clearInterval(global.liveStatsInterval);
    }

    global.liveStatsMessage = message;
    saveConfig({
      channelId: channel.id,
      messageId: message.id,
      updatedAt: new Date().toISOString()
    });

    global.liveStatsInterval = setInterval(async () => {
      try {
        if (!global.liveStatsMessage) return;
        await updateLiveStatsMessage(global.liveStatsMessage);
      } catch (error) {
        console.error('❌ live stats auto-update error:', error);
      }
    }, Number(process.env.LIVE_STATS_REFRESH_MS || 180000));

    return finishInteraction(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ League Live Stats Set')
          .setDescription(buildLiveStatsSetupDescription(setupSummary, true))
          .addFields(
            { name: '📢 Channel', value: setupSummary.channel, inline: true },
            { name: '🏷️ Type', value: setupSummary.type, inline: true },
            { name: '🆔 Message ID', value: setupSummary.messageId, inline: true }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Live Stats Setup • Auto-refresh enabled' })
      ]
    });
  },

  async restore(client) {
    const config = readConfig();
    return config ? await startLiveStats(client, config) : false;
  },

  async refresh() {
    if (!global.liveStatsMessage) return false;
    await updateLiveStatsMessage(global.liveStatsMessage);
    return true;
  },

  buildLiveStatsEmbed,
  startLiveStats
};
