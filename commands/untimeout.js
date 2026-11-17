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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('member').setDescription('Member to untimeout').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for removing the timeout').setMaxLength(500)
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
      const member = await interaction.guild.members.fetch(user.id);
      const botMember = await requireBotPermissions(interaction, PermissionFlagsBits.ModerateMembers);
      await requireTargetBelowModerator(interaction, member, botMember);
      const reason = interaction.options.getString('reason') || 'Timeout removed by moderator';
      await member.timeout(null, reason);
      await recordAction(interaction, 'untimeout', {
        targetId: user.id,
        reason
      });
      return respondModerationReply(interaction, `${E.correct} Removed ${user}'s timeout.`);
    } catch (error) {
      console.error(`${E.error} Failed to remove timeout:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not remove that timeout.'}`);
    }
  }
};
