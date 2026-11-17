const mongoose = require('mongoose');

const moderationActionSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  action: {
    type: String,
    enum: ['lock', 'unlock', 'timeout', 'untimeout', 'warn', 'purge', 'slowmode'],
    required: true
  },
  moderatorId: { type: String, required: true },
  targetId: { type: String, default: '' },
  channelId: { type: String, default: '' },
  reason: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

moderationActionSchema.index({ guildId: 1, createdAt: -1 });
moderationActionSchema.index({ guildId: 1, targetId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.models.ModerationAction
  || mongoose.model('ModerationAction', moderationActionSchema);
