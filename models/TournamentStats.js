// models/TournamentStats.js

const mongoose = require('mongoose');

module.exports = mongoose.model(
  'TournamentStats',
  new mongoose.Schema({
    userId: {
      type: String,
      required: true,
      unique: true
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

    // Per-match totals used by the rolling form rating.
    matchHistory: {
      type: [{
        _id: false,
        recordedAt: { type: Date, default: Date.now },
        matches: { type: Number, default: 1 },
        goals: { type: Number, default: 0 },
        assists: { type: Number, default: 0 },
        mvps: { type: Number, default: 0 },
        hattricks: { type: Number, default: 0 },
        interceptions: { type: Number, default: 0 },
        tackles: { type: Number, default: 0 },
        saves: { type: Number, default: 0 }
      }],
      default: []
    }
  })
);
