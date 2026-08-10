const mongoose = require('mongoose');

const hfLiveMessageSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['stats', 'standings']
  },
  channelId: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    required: true
  },
  createdBy: {
    type: String,
    default: ''
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

hfLiveMessageSchema.index({ guildId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('HFLiveMessage', hfLiveMessageSchema);
