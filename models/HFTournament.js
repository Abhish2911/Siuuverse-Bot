const mongoose = require('mongoose');

const hfTournamentSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  tournamentId: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['league', 'cup', 'groups_knockout'], required: true },
  status: { type: String, enum: ['draft', 'registration', 'active', 'ended', 'archived'], default: 'draft' },
  createdBy: { type: String, required: true },
  endedAt: { type: Date, default: null },
  registrationOpen: { type: Boolean, default: false },
  tableEnabled: { type: Boolean, default: true },
  promotionEnabled: { type: Boolean, default: false },
  relegationEnabled: { type: Boolean, default: false },
  promotionSlots: { type: Number, default: 0 },
  relegationSlots: { type: Number, default: 0 },
  playerRoleId: { type: String, default: '' },
  captainRoleId: { type: String, default: '' },
  viceCaptainRoleId: { type: String, default: '' },
  lockRoleId: { type: String, default: '' },
  statsChannelId: { type: String, default: '' },
  resultChannelId: { type: String, default: '' },
  reserveChannelId: { type: String, default: '' },
  teams: [{
    teamId: String,
    name: { type: String, required: true },
    shortName: { type: String, default: '' },
    stadium: { type: String, default: '' },
    color: { type: String, default: '' },
    roleId: { type: String, default: '' },
    captainUserId: { type: String, default: '' },
    viceCaptainUserId: { type: String, default: '' },
    playerUserIds: { type: [String], default: [] }
  }],
  standings: [{
    teamId: { type: String, required: true },
    teamName: { type: String, required: true },
    played: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },
    goalsAgainst: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    pointAdjustments: { type: Number, default: 0 }
  }],
  fixtures: [{
    matchId: String,
    round: String,
    group: String,
    tieId: { type: String, default: '' },
    aggregateId: { type: String, default: '' },
    leg: { type: Number, default: 1 },
    legs: { type: Number, default: 1 },
    homeTeamId: String,
    awayTeamId: String,
    homeTeamName: String,
    awayTeamName: String,
    venue: { type: String, default: '' },
    scheduledAt: { type: Date, default: null },
    status: { type: String, default: 'upcoming' },
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    winnerTeamId: { type: String, default: '' },
    decision: { type: String, enum: ['', 'home', 'away'], default: '' },
    homePenaltyScore: { type: Number, default: null },
    awayPenaltyScore: { type: Number, default: null }
  }]
}, { timestamps: true });

hfTournamentSchema.index({ guildId: 1, status: 1 });
hfTournamentSchema.index(
  { guildId: 1 },
  {
    unique: true,
    name: 'one_open_tournament_per_guild',
    partialFilterExpression: { status: { $in: ['registration', 'active'] } }
  }
);

module.exports = mongoose.models.HFTournament
  || mongoose.model('HFTournament', hfTournamentSchema);