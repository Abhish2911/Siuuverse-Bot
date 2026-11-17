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
  requireTargetBelowModerator,
  respondModerationReply
} = require('../utils/moderation');
const E = require('../utils/emojis');

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('member').setDescription('Member to timeout').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('minutes').setDescription('Timeout duration in minutes (1–40320)')
        .setRequired(true).setMinValue(1).setMaxValue(MAX_TIMEOUT_MINUTES)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for the timeout').setMaxLength(500)
    ),
  prefix: {
    member: { type: 'user', index: 0, required: true },
    minutes: { type: 'integer', index: 1, required: true, min: 1, max: MAX_TIMEOUT_MINUTES },
    reason: { type: 'rest', index: 2, maxLength: 500 }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ModerateMembers);
      assertMongoConnected();
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id);
      if (user.id === interaction.user.id) throw new Error('You cannot timeout yourself.');
      const botMember = await requireBotPermissions(interaction, PermissionFlagsBits.ModerateMembers);
      await requireTargetBelowModerator(interaction, member, botMember);
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason');
      const auditReason = reason || 'No reason provided';
      const until = new Date(Date.now() + minutes * 60_000);
      await member.timeout(minutes * 60_000, auditReason);
      await recordAction(interaction, 'timeout', {
        targetId: user.id,
        reason: auditReason,
        metadata: { durationMinutes: minutes, until }
      });
      return respondModerationReply(
        interaction,
        `${E.suspend} Timed out ${user} for ${minutes} minute(s).${reason ? ` Reason: ${reason}` : ''}`
      );
    } catch (error) {
      console.error(`${E.error} Failed to timeout member:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not timeout that member.'}`);
    }
  }
};
