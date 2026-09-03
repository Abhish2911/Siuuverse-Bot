const mongoose = require('mongoose');

const penaltyRoyaleProfileSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    default: 'Unknown player'
  },
  games: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  goals: { type: Number, default: 0 },
  shots: { type: Number, default: 0 },
  misses: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  predictions: { type: Number, default: 0 },
  correctPredictions: { type: Number, default: 0 },
  predictionPoints: { type: Number, default: 0 },
  lifeLosses: { type: Number, default: 0 },
  shieldsEarned: { type: Number, default: 0 },
  abilitiesUsed: { type: Number, default: 0 },
  currentWinStreak: { type: Number, default: 0 },
  bestWinStreak: { type: Number, default: 0 },
  bestGoalStreak: { type: Number, default: 0 },
  bestSaveStreak: { type: Number, default: 0 },
  bestPredictionStreak: { type: Number, default: 0 },
  lastPlayedAt: { type: Date, default: null }
}, {
  timestamps: true
});

penaltyRoyaleProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PenaltyRoyaleProfile', penaltyRoyaleProfileSchema);
