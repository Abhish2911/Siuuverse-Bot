const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const ChannelLockState = require('../models/ChannelLockState');
const E = require('../utils/emojis');
const {
  assertMongoConnected,
  deferModerationReply,
  recordAction,
  requireBotPermissions,
  requirePermissions,
  respondModerationReply
} = require('../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Restore @everyone posting permissions saved by /lock')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  prefix: {},

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ManageChannels);
      assertMongoConnected();
      const channel = interaction.channel;
      if (!channel?.permissionOverwrites || channel.isThread()) {
        throw new Error('Use this command in the channel that was locked.');
      }

      const state = await ChannelLockState.findOne({
        guildId: interaction.guildId,
        channelId: channel.id
      });
      if (!state) throw new Error('No saved lock state exists for this channel; no permissions were changed.');

      await requireBotPermissions(interaction, PermissionFlagsBits.ManageChannels);
      const everyone = interaction.guild.roles.everyone;
      const restore = {};
      for (const permission of state.permissions) {
        restore[permission.name] = permission.wasAllowed
          ? true
          : permission.wasDenied
            ? false
            : null;
      }

      await channel.permissionOverwrites.edit(everyone, restore, {
        reason: 'Channel unlocked by moderator'
      });

      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
      if (!state.overwriteExisted && !overwrite?.allow.bitfield && !overwrite?.deny.bitfield) {
        await channel.permissionOverwrites.delete(everyone, 'Restore original @everyone overwrite state');
      }
      await state.deleteOne();
      await recordAction(interaction, 'unlock', {
        channelId: channel.id
      });
      return respondModerationReply(interaction, `${E.correct} Restored the saved @everyone permissions for <#${channel.id}>.`);
    } catch (error) {
      console.error(`${E.error} Failed to unlock channel:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not unlock this channel.'}`);
    }
  }
};
