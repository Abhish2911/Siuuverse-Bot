// models/TournamentStats.js

const mongoose = require('mongoose');

const recentFormSchema = new mongoose.Schema({
  goals: { type: Number, default: 0 },
  assists: { type: Number, default: 0 },
  mvps: { type: Number, default: 0 },
  hattricks: { type: Number, default: 0 },
  interceptions: { type: Number, default: 0 },
  tackles: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  recordedAt: { type: Date, default: Date.now }
}, { _id: false });

const tournamentStatsSchema = new mongoose.Schema({
    userId: {
      type: String,
      required: true
    },

    guildId: {
      type: String,
      required: true,
      default: 'legacy'
    },

    // Legacy rows may remain unlinked until an admin assigns them to a tournament.
    tournamentId: {
      type: String,
      default: null,
      index: true
    },

    ratingAverage: {
      type: Number,
      default: null
    },

    ratingMatches: {
      type: Number,
      default: 0
    },

    trophies: {
      type: Number,
      default: 0
    },

    awards: {
      type: Number,
      default: 0
    },

    matches: {
      type: Number,
      default: 0
    },

    goals: {
      type: Number,
      default: 0
    },

    assists: {
      type: Number,
      default: 0
    },

    mvps: {
      type: Number,
      default: 0
    },

    hattricks: {
      type: Number,
      default: 0
    },

    interceptions: {
      type: Number,
      default: 0
    },

    tackles: {
      type: Number,
      default: 0
    },

    saves: {
      type: Number,
      default: 0
    },

    // Most recent first-class match performances used exclusively for the
    // form rating. Keep only five entries when stats are submitted.
    recentForm: {
      type: [recentFormSchema],
      default: []
    }
});

tournamentStatsSchema.index(
  { guildId: 1, tournamentId: 1, userId: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('TournamentStats', tournamentStatsSchema);
