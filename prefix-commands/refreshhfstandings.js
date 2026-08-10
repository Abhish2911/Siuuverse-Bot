const { isBotOwner } = require('../utils/handfootball');
const { refreshHFLiveMessage } = require('../utils/handfootballLive');
const E = require('../utils/emojis');

module.exports = {
  name: 'refreshhfstandings',
  aliases: ['updatehfstandings', 'hfstandingsrefresh'],

  async execute(message) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can refresh the HandFootball live standings message.`);
    }

    const result = await refreshHFLiveMessage(message.client, message.guild.id, 'standings');

    if (!result.ok) {
      return message.reply(`${E.wrong} Could not refresh HF standings: ${result.reason}`);
    }

    return message.reply(`${E.correct} HandFootball live standings refreshed.`);
  }
};
