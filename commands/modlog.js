const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const ModerationAction = require('../models/ModerationAction');
const E = require('../utils/emojis');
const {
  assertMongoConnected,
  deferModerationReply,
  formatAction,
  requirePermissions,
  respondModerationReply
} = require('../utils/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlog')
    .setDescription('View recent moderation actions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('member').setDescription('Only show actions against this member')
    )
    .addIntegerOption(option =>
      option.setName('limit').setDescription('Number of entries (1–10)')
        .setMinValue(1).setMaxValue(10)
    ),
  prefix: {
    member: { type: 'user', index: 0 },
    limit: { type: 'integer', index: 1, min: 1, max: 10 }
  },

  async execute(interaction) {
    await deferModerationReply(interaction);
    try {
      if (!interaction.inGuild()) throw new Error('This command can only be used in a server.');
      requirePermissions(interaction, PermissionFlagsBits.ModerateMembers);
      assertMongoConnected();
      const user = interaction.options.getUser('member');
      const limit = interaction.options.getInteger('limit') || 10;
      const query = { guildId: interaction.guildId };
      if (user) query.targetId = user.id;
      const actions = await ModerationAction.find(query).sort({ createdAt: -1 }).limit(limit).lean();
      if (!actions.length) return respondModerationReply(interaction, `${E.missing} No moderation actions found.`);

      const lines = actions.map(action => {
        const time = Math.floor(action.createdAt.getTime() / 1000);
        const target = action.targetId ? ` → <@${action.targetId}>` : '';
        const channel = action.channelId ? ` in <#${action.channelId}>` : '';
        const reason = action.reason ? ` — ${action.reason.slice(0, 100)}` : '';
        return `• **${formatAction(action.action)}**${target}${channel} by <@${action.moderatorId}> (<t:${time}:R>)${reason}`;
      });
      return respondModerationReply(interaction, lines.join('\n'));
    } catch (error) {
      console.error(`${E.error} Failed to retrieve moderation log:`, error);
      return respondModerationReply(interaction, `${E.error} ${error.message || 'Could not retrieve the moderation log.'}`);
    }
  }
};
