const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const ModerationAction = require('../models/ModerationAction');
const E = require('../utils/emojis');
const {
  assertMongoConnected,
  deferModerationReply,
  requirePermissions,
  respondModerationReply
} = require('../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a member’s latest warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('member').setDescription('Member whose warnings to view').setRequired(true)
    ),
  prefix: {
    member: { type: 'user', index: 0, required: true }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ModerateMembers);
      assertMongoConnected();
      const user = interaction.options.getUser('member', true);
      const warnings = await ModerationAction.find({
        guildId: interaction.guildId,
        action: 'warn',
        targetId: user.id
      }).sort({ createdAt: -1 }).limit(10).lean();

      if (!warnings.length) return respondModerationReply(interaction, `${E.missing} No warnings found for ${user}.`);
      const lines = warnings.map((warning, index) => {
        const timestamp = Math.floor(warning.createdAt.getTime() / 1000);
        const reason = (warning.reason || 'No reason supplied').slice(0, 100);
        return `**${index + 1}.** <t:${timestamp}:d> — ${reason} (by <@${warning.moderatorId}>)`;
      });
      return respondModerationReply(interaction, `Latest ${warnings.length} warning(s) for ${user}:\n${lines.join('\n')}`);
    } catch (error) {
      console.error(`${E.error} Failed to retrieve warnings:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not retrieve warnings.'}`);
    }
  }
};
