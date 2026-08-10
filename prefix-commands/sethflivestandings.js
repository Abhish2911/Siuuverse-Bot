const { isBotOwner } = require('../utils/handfootball');
const { createHFLiveMessage } = require('../utils/handfootballLive');
const E = require('../utils/emojis');

module.exports = {
  name: 'sethflivestandings',
  aliases: ['hflivestandings', 'sethfstandingsbychannel'],

  async execute(message) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can set the HandFootball live standings message.`);
    }

    const sent = await createHFLiveMessage({
      client: message.client,
      guildId: message.guild.id,
      channel: message.channel,
      type: 'standings',
      createdBy: message.author.id
    });

    return message.reply(`${E.correct} HandFootball live standings message set in ${message.channel}.\n${E.Stats} Message ID: \`${sent.id}\``);
  }
};
