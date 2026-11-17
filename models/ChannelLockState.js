const mongoose = require('mongoose');

const lockedPermissionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  wasAllowed: { type: Boolean, required: true },
  wasDenied: { type: Boolean, required: true }
}, { _id: false });

const channelLockStateSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  lockedBy: { type: String, required: true },
  overwriteExisted: { type: Boolean, required: true },
  permissions: { type: [lockedPermissionSchema], default: [] }
}, { timestamps: true });

channelLockStateSchema.index({ guildId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.models.ChannelLockState
  || mongoose.model('ChannelLockState', channelLockStateSchema);
