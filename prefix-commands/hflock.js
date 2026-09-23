const E = require('../utils/emojis');
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

    try {
      const playerRoleId = getConfiguredPlayerRoleId();
      if (!playerRoleId) {
        return message.reply(`${E.missing} Add \`HF_PLAYER_ROLE_ID\` to your .env first.`);
      }

      if (getConfiguredLockRoleId()) {
        await setLocked(message.channel, true, `Locked by ${message.author.tag}`);
      }

      const role = message.guild.roles.cache.get(playerRoleId)
        || await message.guild.roles.fetch(playerRoleId).catch(() => null);

      if (!role) {
        return message.reply(`${E.missing} The configured HF player role was not found in this server.`);
      }

      await message.channel.permissionOverwrites.edit(role, {
        SendMessages: false
      }, { reason: `Locked by ${message.author.tag}` });

      return message.reply(`#${message.channel.name} is locked.`);
    } catch (error) {
      return message.reply(`${E.wrong} ${error.message}`);
    }
  }
};
