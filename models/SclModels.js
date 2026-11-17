const mongoose = require('mongoose');
const { getSclModel } = require('../utils/sclMongo');

const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  enabled: { type: Boolean, default: true },
  registrationOpen: { type: Boolean, default: false },
  refereeRoleId: { type: String, default: '' },
  approvalChannelId: { type: String, default: '' },
  playersPerTeam: { type: Number, default: 6, min: 1, max: 100 },
  disabledCommands: { type: [String], default: [] }
}, { timestamps: true });

const playerSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  playerId: { type: String, required: true },
  userId: { type: String, default: '' },
  displayName: { type: String, required: true, trim: true },
  individualPoints: { type: Number, default: 0 },
  teamId: { type: String, default: '' },
  captain: { type: Boolean, default: false }
}, { timestamps: true });
playerSchema.index({ guildId: 1, playerId: 1 }, { unique: true });

const rosterSchema = new mongoose.Schema({
  playerId: String,
  userId: String,
  displayName: String
}, { _id: false });

const teamSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  teamId: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true },
  captainUserId: { type: String, required: true },
  captainName: { type: String, required: true },
  roster: { type: [rosterSchema], default: [] },
  roleId: { type: String, default: '' },
  teamPoints: { type: Number, default: 0 }
}, { timestamps: true });
teamSchema.index({ guildId: 1, teamId: 1 }, { unique: true });
teamSchema.index({ guildId: 1, nameKey: 1 }, { unique: true });

const pendingTeamSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  requestId: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true },
  captainUserId: { type: String, required: true },
  captainName: { type: String, required: true },
  requestType: { type: String, enum: ['team', 'players'], default: 'team' },
  players: { type: [rosterSchema], default: [] },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewMessageId: { type: String, default: '' }
}, { timestamps: true });
pendingTeamSchema.index({ guildId: 1, requestId: 1 }, { unique: true });
pendingTeamSchema.index({ guildId: 1, nameKey: 1, status: 1 });

async function models() {
  const [Config, Player, Team, PendingTeam] = await Promise.all([
    getSclModel('SclConfig', configSchema, 'scl_configs'),
    getSclModel('SclPlayer', playerSchema, 'scl_players'),
    getSclModel('SclTeam', teamSchema, 'scl_teams'),
    getSclModel('SclPendingTeam', pendingTeamSchema, 'scl_pending_teams')
  ]);
  return { Config, Player, Team, PendingTeam };
}

module.exports = { models };
