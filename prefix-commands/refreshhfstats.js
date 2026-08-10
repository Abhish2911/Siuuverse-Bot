const { isBotOwner } = require('../utils/handfootball');
const { refreshHFLiveMessage } = require('../utils/handfootballLive');
const E = require('../utils/emojis');

module.exports = {
  name: 'refreshhfstats',
  aliases: ['updatehfstats', 'hfstrefresh'],

  async execute(message) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can refresh the HandFootball live stats message.`);
    }

    const result = await refreshHFLiveMessage(message.client, message.guild.id, 'stats');

    if (!result.ok) {
      return message.reply(`${E.wrong} Could not refresh HF stats: ${result.reason}`);
    }

    return message.reply(`${E.correct} HandFootball live stats refreshed.`);
  }
};
