const mongoose = require('mongoose');

const hfTournamentAwardSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  tournamentId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['trophy', 'award'], required: true },
  value: { type: String, default: '' },
  grantedBy: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.models.HFTournamentAward
  || mongoose.model('HFTournamentAward', hfTournamentAwardSchema);