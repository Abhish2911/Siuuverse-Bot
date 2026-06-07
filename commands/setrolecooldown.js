const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const RoleCooldown = require('../models/rolehandler');

function parseDuration(input) {
  const match = input.match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setrolecooldown')
    .setDescription('Set a cooldown for a role mention.')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to configure')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Examples: 30m, 12h, 1d')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const duration = interaction.options.getString('duration');

    const cooldownMs = parseDuration(duration);

    if (!cooldownMs) {
      return interaction.reply({
        content: '❌ Invalid duration. Use formats like 30m, 12h, or 1d.',
        ephemeral: true
      });
    }

    await RoleCooldown.findOneAndUpdate(
      {
        guildId: interaction.guild.id,
        roleId: role.id
      },
      {
        cooldownMs
      },
      {
        upsert: true,
        new: true
      }
    );

    return interaction.reply({
      content: `✅ Cooldown for ${role} set to ${duration}.`
    });
  }
};
