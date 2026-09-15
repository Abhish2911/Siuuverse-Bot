const E = require('../utils/emojis');
const {
  getConfiguredLockRoleId,
  getConfiguredResultRoleIds,
  canManageHFChannel,
  getStoredAnnouncement,
  setAnnouncementRoleAccess,
  setLocked
} = require('../utils/hfAnnouncements');

module.exports = {
  name: 'hfunlock',
  aliases: ['unlockhf'],

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
      await setLocked(message.channel, false, `Unlocked by ${message.author.tag}`);

      const existing = await getStoredAnnouncement(message.guild.id, message.channel.id);
      const teamRoleIds = [...new Set(existing?.roleIds || [])];
      const playerRoleId = require('../utils/hfAnnouncements').getConfiguredPlayerRoleId();

      if (teamRoleIds.length || playerRoleId) {
        await setAnnouncementRoleAccess(
          message.channel,
          [...new Set([...(teamRoleIds || []), ...(playerRoleId ? [playerRoleId] : [])])],
          true,
          `Unlocked by ${message.author.tag}`
        );
      }

      return message.reply(`#${message.channel.name} is unlocked.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
