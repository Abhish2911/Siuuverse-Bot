const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('Send a custom DM to players')
    .addStringOption(opt =>
      opt
        .setName('message')
        .setDescription('Message to send')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('target')
        .setDescription('Who should receive the DM')
        .setRequired(false)
        .addChoices(
          { name: 'All Players', value: 'all' },
          { name: 'UCL Teams', value: 'ucl' },
          { name: 'FA Cup Teams', value: 'fa' },
          { name: 'Carabao Teams', value: 'carabao' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('team')
        .setDescription('Send only to one team short name (optional)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('embed')
        .setDescription('Send as embed (default true)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    const target = interaction.options.getString('target') || 'all';
    const teamFilter = interaction.options.getString('team');

    const useEmbed = interaction.options.getBoolean('embed');

    const ownerIds = String(process.env.OWNER_IDS || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    const isOwner =
      ownerIds.includes(interaction.user.id) ||
      interaction.guild?.ownerId === interaction.user.id;

    const hasAdminRole = interaction.member?.roles?.cache?.some(role =>
      adminRoleIds.includes(role.id)
    );

    if (!isOwner && !hasAdminRole) {
      return {
        content: '❌ Admin only command.'
      };
    }

    await interaction.editReply({
      content: '📨 DM campaign started...'
    });

    const teams = await cachedGetData('Teams!A:Z');

    let delivered = 0;
    let failed = 0;

    const recipients = new Set();

    for (const row of teams.slice(1)) {
      const teamName = String(row[0] || '').trim();
      const shortName = String(row[2] || '').trim();

      if (teamFilter) {
        const search = teamFilter.toLowerCase();

        if (
          shortName.toLowerCase() !== search &&
          teamName.toLowerCase() !== search
        ) {
          continue;
        }
      }

      if (target === 'ucl' && String(row[10] || '').trim().toLowerCase() !== 'yes') continue;
      if (target === 'fa' && String(row[8] || '').trim().toLowerCase() !== 'yes') continue;
      if (target === 'carabao' && String(row[9] || '').trim().toLowerCase() !== 'yes') continue;

      const captain = String(row[4] || '').trim();

      if (captain) recipients.add(captain);

      String(row[5] || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .forEach(id => recipients.add(id));
    }

    for (const userId of recipients) {
      try {
        const user = await interaction.client.users.fetch(userId);

        if (useEmbed === false) {
          await user.send(message);
        } else {
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📢 Announcement')
                .setDescription(message)
                .setFooter({
                  text: `Sent by ${interaction.user.username}`
                })
            ]
          });
        }

        delivered++;
      } catch {
        failed++;
      }
    }

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle(`${E.correct || '✅'} DM Campaign Done`)
          .addFields(
            { name: 'Delivered', value: String(delivered), inline: true },
            { name: 'Failed', value: String(failed), inline: true },
            { name: 'Recipients', value: String(recipients.size), inline: true },
            {
              name: 'Target',
              value: teamFilter || target,
              inline: true
            }
          )
      ]
    };
  }
};
