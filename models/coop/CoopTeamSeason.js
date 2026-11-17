const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopTeamSeasonSchema = new mongoose.Schema({
  recordId: { type: String, required: true, unique: true },
  seasonKey: { type: String, required: true, index: true },
  competitionKey: { type: String, required: true },
  teamKey: { type: String, default: '' },
  legacyName: { type: String, required: true },
  shortName: { type: String, default: '' },
  stats: {
    matches: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },
    goalsAgainst: { type: Number, default: 0 },
    goalDifference: { type: Number, default: 0 },
    points: { type: Number, default: 0 }
  },
  honours: [{
    competitionKey: String,
    title: String,
    placement: String
  }],
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

module.exports = getCoopModel('CoopTeamSeason', coopTeamSeasonSchema, 'coopTeamSeasons');
