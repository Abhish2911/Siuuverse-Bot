const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopSeasonSchema = new mongoose.Schema({
  seasonKey: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  status: { type: String, enum: ['planned', 'active', 'completed'], default: 'completed' },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

module.exports = getCoopModel('CoopSeason', coopSeasonSchema, 'coopSeasons');
