const mongoose = require('mongoose');

const TrainCooldownSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  lastTrain: {
    type: Date,
    default: null
  },
  notified: {
    type: Boolean,
    default: false
  },
  reminderMessageId: {
    type: String,
    default: null
  }
});

module.exports =
  mongoose.models.TrainCooldown ||
  mongoose.model('TrainCooldown', TrainCooldownSchema);
