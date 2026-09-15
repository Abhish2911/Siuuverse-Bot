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
  name: 'hflock',
  aliases: ['lockhf'],

  async execute(message) {
    if (!getConfiguredResultRoleIds().length) {
      return message.reply(`${E.missing} Add \`HF_RESULT_ROLE_ID\` to your .env first.`);
    }

    if (!canManageHFChannel(message)) {
      return message.reply(`${E.wrong} You need the configured HF result role and Manage Channels permission for this channel.`);
    }

    try {
      const channelRoleIds = await getChannelTeamRoleIds(message.channel);
      const playerRoleId = getConfiguredPlayerRoleId();
      const roleIdsToLock = [...new Set([
        ...(playerRoleId ? [playerRoleId] : []),
        ...channelRoleIds
      ])];

      if (getConfiguredLockRoleId()) {
        await setLocked(message.channel, true, `Locked by ${message.author.tag}`);
      }

      if (!roleIdsToLock.length && !getConfiguredLockRoleId()) {
        return message.reply(`${E.missing} No HF team roles or lock role were found for this channel.`);
      }

      await Promise.all(roleIdsToLock.map(roleId => {
        const role = message.guild.roles.cache.get(roleId)
          || message.guild.roles.fetch(roleId).catch(() => null);
        return role ? message.channel.permissionOverwrites.edit(role, {
          SendMessages: false
        }, { reason: `Locked by ${message.author.tag}` }) : null;
      }));

      return message.reply(`#${message.channel.name} is locked.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
