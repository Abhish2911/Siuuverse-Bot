const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addrr')
    .setDescription('Give a role to users who reacted with a specific emoji')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel containing the message')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('messageid')
        .setDescription('Message ID')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to add')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('emoji')
        .setDescription('Emoji to check (✅ or emoji ID or name:id)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({
        content: '❌ Administrator permission required.'
      }).catch(() => null);
    }
    const channel = interaction.options.getChannel('channel');
    const messageId = interaction.options.getString('messageid');
    const role = interaction.options.getRole('role');
    const emojiInput = interaction.options.getString('emoji').trim();
    const emojiIdMatch = emojiInput.match(/\d{17,20}/);
    const parsedEmojiId = emojiIdMatch ? emojiIdMatch[0] : null;

    try {
      const message = await channel.messages.fetch(messageId);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${emojis.profile} Reaction Role Scanner`)
            .setDescription(
              [
                `${emojis.search || '🔍'} Scanning message reactions`,
                `${emojis.team} Role: ${role}`,
                `${emojis.calendar} Message ID: ${messageId}`,
                '',
                '⏳ Gathering users who reacted to the selected emoji...'
              ].join('\n')
            )
        ]
      });

      let targetReaction = null;

      for (const reaction of message.reactions.cache.values()) {
        const emoji = reaction.emoji;

        const exactCustomMatch =
          parsedEmojiId && emoji.id === parsedEmojiId;

        const exactUnicodeMatch =
          !parsedEmojiId && !emoji.id && emoji.name === emojiInput;

        if (exactCustomMatch || exactUnicodeMatch) {
          targetReaction = reaction;
          break;
        }
      }

      if (!targetReaction) {
        const available = [...message.reactions.cache.values()]
          .map(r => `${r.emoji.name} (${r.emoji.id || 'unicode'})`)
          .join('\n');

        return interaction.editReply(
          `❌ Emoji not found: ${emojiInput}\n\nAvailable reactions:\n${available || 'None'}`
        );
      }

      const users = await targetReaction.users.fetch();

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${emojis.correct} Users Found`)
            .setDescription(
              [
                `👥 Found ${users.size - (users.filter(u => u.bot).size)} reacting user(s)`,
                `${emojis.team} Assigning ${role}...`,
                '',
                '⏳ Please wait while roles are being applied.'
              ].join('\n')
            )
        ]
      });

      let added = 0;
      let skipped = 0;
      let failed = 0;
      let notInServer = 0;

      for (const [userId, user] of users) {
        if (user.bot) continue;

        try {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);

          if (!member) {
            notInServer++;
            continue;
          }

          if (member.roles.cache.has(role.id)) {
            skipped++;
            continue;
          }

          await member.roles.add(role);
          added++;
        } catch (err) {
          console.error(`Failed to add role to ${userId}:`, err);
          failed++;
        }
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${emojis.trophy_animated} Role Assignment Complete`)
            .setDescription('Reaction role distribution finished successfully.')
            .addFields(
              { name: `${emojis.team} Role`, value: `${role}`, inline: false },
              { name: `${emojis.correct} Added`, value: String(added), inline: true },
              { name: `${emojis.warning} Skipped`, value: String(skipped), inline: true },
              { name: '🚪 Not In Server', value: String(notInServer), inline: true },
              { name: `${emojis.wrong} Failed`, value: String(failed), inline: true }
            )
        ]
      });
    } catch (error) {
      console.error(error);

      return interaction.editReply(
        '❌ Failed to fetch the message or process reactions.'
      ).catch(() => null);
    }
  }
};