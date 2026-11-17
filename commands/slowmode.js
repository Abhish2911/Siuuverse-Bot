const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  assertMongoConnected,
  deferModerationReply,
  recordAction,
  requireBotPermissions,
  requirePermissions,
  respondModerationReply
} = require('../utils/moderation');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set this channel’s slowmode (0 disables it)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(option =>
      option.setName('seconds').setDescription('Delay in seconds (0–21600)')
        .setRequired(true).setMinValue(0).setMaxValue(21600)
    ),
  prefix: {
    seconds: { type: 'integer', index: 0, required: true, min: 0, max: 21600 }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ManageChannels);
      assertMongoConnected();
      if (typeof interaction.channel?.setRateLimitPerUser !== 'function') {
        throw new Error('Slowmode is not supported in this channel.');
      }
      await requireBotPermissions(interaction, PermissionFlagsBits.ManageChannels);
      const seconds = interaction.options.getInteger('seconds', true);
      const reason = 'Slowmode changed by moderator';
      await interaction.channel.setRateLimitPerUser(seconds, reason);
      await recordAction(interaction, 'slowmode', {
        channelId: interaction.channelId,
        reason,
        metadata: { seconds }
      });
      return respondModerationReply(
        interaction,
        seconds ? `${E.calendar} Set slowmode to ${seconds} second(s) in <#${interaction.channelId}>.` : `${E.correct} Disabled slowmode in <#${interaction.channelId}>.`
      );
    } catch (error) {
      console.error(`${E.error} Failed to change slowmode:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not change slowmode.'}`);
    }
  }
};
