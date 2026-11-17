const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopPlayerSeasonSchema = new mongoose.Schema({
  recordId: { type: String, required: true, unique: true },
  seasonKey: { type: String, required: true, index: true },
  competitionKey: { type: String, required: true },
  playerKey: { type: String, required: true },
  discordId: { type: String, default: null },
  legacyName: { type: String, required: true },
  teamKey: { type: String, default: '' },
  legacyTeamName: { type: String, default: '' },
  stats: {
    matches: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    goals: { type: Number, default: 0 },
    assists: { type: Number, default: 0 },
    goalContributions: { type: Number, default: 0 },
    mvps: { type: Number, default: 0 },
    tackles: { type: Number, default: 0 },
    interceptions: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    yellowCards: { type: Number, default: 0 },
    redCards: { type: Number, default: 0 },
    cleanSheets: { type: Number, default: 0 },
    legacyTrophyCount: { type: Number, default: 0 },
    awards: { type: Number, default: 0 }
  },
  honours: [{
    competitionKey: String,
    title: String,
    placement: String
  }],
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

module.exports = getCoopModel('CoopPlayerSeason', coopPlayerSeasonSchema, 'coopPlayerSeasons');
