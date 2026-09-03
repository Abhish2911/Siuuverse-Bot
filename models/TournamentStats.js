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

    // Most recent first-class match performances used exclusively for the
    // form rating. Keep only five entries when stats are submitted.
    recentForm: {
      type: [recentFormSchema],
      default: []
    }
  })
);
