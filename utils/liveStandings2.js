const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'liveStandings2.json');

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

function saveLiveStandings2Config(guildId, { channelId, messageId }) {
  const store = readStore();
  store[guildId] = { guildId, channelId, messageId };
  writeStore(store);
}

function getLiveStandings2Config(guildId) {
  const store = readStore();
  return store[guildId] || null;
}

async function buildLiveStandings2Image() {
  try {
    const standings2 = require('../commands/standings2');

    if (typeof standings2.buildLiveStandings2Image === 'function') {
      return await standings2.buildLiveStandings2Image();
    }

    throw new Error(
      'buildLiveStandings2Image() not found. Export buildLiveStandings2Image from commands/standings2.js.'
    );
  } catch (err) {
    throw new Error(`Failed to build standings image: ${err.message}`);
  }
}

async function refreshLiveStandings2(client, guildId) {
  const config = getLiveStandings2Config(guildId);
  if (!config) return { ok: false, reason: 'No config' };
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return { ok: false, reason: 'Guild not found' };
    const channel = await guild.channels.fetch(config.channelId);
    if (!channel) return { ok: false, reason: 'Channel not found' };
    const message = await channel.messages.fetch(config.messageId);
    if (!message) return { ok: false, reason: 'Message not found' };
    const imageBuffer = await buildLiveStandings2Image();
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'standings2.png' });
    await message.edit({
      content: null,
      embeds: [],
      files: [attachment]
    });
    return { ok: true };
  } catch (e) {
    // silent fail
    return { ok: false, reason: e.message || String(e) };
  }
}

function startLiveStandings2Updater(client, guildId) {
  if (!client.liveStandings2Intervals) client.liveStandings2Intervals = {};
  if (client.liveStandings2Intervals[guildId]) {
    clearInterval(client.liveStandings2Intervals[guildId]);
  }
  refreshLiveStandings2(client, guildId).catch(() => null);
  client.liveStandings2Intervals[guildId] = setInterval(async () => {
    await refreshLiveStandings2(client, guildId);
  }, 60 * 1000);
}

module.exports = {
  saveLiveStandings2Config,
  getLiveStandings2Config,
  buildLiveStandings2Image,
  refreshLiveStandings2,
  startLiveStandings2Updater
};