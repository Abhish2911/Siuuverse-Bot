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

const pendingLogoUpdates = new Map();

function isBotOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return ownerIds.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;
}

const normalize = v => String(v || '').trim().toLowerCase();

const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

function buildLogoSummary(team, logo, previousLogo) {
  return {
    teamName: String(team?.[0] || 'Unknown Team'),
    shortName: String(team?.[2] || 'N/A'),
    captainId: String(team?.[4] || 'N/A'),
    logo,
    previousLogo: previousLogo || 'None'
  };
}

function buildLogoSelectDescription(logo, count) {
  return (
    `🖼️ **Select Team Logo Target**\n` +
    `Choose which team should receive this logo.\n\n` +
    `🔗 **Logo URL:** ${logo}\n` +
    `📌 **Available Teams:** ${count}`
  );
}

function buildLogoPreviewDescription(summary) {
  return (
    `⚠️ **Confirm Logo Update**\n` +
    `Review the team branding change before saving it.\n\n` +
    `🏷️ **Team:** ${summary.teamName}\n` +
    `🔤 **Short Name:** ${summary.shortName}\n` +
    `👑 **Captain ID:** ${summary.captainId}\n` +
    `🔗 **New Logo:** ${summary.logo}\n` +
    `ℹ️ **Previous Logo:** ${summary.previousLogo}`
  );
}

function buildLogoSuccessDescription(summary) {
  return (
    `🖼️ **Team Logo Updated**\n` +
    `The team branding was updated successfully.\n\n` +
    `🏷️ **Team:** ${summary.teamName}\n` +
    `🔤 **Short Name:** ${summary.shortName}\n` +
    `👑 **Captain ID:** ${summary.captainId}\n` +
    `🔗 **New Logo:** ${summary.logo}\n` +
    `ℹ️ **Previous Logo:** ${summary.previousLogo}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addteamlogo')
    .setDescription('Add or update team logo')
    .addStringOption(option =>
      option
        .setName('logo')
        .setDescription('Logo URL')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isBotOwner(interaction)) {
      return { content: '🚫 Owner only command.' };
    }

    const logo = String(interaction.options.getString('logo') || '').trim();

    if (!isValidUrl(logo) || !/^https?:\/\//i.test(logo)) {
      return { content: '❌ Please provide a valid http/https logo URL.' };
    }

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];

    if (!rows.length) {
      return { content: '❌ No teams found.' };
    }

    pendingLogoUpdates.set(interaction.user.id, {
      logo,
      createdAt: Date.now()
    });

    const options = rows.slice(0, 25).map((row, index) => ({
      label: String(row[0]).slice(0, 100),
      value: String(index),
      description: `Short: ${String(row[2] || 'N/A').slice(0, 90)}`
    }));

    const embed = new EmbedBuilder()
      .setTitle('🖼️ Select Team Logo Target')
      .setDescription(buildLogoSelectDescription(logo, rows.length))
      .setThumbnail(logo)
      .setColor(0x3498DB)
      .setFooter({ text: 'Add Team Logo • Select a team to continue' });

    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('addteamlogo_select')
        .setPlaceholder('Select team')
        .addOptions(options)
    );

    return {
      embeds: [embed],
      components: [dropdown]
    };
  },

  async selectHandler(interaction) {
    if (!isBotOwner(interaction)) {
      return { content: '🚫 Owner only command.', components: [] };
    }

    const pending = pendingLogoUpdates.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Logo update expired. Run /addteamlogo again.', components: [] };
    }

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];
    const index = Number(interaction.values[0]);
    const team = Number.isInteger(index) ? rows[index] : null;

    if (!team) {
      return { content: '❌ Team not found.', components: [] };
    }

    const summary = buildLogoSummary(team, pending.logo, String(team[3] || '').trim());

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Logo Update')
      .setDescription(buildLogoPreviewDescription(summary))
      .setThumbnail(pending.logo)
      .setColor(0xE67E22)
      .setFooter({ text: 'Add Team Logo • Confirm to overwrite team logo' });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`addteamlogo_confirm_${index}`)
        .setLabel('✅ Yes, Update')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('addteamlogo_cancel_keep')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttons]
    };
  },

  async buttonHandler(interaction, action, value) {
    if (!isBotOwner(interaction)) {
      return { content: '🚫 Owner only command.', components: [] };
    }

    if (action === 'cancel') {
      pendingLogoUpdates.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('❎ Logo Update Cancelled')
            .setDescription('No logo was changed.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const pending = pendingLogoUpdates.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Logo update expired. Run /addteamlogo again.', components: [] };
    }

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1) : [];
    const filteredRows = rows.filter(r => r[0]);
    const index = Number(value);
    const selectedTeam = Number.isInteger(index) ? filteredRows[index] : null;

    if (!selectedTeam) {
      return { content: '❌ Team not found.', components: [] };
    }

    const realIndex = rows.findIndex(r => normalize(r[0]) === normalize(selectedTeam[0]));
    if (realIndex === -1) {
      return { content: '❌ Team not found.', components: [] };
    }

    while (rows[realIndex].length < 6) rows[realIndex].push('');

    const previousLogo = rows[realIndex][3] || '';
    rows[realIndex][3] = pending.logo;

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Updating Logo...')
          .setDescription(`Updating logo for **${rows[realIndex][0]}**.`)
          .setColor(0xE67E22)
      ],
      components: []
    });

    await updateData('Teams!A2:F', rows);
    invalidateSheetCache(['Teams!']);
    pendingLogoUpdates.delete(interaction.user.id);

    sendAuditLog(interaction, {
      title: '🖼️ Team Logo Updated',
      description: `Logo updated for **${rows[realIndex][0]}**.`,
      color: 0x2ECC71,
      fields: [
        { name: '🔤 Short Name', value: String(rows[realIndex][2] || 'N/A'), inline: true },
        { name: '👑 Captain ID', value: String(rows[realIndex][4] || 'N/A'), inline: true },
        { name: '🔗 New Logo', value: pending.logo, inline: false },
        { name: 'ℹ️ Previous Logo', value: previousLogo || 'None', inline: false }
      ]
    });

    const summary = buildLogoSummary(rows[realIndex], pending.logo, previousLogo);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('🖼️ Team Logo Updated')
          .setDescription(buildLogoSuccessDescription(summary))
          .setThumbnail(pending.logo)
          .setColor(0x2ECC71)
          .setFooter({ text: 'Add Team Logo • Team branding updated successfully' })
      ],
      components: []
    };
  }
};