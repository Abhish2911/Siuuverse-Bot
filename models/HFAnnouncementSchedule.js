const mongoose = require('mongoose');

const hfAnnouncementScheduleSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true
  },
  scheduledAt: {
    type: Date,
    required: true
  },
  teamNames: {
    type: [String],
    required: true
  },
  roleIds: {
    type: [String],
    required: true
  },
  createdBy: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

hfAnnouncementScheduleSchema.index({ guildId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.models.HFAnnouncementSchedule
  || mongoose.model('HFAnnouncementSchedule', hfAnnouncementScheduleSchema);
