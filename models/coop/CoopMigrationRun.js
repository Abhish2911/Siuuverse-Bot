const mongoose = require('mongoose');
const { getCoopModel } = require('../../utils/coopMongo');

const coopMigrationRunSchema = new mongoose.Schema({
  migrationId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
  sourceFingerprint: { type: String, required: true },
  counts: { type: mongoose.Schema.Types.Mixed, default: {} },
  warnings: { type: [String], default: [] },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = getCoopModel('CoopMigrationRun', coopMigrationRunSchema, 'coopMigrationRuns');
