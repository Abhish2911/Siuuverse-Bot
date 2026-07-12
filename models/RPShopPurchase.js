const mongoose = require('mongoose');

module.exports = mongoose.model(
  'RPShopPurchase',
  new mongoose.Schema({
    userId: {
      type: String,
      required: true,
      unique: true
    },
    purchases: {
      type: Number,
      default: 0
    },
    resetAt: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    }
  })
);
