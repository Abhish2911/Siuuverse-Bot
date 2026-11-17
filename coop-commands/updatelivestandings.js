const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { refreshLiveStandings } = require('../utils/liveStandings');
const { refreshLiveStandings2 } = require('../utils/liveStandings2');
const E = require('../utils/emojis');

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return (
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id
  );
}

function buildUpdateSummary(interaction, result = null) {
  return {
    channel: interaction?.channel ? `<#${interaction.channel.id}>` : 'N/A',
    type: 'COOP League',
    status: result?.ok ? 'Live standings refreshed successfully' : 'Refresh failed',
    reason: result?.reason || 'Updated successfully'
  };
}

function buildUpdateDescription(summary, isSuccess = true) {
  if (isSuccess) {
    return (
      `🔄 **Live Standings Refreshed**\n` +
      `The saved COOP live standings message was refreshed successfully.\n\n` +
      `📢 **Triggered From:** ${summary.channel}\n` +
      `🏷️ **Type:** ${summary.type}\n` +
      `✅ **Status:** ${summary.status}\n` +
      `📌 **Result:** ${summary.reason}`
    );
  }

  return (
    `❌ **Live Standings Refresh Failed**\n` +
    `The saved COOP live standings message could not be refreshed.\n\n` +
    `📢 **Triggered From:** ${summary.channel}\n` +
    `🏷️ **Type:** ${summary.type}\n` +
    `⚠️ **Status:** ${summary.status}\n` +
    `📌 **Reason:** ${summary.reason}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updatelivestandings')
    .setDescription('Owner only: refresh a saved live standings message')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Standings type to refresh')
        .setRequired(true)
        .addChoices(
          { name: 'COOP League Embed', value: 'coop_league' },
          { name: 'League Image (standings2)', value: 'standings2' },
          { name: 'UCL Image (uclstandings2)', value: 'uclstandings2' }
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return {
        content: `${E.wrong} This command can only be used inside a server.`,
        ephemeral: true
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: `${E.lock} Owner only command.`,
        ephemeral: true
      };
    }

    const type = interaction.options.getString('type');

    const result = type === 'coop_league'
      ? await refreshLiveStandings(interaction.client, interaction.guild.id, 'coop_league')
      : await refreshLiveStandings2(interaction.client, interaction.guild.id, type);

    const summary = buildUpdateSummary(interaction, result);
    summary.type =
      type === 'uclstandings2'
        ? 'UCL Image Standings'
        : type === 'standings2'
          ? 'League Image Standings'
          : 'COOP League';

    if (!result.ok) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ COOP Live Standings Update Failed')
            .setDescription(buildUpdateDescription(summary, false))
            .addFields(
              { name: '📢 Triggered From', value: summary.channel, inline: true },
              { name: '🏷️ Type', value: summary.type, inline: true },
              { name: '📌 Reason', value: summary.reason, inline: false }
            )
            .setColor(0xE74C3C)
            .setFooter({ text: 'Live Standings Refresh • Update failed' })
        ],
        ephemeral: true
      };
    }

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ COOP Live Standings Updated')
          .setDescription(buildUpdateDescription(summary, true))
          .addFields(
            { name: '📢 Triggered From', value: summary.channel, inline: true },
            { name: '🏷️ Type', value: summary.type, inline: true },
            { name: '📌 Result', value: summary.reason, inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Live Standings Refresh • Update completed successfully' })
      ],
      ephemeral: true
    };
  }
};