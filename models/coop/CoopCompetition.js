const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const teamReferenceSchema = new mongoose.Schema({
  teamKey: { type: String, default: '' },
  name: { type: String, default: '' }
}, { _id: false });

const coopCompetitionSchema = new mongoose.Schema({
  competitionId: { type: String, required: true, unique: true },
  seasonKey: { type: String, required: true, index: true },
  competitionKey: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, enum: ['planned', 'active', 'completed'], default: 'completed' },
  champion: { type: teamReferenceSchema, default: null },
  runnerUp: { type: teamReferenceSchema, default: null },
  archivedAt: { type: Date, default: null },
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

coopCompetitionSchema.index({ seasonKey: 1, competitionKey: 1 }, { unique: true });

module.exports = getCoopModel('CoopCompetition', coopCompetitionSchema, 'coopCompetitions');
