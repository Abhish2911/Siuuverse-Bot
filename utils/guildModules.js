const mongoose = require('mongoose');
const GuildModuleSettings = require('../models/GuildModuleSettings');

const MODULE_FIELDS = {
  coop: 'coopEnabled',
  hf: 'hfEnabled',
  scl: 'sclEnabled'
};

function fieldForModule(moduleName) {
  const field = MODULE_FIELDS[String(moduleName || '').toLowerCase()];
  if (!field) throw new Error(`Unknown bot module: ${moduleName}`);
  return field;
}

function ensureMongoConnected() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB is not connected; bot module settings are unavailable.');
  }
}

async function getGuildModuleSettings(guildId) {
  if (!guildId) throw new Error('A guild ID is required to read module settings.');
  ensureMongoConnected();
  const settings = await GuildModuleSettings.findOne({ guildId }).lean();
  return Object.fromEntries(
    Object.entries(MODULE_FIELDS).map(([moduleName, field]) => [
      moduleName,
      settings?.[field] !== false
    ])
  );
}

async function isGuildModuleEnabled(guildId, moduleName) {
  fieldForModule(moduleName);
  const settings = await getGuildModuleSettings(guildId);
  return settings[moduleName.toLowerCase()];
}

async function setGuildModuleEnabled(guildId, moduleName, enabled) {
  if (!guildId) throw new Error('A guild ID is required to update module settings.');
  const field = fieldForModule(moduleName);
  ensureMongoConnected();
  await GuildModuleSettings.findOneAndUpdate(
    { guildId },
    { $set: { [field]: Boolean(enabled) }, $setOnInsert: { guildId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function setAllGuildModulesEnabled(guildId, enabled) {
  if (!guildId) throw new Error('A guild ID is required to update module settings.');
  ensureMongoConnected();
  const value = Boolean(enabled);
  await GuildModuleSettings.findOneAndUpdate(
    { guildId },
    {
      $set: {
        coopEnabled: value,
        hfEnabled: value,
        sclEnabled: value
      },
      $setOnInsert: { guildId }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

module.exports = {
  getGuildModuleSettings,
  isGuildModuleEnabled,
  setAllGuildModulesEnabled,
  setGuildModuleEnabled
};
