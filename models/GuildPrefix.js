const mongoose = require('mongoose');

const guildPrefixSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, required: true, default: '.' }
}, { timestamps: true });

module.exports = mongoose.models.GuildPrefix
  || mongoose.model('GuildPrefix', guildPrefixSchema);
