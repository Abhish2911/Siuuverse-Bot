const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { buildWeeklySummaryPayload } = require('./weeklysummary');
const { sendAuditLog } = require('../utils/helpers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'weekly_summary_live.json');

function isAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasAdminRole = interaction.member?.roles?.cache?.some(role =>
    adminRoleIds.includes(role.id)
  );

  return isOwner || hasAdminRole;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadWeeklySummaryConfig() {
  try {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveWeeklySummaryConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function buildSetupSummary(targetChannel, summary, sent = null) {
  return {
    channel: targetChannel ? `<#${targetChannel.id}>` : 'N/A',
    matchday: summary?.md ? `MD ${summary.md}` : 'N/A',
    messageId: sent?.id || 'Pending',
    status: sent ? 'Live updater active' : 'Ready to create/update live summary'
  };
}

function buildSetupDescription(summaryData, isCreated = false) {
  if (isCreated) {
    return (
      `📰 **Live Weekly Summary Configured**\n` +
      `The bot will keep one live weekly summary message updated automatically in the selected channel.\n\n` +
      `📢 **Channel:** ${summaryData.channel}\n` +
      `📅 **Current Summary:** ${summaryData.matchday}\n` +
      `🆔 **Message ID:** ${summaryData.messageId}\n` +
      `✅ **Status:** ${summaryData.status}`
    );
  }

  return (
    `📰 **Weekly Summary Setup**\n` +
    `Creates or replaces the live weekly summary message and keeps it refreshed automatically.\n\n` +
    `📢 **Channel:** ${summaryData.channel}\n` +
    `📅 **Current Summary:** ${summaryData.matchday}\n` +
    `📌 **Status:** ${summaryData.status}`
  );
}

async function upsertWeeklySummaryLiveMessage(client, guildId, forcedMd = null) {
  const config = loadWeeklySummaryConfig();
  const guildConfig = config[guildId];

  if (!guildConfig?.channelId || !guildConfig?.messageId) {
    return { ok: false, reason: 'Weekly summary live message not configured' };
  }

  const summary = await buildWeeklySummaryPayload(forcedMd);
  if (summary.error) {
    return { ok: false, reason: summary.error };
  }

  try {
    const channel = await client.channels.fetch(guildConfig.channelId);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return { ok: false, reason: 'Configured weekly summary channel is invalid' };
    }

    const message = await channel.messages.fetch(guildConfig.messageId);
    if (!message) {
      return { ok: false, reason: 'Configured weekly summary message was not found' };
    }

    await message.edit({
      content: `📢 **Latest Weekly Summary — Matchday ${summary.md}**`,
      embeds: [summary.embed],
      components: []
    });

    return { ok: true, md: summary.md, channelId: guildConfig.channelId, messageId: guildConfig.messageId };
  } catch {
    return { ok: false, reason: 'Failed to update weekly summary live message' };
  }
}

async function startWeeklySummaryUpdater(client, guildId) {
  const config = loadWeeklySummaryConfig();
  const guildConfig = config[guildId];

  if (!guildConfig?.channelId || !guildConfig?.messageId) return false;

  if (!global.weeklySummaryIntervals) {
    global.weeklySummaryIntervals = new Map();
  }

  const oldInterval = global.weeklySummaryIntervals.get(guildId);
  if (oldInterval) clearInterval(oldInterval);

  const result = await upsertWeeklySummaryLiveMessage(client, guildId);
  if (!result.ok) return false;

  const interval = setInterval(async () => {
    try {
      await upsertWeeklySummaryLiveMessage(client, guildId);
    } catch (error) {
      console.error('❌ Weekly summary auto-update error:', error);
    }
  }, 60 * 1000);

  global.weeklySummaryIntervals.set(guildId, interval);
  return true;
}

module.exports = {
  loadWeeklySummaryConfig,
  saveWeeklySummaryConfig,
  upsertWeeklySummaryLiveMessage,
  startWeeklySummaryUpdater,
  data: new SlashCommandBuilder()
    .setName('setweeklysummary')
    .setDescription('Create or replace the live weekly summary message in a channel')
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Channel where the live weekly summary should be posted')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.' };
    }

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const previewSummaryData = buildSetupSummary(targetChannel, { md: 'Latest' });

    const summary = await buildWeeklySummaryPayload();

    if (summary.error) {
      return { content: summary.error };
    }

    const sent = await targetChannel.send({
      content: `📢 **Latest Weekly Summary — Matchday ${summary.md}**`,
      embeds: [summary.embed],
      components: []
    });
    const finalSummaryData = buildSetupSummary(targetChannel, summary, sent);

    const config = loadWeeklySummaryConfig();
    config[interaction.guild.id] = {
      channelId: targetChannel.id,
      messageId: sent.id
    };
    saveWeeklySummaryConfig(config);

    try {
      await startWeeklySummaryUpdater(interaction.client, interaction.guild.id);
    } catch (error) {
      console.error('❌ Weekly summary updater start error:', error);
    }

    sendAuditLog(interaction, {
      title: '📰 Live Weekly Summary Set',
      description: `Live weekly summary message created in <#${targetChannel.id}>.`,
      color: 0x5865F2,
      fields: [
        { name: '📢 Channel', value: `<#${targetChannel.id}>`, inline: true },
        { name: '🆔 Message ID', value: sent.id, inline: true },
        { name: '📅 Current Matchday', value: summary.md, inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Live Weekly Summary Set')
          .setDescription(buildSetupDescription(finalSummaryData, true))
          .addFields(
            { name: '📢 Channel', value: finalSummaryData.channel, inline: true },
            { name: '📅 Current Summary', value: finalSummaryData.matchday, inline: true },
            { name: '🆔 Message ID', value: finalSummaryData.messageId, inline: true }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Weekly Summary Setup • Auto-refresh enabled' })
      ]
    };
  },

  async restore(client) {
    try {
      const guilds = client.guilds.cache.map(g => g.id);
      let restored = false;

      for (const guildId of guilds) {
        const config = loadWeeklySummaryConfig();
        const guildConfig = config[guildId];
        if (!guildConfig?.channelId || !guildConfig?.messageId) continue;

        const ok = await startWeeklySummaryUpdater(client, guildId);
        if (ok) restored = true;
      }

      return restored;
    } catch (error) {
      console.error('❌ Restore weekly summary error:', error);
      return false;
    }
  }
};
