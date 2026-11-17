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
    .setName('purge')
    .setDescription('Bulk-delete recent messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option.setName('amount').setDescription('Number of recent messages (2–100)')
        .setRequired(true).setMinValue(2).setMaxValue(100)
    ),
  prefix: {
    amount: { type: 'integer', index: 0, required: true, min: 2, max: 100 }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ManageMessages);
      assertMongoConnected();
      if (!interaction.channel?.bulkDelete) {
        throw new Error('This command requires a text channel that supports bulk deletion.');
      }
      await requireBotPermissions(interaction, PermissionFlagsBits.ManageMessages);
      const amount = interaction.options.getInteger('amount', true);
      const reason = 'Messages purged by moderator';
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await recordAction(interaction, 'purge', {
        channelId: interaction.channelId,
        reason,
        metadata: { requested: amount, deleted: deleted.size }
      });
      const response = await respondModerationReply(
        interaction,
        `${E.success} Deleted ${deleted.size} recent message(s) in <#${interaction.channelId}>. Messages older than 14 days are skipped by Discord.`
      );
      const deleteResponse = response?.delete
        ? () => response.delete()
        : () => interaction.deleteReply();
      const deletionTimer = setTimeout(() => {
        deleteResponse().catch(() => {});
      }, 5000);
      deletionTimer.unref?.();
      return response;
    } catch (error) {
      console.error(`${E.error} Failed to purge messages:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not purge messages.'}`);
    }
  }
};
