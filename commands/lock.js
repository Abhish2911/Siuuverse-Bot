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

const LOCKED_PERMISSIONS = [
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads],
  ['CreatePublicThreads', PermissionFlagsBits.CreatePublicThreads],
  ['CreatePrivateThreads', PermissionFlagsBits.CreatePrivateThreads]
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Prevent @everyone from posting in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  prefix: {},

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ManageChannels);
      assertMongoConnected();
      const channel = interaction.channel;
      if (!channel?.isTextBased() || channel.isThread() || !channel.permissionOverwrites) {
        throw new Error('Use this command in a text, announcement, or forum channel—not inside a thread.');
      }

      const existing = await ChannelLockState.findOne({
        guildId: interaction.guildId,
        channelId: channel.id
      });
      if (existing) throw new Error('This channel is already locked by the moderation command.');

      const everyone = interaction.guild.roles.everyone;
      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
      const permissions = LOCKED_PERMISSIONS.map(([name, bit]) => ({
        name,
        wasAllowed: Boolean(overwrite?.allow.has(bit)),
        wasDenied: Boolean(overwrite?.deny.has(bit))
      }));

      const state = await ChannelLockState.create({
        guildId: interaction.guildId,
        channelId: channel.id,
        lockedBy: interaction.user.id,
        overwriteExisted: Boolean(overwrite),
        permissions
      });

      try {
        await requireBotPermissions(interaction, PermissionFlagsBits.ManageChannels);
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false
        }, { reason: 'Channel locked by moderator' });
      } catch (error) {
        await state.deleteOne();
        throw error;
      }

      await recordAction(interaction, 'lock', {
        channelId: channel.id,
        metadata: { permissions: permissions.length }
      });
      return respondModerationReply(interaction, `${E.lock} Locked <#${channel.id}> for @everyone.`);
    } catch (error) {
      console.error(`${E.error} Failed to lock channel:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not lock this channel.'}`);
    }
  }
};
