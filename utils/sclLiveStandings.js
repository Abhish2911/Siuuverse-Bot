const { AttachmentBuilder } = require('discord.js');
const { models } = require('../models/SclModels');
const { buildSclStandingsImage } = require('./sclStandings');

const LIVE_TYPES = new Set(['team', 'individual']);

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  return LIVE_TYPES.has(value) ? value : '';
}

async function buildLivePayload(guildId, type, modelSet, edit = false) {
  const image = await buildSclStandingsImage({ guildId, type, ...modelSet });
  const payload = {
    content: `**Siuuverse Champions League — Live ${type === 'team' ? 'Team' : 'Individual'} Standings**`,
    files: [new AttachmentBuilder(image, { name: `scl-live-${type}.png` })]
  };
  if (edit) payload.attachments = [];
  return payload;
}

async function fetchSavedMessage(client, config) {
  const channel = await client.channels.fetch(config.channelId).catch(error => {
    if (Number(error?.code) === 10003) return null;
    throw error;
  });
  if (!channel?.isTextBased() || !channel.messages?.fetch) return null;
  return channel.messages.fetch(config.messageId).catch(error => {
    if (Number(error?.code) === 10008) return null;
    throw error;
  });
}

async function createSclLiveMessage({ client, guildId, channel, type, createdBy, modelsSet }) {
  const liveType = normalizeType(type);
  if (!liveType) throw new Error(`Unknown SCL live standings type: ${type}`);

  const existing = await modelsSet.LiveMessage.findOne({ guildId, type: liveType }).lean();
  const payload = await buildLivePayload(
    guildId,
    liveType,
    modelsSet,
    existing?.channelId === channel.id
  );
  if (existing?.channelId === channel.id) {
    const savedMessage = await fetchSavedMessage(client, existing);
    if (savedMessage) {
      await savedMessage.edit(payload);
      await modelsSet.LiveMessage.updateOne(
        { guildId, type: liveType },
        { createdBy, updatedAt: new Date() }
      );
      await startSclLiveUpdater(client);
      return savedMessage;
    }
  }

  const sent = await channel.send(payload);
  try {
    await modelsSet.LiveMessage.findOneAndUpdate(
      { guildId, type: liveType },
      {
        guildId,
        type: liveType,
        channelId: channel.id,
        messageId: sent.id,
        createdBy,
        updatedAt: new Date()
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    try {
      await sent.delete();
    } catch (cleanupError) {
      console.error('SCL live standings setup could not remove its untracked message:', cleanupError);
    }
    throw error;
  }

  if (existing) {
    try {
      const oldMessage = await fetchSavedMessage(client, existing);
      if (oldMessage) {
        await oldMessage.delete();
      }
    } catch (error) {
      if (Number(error?.code) !== 10008) {
        console.error('SCL live standings setup could not remove the replaced message:', error);
      }
    }
  }

  await startSclLiveUpdater(client);
  return sent;
}

async function refreshSclLiveMessage(client, guildId, type, modelSet = null) {
  const liveType = normalizeType(type);
  if (!liveType) return { ok: false, reason: 'Invalid SCL live standings type' };

  const activeModels = modelSet || await models();
  const config = await activeModels.LiveMessage.findOne({ guildId, type: liveType }).lean();
  if (!config) return { ok: false, reason: `No saved SCL ${liveType} standings message` };

  const message = await fetchSavedMessage(client, config);
  if (!message) return { ok: false, reason: 'Saved SCL standings message could not be fetched' };

  await message.edit(await buildLivePayload(guildId, liveType, activeModels, true));
  await activeModels.LiveMessage.updateOne(
    { guildId, type: liveType },
    { updatedAt: new Date() }
  );
  return { ok: true, reason: `SCL ${liveType} standings refreshed` };
}

async function refreshAllSclLiveMessages(client) {
  const modelSet = await models();
  const configs = await modelSet.LiveMessage.find({}).lean();
  const results = [];

  for (const config of configs) {
    try {
      const result = await refreshSclLiveMessage(client, config.guildId, config.type, modelSet);
      if (!result.ok) {
        console.warn(`SCL ${config.type} live standings refresh skipped for guild ${config.guildId}: ${result.reason}`);
      }
      results.push(result);
    } catch (error) {
      console.error(`SCL ${config.type} live standings refresh failed for guild ${config.guildId}:`, error);
      results.push({ ok: false, reason: error.message });
    }
  }
  return results;
}

async function startSclLiveUpdater(client) {
  if (!client) throw new Error('A Discord client is required to start SCL live standings.');
  if (global.sclLiveInterval) return true;

  const { LiveMessage } = await models();
  const configs = await LiveMessage.find({}).select('guildId').lean();
  if (!configs.length) return false;

  const intervalMs = Math.max(30000, Number(process.env.SCL_LIVE_REFRESH_MS) || 180000);
  global.sclLiveInterval = setInterval(() => {
    refreshAllSclLiveMessages(client).catch(error => {
      console.error('SCL live standings auto-refresh failed:', error);
    });
  }, intervalMs);
  return true;
}

module.exports = {
  createSclLiveMessage,
  refreshSclLiveMessage,
  refreshAllSclLiveMessages,
  startSclLiveUpdater
};
