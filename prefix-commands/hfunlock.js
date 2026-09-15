const E = require('../utils/emojis');
const {
  getConfiguredLockRoleId,
  getConfiguredResultRoleIds,
  canManageHFChannel,
  getChannelTeamRoleIds,
  getConfiguredPlayerRoleId,
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

      const channelRoleIds = await getChannelTeamRoleIds(message.channel);
      const playerRoleId = getConfiguredPlayerRoleId();
      const roleIdsToUnlock = [...new Set([
        ...(playerRoleId ? [playerRoleId] : []),
        ...channelRoleIds
      ])];

      await Promise.all(roleIdsToUnlock.map(roleId => {
        const role = message.guild.roles.cache.get(roleId)
          || message.guild.roles.fetch(roleId).catch(() => null);
        return role ? message.channel.permissionOverwrites.edit(role, {
          SendMessages: true
        }, { reason: `Unlocked by ${message.author.tag}` }) : null;
      }));

      return message.reply(`#${message.channel.name} is unlocked.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
