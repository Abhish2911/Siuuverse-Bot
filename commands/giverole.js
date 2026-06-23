const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('Give a role to one or multiple users')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to give')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('users')
        .setDescription('Mention users separated by spaces')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({
        content: `${E.wrong} Manage Roles permission required.`
      }).catch(() => null);
    }
    const role = interaction.options.getRole('role');

    const usersInput = interaction.options.getString('users');

    const userIds = [...usersInput.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription(
            [
              `${E.profile} **Role Distribution Started**`,
              '',
              `${E.team} Role: ${role}`,
              `${E.captain} Users Detected: **${userIds.length}**`,
              '',
              '⏳ Processing role assignment...'
            ].join('\n')
          )
      ]
    });

    if (!userIds.length) {
      return interaction.editReply({
        content: '❌ Mention at least one valid user.'
      });
    }

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        const member = await interaction.guild.members.fetch(userId);

        if (member.roles.cache.has(role.id)) {
          skipped++;
          continue;
        }

        await member.roles.add(role);
        added++;
      } catch (err) {
        console.error(err);
        failed++;
      }
    }

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${E.trophy_animated} Role Assignment Complete`)
          .setDescription(
            [
              `${E.correct} Bulk role distribution finished successfully.`,
              '',
              `${E.team} **Role:** ${role}`,
              `${E.captain} **Users Processed:** ${userIds.length}`
            ].join('\n')
          )
          .addFields(
            {
              name: `${E.correct} Added`,
              value: String(added),
              inline: true
            },
            {
              name: `${E.warning} Skipped`,
              value: String(skipped),
              inline: true
            },
            {
              name: `${E.wrong} Failed`,
              value: String(failed),
              inline: true
            }
          )
      ]
    });
  }
};
