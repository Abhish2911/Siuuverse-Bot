const mongoose = require('mongoose');

const hfStatsSummarySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  sourceMessageId: { type: String, required: true },
  dmMessages: [{
    userId: { type: String, required: true },
    messageId: { type: String, required: true }
  }]
}, { timestamps: true });

hfStatsSummarySchema.index({ guildId: 1, sourceMessageId: 1 }, { unique: true });

module.exports = mongoose.models.HFStatsSummary
  || mongoose.model('HFStatsSummary', hfStatsSummarySchema);
