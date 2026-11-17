const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopTableSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  headers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  rows: { type: [[mongoose.Schema.Types.Mixed]], default: [] },
  sourceUpdatedAt: { type: Date, default: null },
  migratedAt: { type: Date, default: Date.now }
}, { timestamps: true, minimize: false });

module.exports = getCoopModel('CoopTable', coopTableSchema, 'coopTables');
