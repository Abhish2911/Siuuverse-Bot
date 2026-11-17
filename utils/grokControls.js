const mongoose = require('mongoose');
const GrokGuildSettings = require('../models/GrokGuildSettings');

function isMongoReady() {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('Grok controls require an active MongoDB connection');
    error.code = 'GROK_CONTROLS_UNAVAILABLE';
    throw error;
  }
}

async function getGrokSettings(guildId) {
  isMongoReady();
  const settings = await GrokGuildSettings.findOne({ guildId }).lean();
  return {
    enabled: settings?.enabled ?? true,
    channelMode: settings?.channelMode ?? 'all',
    allowedChannelIds: settings?.allowedChannelIds ?? []
  };
}

async function authorizeGrokRequest(guildId, channelId) {
  try {
    const settings = await getGrokSettings(guildId);
    if (!settings.enabled) {
      return { allowed: false, message: 'Grok is disabled in this server.' };
    }
    if (
      settings.channelMode === 'selected' &&
      !settings.allowedChannelIds.includes(channelId)
    ) {
      return {
        allowed: false,
        message: 'Grok is only available in the channels configured by a server admin.'
      };
    }

    return { allowed: true };
  } catch (error) {
    if (error.code === 'GROK_CONTROLS_UNAVAILABLE') throw error;
    const wrappedError = new Error('Could not verify Grok server settings', { cause: error });
    wrappedError.code = 'GROK_CONTROLS_UNAVAILABLE';
    throw wrappedError;
  }
}

module.exports = {
  authorizeGrokRequest,
  getGrokSettings,
  isMongoReady
};
