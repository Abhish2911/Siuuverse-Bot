const E = require('../utils/emojis');
const {
  getConfiguredLockRoleId,
  getConfiguredResultRoleIds,
  canManageHFChannel,
  setLocked
} = require('../utils/hfAnnouncements');

module.exports = {
  name: 'hflock',
  aliases: ['lockhf'],

  async execute(message) {
    if (!getConfiguredResultRoleIds().length) {
      return message.reply(`${E.missing} Add \`HF_RESULT_ROLE_ID\` to your .env first.`);
    }

    if (!canManageHFChannel(message)) {
      return message.reply(`${E.wrong} You need the configured HF result role and Manage Channels permission for this channel.`);
    }

    if (!getConfiguredLockRoleId()) {
      return message.reply(`${E.missing} Add \`HF_LOCK_ROLE_ID\` to your .env first.`);
    }

    try {
      await setLocked(message.channel, true, `Locked by ${message.author.tag}`);
      return message.reply(`#${message.channel.name} is locked.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
