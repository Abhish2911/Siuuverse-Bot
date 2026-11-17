const mongoose = require('mongoose');
const GuildPrefix = require('../models/GuildPrefix');

const DEFAULT_PREFIX = '.';
const prefixCache = new Map();

async function getGuildPrefix(guildId) {
  if (!guildId || mongoose.connection.readyState !== 1) return DEFAULT_PREFIX;
  if (prefixCache.has(guildId)) return prefixCache.get(guildId);

  const settings = await GuildPrefix.findOne({ guildId }).lean().catch(() => null);
  const prefix = settings?.prefix || DEFAULT_PREFIX;
  prefixCache.set(guildId, prefix);
  return prefix;
}

async function setGuildPrefix(guildId, prefix) {
  const normalized = prefix || DEFAULT_PREFIX;
  await GuildPrefix.findOneAndUpdate(
    { guildId },
    { $set: { guildId, prefix: normalized } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  prefixCache.set(guildId, normalized);
  return normalized;
}

function clearGuildPrefixCache(guildId) {
  if (guildId) prefixCache.delete(guildId);
  else prefixCache.clear();
}

module.exports = {
  DEFAULT_PREFIX,
  getGuildPrefix,
  setGuildPrefix,
  clearGuildPrefixCache
};
