const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const { invalidateSheetCache, sendAuditLog } = require('../utils/helpers');

function isAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasRole = interaction.member?.roles?.cache?.some(role =>
    adminRoleIds.includes(role.id)
  );

  return isOwner || hasRole;
}

const normalize = (value) => String(value || '').trim().toLowerCase();

function buildRemoveTeamSummary(team) {
  const players = String(team?.[1] || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  return {
    teamName: String(team?.[0] || 'Unknown Team'),
    shortName: String(team?.[2] || 'N/A'),
    captainId: String(team?.[4] || 'N/A'),
    players: players.join(', ') || 'None',
    playerCount: players.length
  };
}

function buildRemoveSelectDescription(teamCount) {
  return (
    `🗑️ **Remove Team**\n` +
    `Select a team from the dropdown below to continue.\n\n` +
    `📌 **Available Teams:** ${teamCount}\n` +
    `⚠️ **Warning:** This action removes the team entry from the Teams sheet.`
  );
}

function buildRemovePreviewDescription(summary) {
  return (
    `⚠️ **Confirm Team Removal**\n` +
    `Review the team details before deleting it from the Teams sheet.\n\n` +
    `🏷️ **Team:** ${summary.teamName}\n` +
    `🔤 **Short Name:** ${summary.shortName}\n` +
    `👑 **Captain ID:** ${summary.captainId}\n` +
    `👥 **Players:** ${summary.playerCount}`
  );
}

function buildRemoveSuccessDescription(summary) {
  return (
    `🗑️ **Team Removed Successfully**\n` +
    `The selected team was removed from the Teams sheet.\n\n` +
    `🏷️ **Team:** ${summary.teamName}\n` +
    `🔤 **Short Name:** ${summary.shortName}\n` +
    `👑 **Captain ID:** ${summary.captainId}\n` +
    `👥 **Players Removed:** ${summary.playerCount}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeteam')
    .setDescription('Remove a team'),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.' };
    }

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];

    if (!rows.length) {
      return { content: '❌ No teams found.' };
    }

    const options = rows.slice(0, 25).map((r, index) => ({
      label: String(r[0]).slice(0, 100),
      value: String(index),
      description: `Short: ${String(r[2] || 'N/A').slice(0, 90)}`
    }));

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Remove Team')
      .setDescription(buildRemoveSelectDescription(rows.length))
      .setColor(0xE74C3C)
      .setFooter({ text: 'Remove Team • Admin only action' });

    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('removeteam_select')
        .setPlaceholder('Select a team to remove')
        .addOptions(options)
    );

    return {
      embeds: [embed],
      components: [dropdown]
    };
  },

  async selectHandler(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', components: [] };
    }

    const indexValue = interaction.values[0];
    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];
    const index = Number(indexValue);
    const team = Number.isInteger(index) ? rows[index] : null;

    if (!team) {
      return { content: '❌ Team not found.', components: [] };
    }

    const summary = buildRemoveTeamSummary(team);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Team Removal')
      .setDescription(buildRemovePreviewDescription(summary))
      .addFields(
        { name: '🔤 Short Name', value: summary.shortName, inline: true },
        { name: '👑 Captain ID', value: summary.captainId, inline: true },
        { name: '👥 Players', value: summary.players.slice(0, 1024) || 'None', inline: false }
      )
      .setColor(0xE67E22)
      .setFooter({ text: 'Remove Team • This action cannot be undone' });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`removeteam_confirm_${index}`)
        .setLabel('✅ Yes, Remove')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('removeteam_cancel_keep')
        .setLabel('❌ No, Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttons]
    };
  },

  async buttonHandler(interaction, action, value, extra) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', components: [] };
    }

    if (action === 'cancel') {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('❎ Team Removal Cancelled')
            .setDescription('No team was removed.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const target = extra || value;
    const index = Number(target);

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1) : [];
    const teamRows = rows.filter(r => r[0]);
    const teamToRemove = Number.isInteger(index) ? teamRows[index] : null;

    if (!teamToRemove) {
      return { content: '❌ Team not found.', components: [] };
    }

    const summary = buildRemoveTeamSummary(teamToRemove);

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Removing Team...')
          .setDescription(`Removing **${summary.teamName}** from the Teams sheet.`)
          .setColor(0xE67E22)
      ],
      components: []
    });

    const filtered = teamRows.filter((_, i) => i !== index);

    const outputRows = [...filtered];
    while (outputRows.length < teamRows.length) {
      outputRows.push(['', '', '', '', '', '']);
    }

    await updateData('Teams!A2:F', outputRows);
    invalidateSheetCache(['Teams!']);

    sendAuditLog(interaction, {
      title: '🗑️ Team Removed',
      description: `**${summary.teamName}** was removed.`,
      color: 0xE74C3C,
      fields: [
        { name: '🔤 Short', value: summary.shortName, inline: true },
        { name: '👑 Captain ID', value: summary.captainId, inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('🗑️ Team Removed')
          .setDescription(buildRemoveSuccessDescription(summary))
          .addFields(
            { name: '🔤 Short Name', value: summary.shortName, inline: true },
            { name: '👑 Captain ID', value: summary.captainId, inline: true },
            { name: '👥 Players', value: summary.players.slice(0, 1024) || 'None', inline: false }
          )
          .setColor(0xE74C3C)
          .setFooter({ text: 'Remove Team • Team removed successfully from Teams sheet' })
      ],
      components: []
    };
  }
};