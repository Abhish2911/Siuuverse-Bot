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
      const channelRoleIds = [...new Set([
        ...(existing?.roleIds || []),
        ...message.channel.permissionOverwrites.cache
          .filter(overwrite => overwrite.type === 'role' && overwrite.id !== message.guild.roles.everyone.id)
          .map(overwrite => overwrite.id),
        ...(require('../utils/hfAnnouncements').getConfiguredPlayerRoleId ? [require('../utils/hfAnnouncements').getConfiguredPlayerRoleId()] : [])
      ])];

      if (channelRoleIds.length) {
        await setAnnouncementRoleAccess(
          message.channel,
          channelRoleIds,
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
