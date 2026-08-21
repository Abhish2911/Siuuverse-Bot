const E = require('../utils/emojis');
const { getConfiguredLockRoleId, setLocked } = require('../utils/hfAnnouncements');

module.exports = {
  name: 'hflock',
  aliases: ['lockhf'],

  async execute(message) {
    if (!message.member?.permissions?.has('ManageChannels')) {
      return message.reply(`${E.wrong} You need Manage Channels permission to use this command.`);
    }

    if (!getConfiguredLockRoleId()) {
      return message.reply(`${E.missing} Add \`HF_LOCK_ROLE_ID\` to your .env first.`);
    }

    try {
      await setLocked(message.channel, true, `Locked by ${message.author.tag}`);
      return message.reply(`${E.lock} The configured HF lock role can no longer send messages in this channel.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
