

const mongoose = require('mongoose');

const roleCooldownSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },
  roleId: {
    type: String,
    required: true
  },
  cooldownMs: {
    type: Number,
    required: true,
    default: 0
  }
});

const rolePingSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },
  roleId: {
    type: String,
    required: true
  },
  lastPing: {
    type: Number,
    default: 0
  }
});

const RoleCooldown = mongoose.models.RoleCooldown || mongoose.model('RoleCooldown', roleCooldownSchema);
const RolePing = mongoose.models.RolePing || mongoose.model('RolePing', rolePingSchema);

module.exports = {
  RoleCooldown,
  RolePing
};