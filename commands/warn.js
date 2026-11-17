const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  assertMongoConnected,
  deferModerationReply,
  recordAction,
  requirePermissions,
  respondModerationReply
} = require('../utils/moderation');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Record a warning for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('member').setDescription('Member to warn').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for the warning').setMaxLength(500)
    ),
  prefix: {
    member: { type: 'user', index: 0, required: true },
    reason: { type: 'rest', index: 1, maxLength: 500 }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ModerateMembers);
      assertMongoConnected();
      const user = interaction.options.getUser('member', true);
      if (user.bot) throw new Error('Bot accounts cannot be warned.');
      if (user.id === interaction.user.id) throw new Error('You cannot warn yourself.');
      const reason = interaction.options.getString('reason');
      await recordAction(interaction, 'warn', {
        targetId: user.id,
        reason: reason || 'No reason provided'
      });
      return respondModerationReply(
        interaction,
        `${E.warning} Recorded a warning for ${user}.${reason ? ` Reason: ${reason}` : ''}`
      );
    } catch (error) {
      console.error(`${E.error} Failed to record warning:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not record that warning.'}`);
    }
  }
};
