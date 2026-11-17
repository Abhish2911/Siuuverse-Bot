const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopTrophySchema = new mongoose.Schema({
  trophyId: { type: String, required: true, unique: true },
  seasonKey: { type: String, required: true, index: true },
  competitionKey: { type: String, required: true },
  recipientType: { type: String, enum: ['player', 'team'], required: true },
  playerKey: { type: String, default: '' },
  discordId: { type: String, default: null },
  recipientName: { type: String, required: true },
  teamKey: { type: String, default: '' },
  trophyName: { type: String, required: true },
  placement: { type: String, enum: ['winner', 'runner_up'], required: true },
  awardedAt: { type: Date, default: null },
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

module.exports = getCoopModel('CoopTrophy', coopTrophySchema, 'coopTrophies');
