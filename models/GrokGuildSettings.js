const mongoose = require('mongoose');

const GrokGuildSettingsSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  channelMode: {
    type: String,
    enum: ['all', 'selected'],
    default: 'all'
  },
  allowedChannelIds: {
    type: [String],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.models.GrokGuildSettings
  || mongoose.model('GrokGuildSettings', GrokGuildSettingsSchema);
