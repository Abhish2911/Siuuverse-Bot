const mongoose = require('mongoose');

const guildModuleSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  coopEnabled: { type: Boolean, default: true },
  hfEnabled: { type: Boolean, default: true },
  sclEnabled: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.models.GuildModuleSettings
  || mongoose.model('GuildModuleSettings', guildModuleSettingsSchema);
