const E = require('../utils/emojis');
const { loadHandFootballData } = require('../utils/handfootball');
const {
  getConfiguredLockRoleId,
  getConfiguredResultRoleIds,
  canManageHFChannel,
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

    if (!getConfiguredLockRoleId()) {
      return message.reply(`${E.missing} Add \`HF_LOCK_ROLE_ID\` to your .env first.`);
    }

    try {
      await setLocked(message.channel, true, `Locked by ${message.author.tag}`);

      const data = await loadHandFootballData().catch(() => ({ teams: [] }));
      const sheetTeamRoleIds = [...new Set(
        (data.teams || []).map(team => team.roleId).filter(Boolean)
      )];

      const channelRoleIds = [...new Set(
        message.channel.permissionOverwrites.cache
          .filter(overwrite => overwrite.type === 'role' && overwrite.id !== message.guild.roles.everyone.id)
          .map(overwrite => overwrite.id)
          .filter(roleId => sheetTeamRoleIds.includes(roleId))
      )];

      const playerRoleId = getConfiguredPlayerRoleId();
      const roleIdsToLock = [...new Set([
        ...(playerRoleId ? [playerRoleId] : []),
        ...channelRoleIds
      ])];

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
