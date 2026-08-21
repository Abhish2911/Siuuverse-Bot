const E = require('../utils/emojis');
const { getConfiguredLockRoleId, setLocked } = require('../utils/hfAnnouncements');

module.exports = {
  name: 'hfunlock',
  aliases: ['unlockhf'],

  async execute(message) {
    if (!message.member?.permissions?.has('ManageChannels')) {
      return message.reply(`${E.wrong} You need Manage Channels permission to use this command.`);
    }

    if (!getConfiguredLockRoleId()) {
      return message.reply(`${E.missing} Add \`HF_LOCK_ROLE_ID\` to your .env first.`);
    }

    try {
      await setLocked(message.channel, false, `Unlocked by ${message.author.tag}`);
      return message.reply(`${E.correct} The configured HF lock role can send messages in this channel again.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
