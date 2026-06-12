const mongoose = require('mongoose');

const SuspensionHistorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['yellow', 'red', 'ban', 'served'],
      required: true
    },
    matchNo: {
      type: String,
      default: null
    },
    note: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const SuspensionSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      index: true
    },

    competition: {
      type: String,
      required: true,
      enum: ['league', 'fa', 'carabao', 'ucl'],
      index: true
    },

    playerName: {
      type: String,
      required: true,
      trim: true
    },

    normalizedPlayerName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    teamName: {
      type: String,
      required: true,
      trim: true
    },

    teamShort: {
      type: String,
      default: '',
      trim: true
    },

    yellowCards: {
      type: Number,
      default: 0
    },

    redCard: {
      type: Boolean,
      default: false
    },

    redMatchNo: {
      type: String,
      default: null
    },

    yellowBanTriggeredAt: {
      type: String,
      default: null
    },

    bannedMatchNo: {
      type: String,
      default: null
    },

    status: {
      type: String,
      enum: ['clear', 'suspended', 'served'],
      default: 'clear',
      index: true
    },

    suspensionReason: {
      type: String,
      default: null
    },

    servedMatchNo: {
      type: String,
      default: null
    },

    history: {
      type: [SuspensionHistorySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);


SuspensionSchema.index(
  { guildId: 1, competition: 1, normalizedPlayerName: 1 },
  { unique: true }
);

SuspensionSchema.methods.resetDisciplineState = function resetDisciplineState() {
  this.yellowCards = 0;
  this.redCard = false;
  this.redMatchNo = null;
  this.yellowBanTriggeredAt = null;
  this.bannedMatchNo = null;
  this.status = 'clear';
  this.suspensionReason = null;
  this.servedMatchNo = null;
  this.history = [];
  return this;
};

SuspensionSchema.statics.resetForGuild = async function resetForGuild(guildId, options = {}) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const filter = { guildId: normalizedGuildId };

  if (options.competition) {
    filter.competition = String(options.competition).trim().toLowerCase();
  }

  if (options.deleteDocuments) {
    return this.deleteMany(filter);
  }

  return this.updateMany(filter, {
    $set: {
      yellowCards: 0,
      redCard: false,
      redMatchNo: null,
      yellowBanTriggeredAt: null,
      bannedMatchNo: null,
      status: 'clear',
      suspensionReason: null,
      servedMatchNo: null,
      history: []
    }
  });
};


SuspensionSchema.pre('validate', function normalizeSuspensionState() {
  this.guildId = String(this.guildId || '').trim();
  this.competition = String(this.competition || '').trim().toLowerCase();
  this.playerName = String(this.playerName || '').trim();
  this.normalizedPlayerName = String(this.normalizedPlayerName || this.playerName || '').trim().toLowerCase();
  this.teamName = String(this.teamName || '').trim();
  this.teamShort = String(this.teamShort || '').trim().toUpperCase();

  this.yellowCards = Number.isFinite(this.yellowCards) ? this.yellowCards : Number(this.yellowCards || 0);
  if (!Number.isFinite(this.yellowCards) || this.yellowCards < 0) {
    this.yellowCards = 0;
  }

  if (this.status === 'clear') {
    this.redCard = false;
    this.redMatchNo = null;
    this.yellowBanTriggeredAt = null;
    this.bannedMatchNo = null;
    this.suspensionReason = null;
    this.servedMatchNo = null;
  }

  if (this.status === 'served') {
    this.redCard = false;
    this.bannedMatchNo = null;
  }
});

module.exports = mongoose.models.Suspension || mongoose.model('Suspension', SuspensionSchema);
