const mongoose = require('mongoose');

const hfTournamentAccessSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  level: { type: String, enum: ['admin', 'mod'], required: true },
  permissions: {
    createTournament: { type: Boolean, default: false },
    manageRegistration: { type: Boolean, default: true },
    manageStats: { type: Boolean, default: true },
    lockUnlock: { type: Boolean, default: false },
    manageAwards: { type: Boolean, default: false }
  },
  grantedBy: { type: String, required: true }
}, { timestamps: true });

hfTournamentAccessSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.HFTournamentAccess
  || mongoose.model('HFTournamentAccess', hfTournamentAccessSchema);