const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  displayName: { type: String, required: true },
  team: { type: String, enum: ['A', 'B', ''], default: '' },
  lives: { type: Number, default: 3 },
  shields: { type: Number, default: 0 },
  goals: { type: Number, default: 0 },
  shots: { type: Number, default: 0 },
  misses: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  predictions: { type: Number, default: 0 },
  correctPredictions: { type: Number, default: 0 },
  predictionPoints: { type: Number, default: 0 },
  lifeLosses: { type: Number, default: 0 },
  shieldsEarned: { type: Number, default: 0 },
  goalStreak: { type: Number, default: 0 },
  bestGoalStreak: { type: Number, default: 0 },
  saveStreak: { type: Number, default: 0 },
  bestSaveStreak: { type: Number, default: 0 },
  predictionStreak: { type: Number, default: 0 },
  bestPredictionStreak: { type: Number, default: 0 },
  abilitiesUsed: { type: Number, default: 0 },
  abilities: {
    read: { type: Number, default: 0 },
    superSave: { type: Number, default: 0 },
    precision: { type: Number, default: 0 },
    fakeShot: { type: Number, default: 0 },
    rebound: { type: Number, default: 0 }
  },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const predictionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  // `missed` is recorded only when a host force-resolves a stalled round.
  choice: { type: String, enum: ['left', 'center', 'right', 'missed'], required: true }
}, { _id: false });

const roundHistorySchema = new mongoose.Schema({
  round: { type: Number, required: true },
  shooterId: { type: String, required: true },
  shooterName: { type: String, required: true },
  shooterTeam: { type: String, default: '' },
  goalkeeperId: { type: String, default: '' },
  shot: { type: String, enum: ['left', 'center', 'right'], required: true },
  saved: { type: Boolean, required: true },
  chaosMode: { type: String, default: '' },
  goalValue: { type: Number, default: 1 },
  suddenDeath: { type: Boolean, default: false },
  correctPredictorIds: { type: [String], default: [] },
  lifeLost: { type: Boolean, default: false },
  shieldUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const penaltyRoyaleGameSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: '' },
  hostId: { type: String, required: true },
  mode: { type: String, enum: ['royale', 'teams'], default: 'royale' },
  status: { type: String, enum: ['lobby', 'shooting', 'predicting', 'finished', 'cancelled'], default: 'lobby' },
  phase: { type: String, enum: ['lobby', 'shooting', 'predicting', 'finished'], default: 'lobby' },
  maxPlayers: { type: Number, default: 8 },
  players: { type: [playerSchema], default: [] },
  round: { type: Number, default: 0 },
  shooterId: { type: String, default: '' },
  goalkeeperId: { type: String, default: '' },
  lastShooterId: { type: String, default: '' },
  lastGoalkeeperId: { type: String, default: '' },
  lastGoalkeeperByTeam: {
    a: { type: String, default: '' },
    b: { type: String, default: '' }
  },
  shot: { type: String, enum: ['', 'left', 'center', 'right'], default: '' },
  predictions: { type: [predictionSchema], default: [] },
  precisionActive: { type: Boolean, default: false },
  fakeShotActive: { type: Boolean, default: false },
  fakeShotDirection: { type: String, enum: ['', 'left', 'center', 'right'], default: '' },
  reboundArmedBy: { type: String, default: '' },
  superSaveArmedBy: { type: String, default: '' },
  chaosMode: { type: String, enum: ['', 'golden', 'sudden', 'blind'], default: '' },
  chaosRound: { type: Number, default: 0 },
  roundDeadlineAt: { type: Date, default: null },
  lobbyDeadlineAt: { type: Date, default: null },
  startingLives: { type: Number, default: 3, min: 1, max: 5 },
  roundTimeoutSeconds: { type: Number, default: 30, min: 10, max: 120 },
  teamTiebreaker: { type: Boolean, default: false },
  tiebreakerShots: {
    a: { type: Number, default: 0 },
    b: { type: Number, default: 0 }
  },
  teamScores: {
    a: { type: Number, default: 0 },
    b: { type: Number, default: 0 }
  },
  winnerIds: { type: [String], default: [] },
  lastRoundSummary: { type: String, default: '' },
  roundHistory: { type: [roundHistorySchema], default: [] },
  statsApplied: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Matches created before Double Goal was removed are converted to Golden
// Penalty the next time they are saved, keeping old active lobbies usable.
penaltyRoyaleGameSchema.pre('validate', function normalizeLegacyDoubleGoal() {
  if (this.chaosMode === 'double') this.chaosMode = 'golden';
});

penaltyRoyaleGameSchema.index({ guildId: 1, channelId: 1, status: 1 });

module.exports = mongoose.model('PenaltyRoyaleGame', penaltyRoyaleGameSchema);
