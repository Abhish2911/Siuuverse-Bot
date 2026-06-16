const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const E = require('./emojis');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'liveStandings2.json');

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();

  if (
    value === 'uclstandings2' ||
    value === 'uclstandings' ||
    value === 'ucl'
  ) {
    return 'uclstandings2';
  }

  return 'standings2';
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify({}));
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function saveLiveStandings2Config(guildId, { channelId, messageId }, type = 'standings2') {
  const normalizedType = normalizeType(type);
  const store = readStore();

  if (!store[guildId]) {
    store[guildId] = { types: {} };
  }

  if (!store[guildId].types) {
    store[guildId].types = {};
  }

  store[guildId].types[normalizedType] = {
    guildId,
    channelId,
    messageId,
    type: normalizedType
  };

  writeStore(store);
}

function getLiveStandings2Config(guildId, type = 'standings2') {
  const normalizedType = normalizeType(type);
  const store = readStore();

  const entry = store[guildId];
  if (!entry) return null;

  if (entry.types) {
    console.log('[LiveStandings2] Config lookup:', guildId, normalizedType, Object.keys(entry.types || {}));
    return entry.types[normalizedType] || null;
  }

  return normalizedType === 'standings2' ? entry : null;
}

async function buildLiveStandings2Image(type = 'standings2') {
  try {
    const normalizedType = normalizeType(type);
    console.log('[LiveStandings2] Building image:', normalizedType);

    const modulePath = normalizedType === 'uclstandings2'
      ? '../commands/uclstandings2'
      : '../commands/standings2';

    const imageModule = require(modulePath);

    if (typeof imageModule.buildLiveStandings2Image === 'function') {
      return await imageModule.buildLiveStandings2Image();
    }

    if (typeof imageModule.generateImage === 'function') {
      return await imageModule.generateImage();
    }

    throw new Error(`No image generator found in ${modulePath}`);
  } catch (err) {
    throw new Error(`Failed to build standings image: ${err.message}`);
  }
}

async function refreshLiveStandings2(client, guildId, type = 'standings2') {
  const normalizedType = normalizeType(type);
  console.log('[LiveStandings2] Refreshing:', normalizedType);
  const config = getLiveStandings2Config(guildId, normalizedType);
  if (!config) return { ok: false, reason: 'No config' };
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return { ok: false, reason: 'Guild not found' };
    const channel = await guild.channels.fetch(config.channelId);
    if (!channel) return { ok: false, reason: 'Channel not found' };
    const message = await channel.messages.fetch(config.messageId);
    if (!message) return { ok: false, reason: 'Message not found' };
    const imageBuffer = await buildLiveStandings2Image(normalizedType);
    const attachment = new AttachmentBuilder(imageBuffer, {
      name: `${normalizedType}.png`
    });
    const unix = Math.floor(Date.now() / 1000);

    await message.edit({
      content:
        normalizedType === 'uclstandings2'
          ? `${E.UCL || '🏆'} **Siuuverse ePremierLeague S2 — UCL LIVE STANDINGS**\n• Updated: <t:${unix}:R>`
          : `${E.PL || '🏆'} **Siuuverse ePremierLeague S2 — League LIVE STANDINGS**\n• Updated: <t:${unix}:R>`,
      embeds: [],
      files: [attachment]
    });
    return { ok: true };
  } catch (e) {
    // silent fail
    return { ok: false, reason: e.message || String(e) };
  }
}

function startLiveStandings2Updater(client, guildId, type = 'standings2') {
  const normalizedType = normalizeType(type);

  console.log('[LiveStandings2] Starting updater:', guildId, normalizedType);

  refreshLiveStandings2(client, guildId, normalizedType)
    .then(result => {
      console.log('[LiveStandings2] Refresh result:', normalizedType, result);
    })
    .catch(error => {
      console.error('[LiveStandings2] Refresh failed:', normalizedType, error);
    });
}

module.exports = {
  saveLiveStandings2Config,
  getLiveStandings2Config,
  buildLiveStandings2Image,
  refreshLiveStandings2,
  startLiveStandings2Updater
};
