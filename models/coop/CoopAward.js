const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopAwardSchema = new mongoose.Schema({
  awardId: { type: String, required: true, unique: true },
  seasonKey: { type: String, required: true, index: true },
  competitionKey: { type: String, required: true },
  recipientType: { type: String, enum: ['player', 'team', 'legacy'], required: true },
  playerKey: { type: String, default: '' },
  discordId: { type: String, default: null },
  recipientName: { type: String, required: true },
  teamKey: { type: String, default: '' },
  awardName: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  awardedAt: { type: Date, default: null },
  source: { type: String, default: 'google_sheets' }
}, { timestamps: true });

module.exports = getCoopModel('CoopAward', coopAwardSchema, 'coopAwards');
