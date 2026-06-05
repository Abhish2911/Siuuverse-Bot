const { SlashCommandBuilder } = require('discord.js');
const { sendAuditLog } = require('../utils/helpers');
const {
  buildLiveStandingsEmbed,
  saveLiveStandingsConfig,
  startLiveStandingsUpdater
} = require('../utils/liveStandings');

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

async function finishInteraction(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return null;
  }

  await interaction.reply(payload);
  return null;
}

function buildLiveStandingsSetupSummary(interaction, sent = null) {
  return {
    channel: interaction?.channel ? `<#${interaction.channel.id}>` : 'N/A',
    messageId: sent?.id || 'Pending',
    type: 'COOP League',
    status: sent ? 'Live standings updater active' : 'Ready to create/update live standings'
  };
}

function buildLiveStandingsSetupDescription(summary, isCreated = false) {
  if (isCreated) {
    return (
      `🏆 **Live Standings Configured**\n` +
      `The bot will keep one COOP live standings message updated automatically in the selected channel.\n\n` +
      `📢 **Channel:** ${summary.channel}\n` +
      `🏷️ **Type:** ${summary.type}\n` +
      `🆔 **Message ID:** ${summary.messageId}\n` +
      `✅ **Status:** ${summary.status}`
    );
  }

  return (
    `🏆 **Live Standings Setup**\n` +
    `Creates or replaces the live standings message and keeps it refreshed automatically.\n\n` +
    `📢 **Channel:** ${summary.channel}\n` +
    `🏷️ **Type:** ${summary.type}\n` +
    `📌 **Status:** ${summary.status}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlivestandings')
    .setDescription('Owner only: create or replace a live standings message')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Standings type')
        .setRequired(true)
        .addChoices(
          { name: 'League', value: 'coop_league' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return finishInteraction(interaction, {
        content: '❌ This command can only be used inside a server.',
        ephemeral: true
      });
    }

    if (!isOwner(interaction)) {
      return finishInteraction(interaction, {
        content: '🚫 Owner only command.',
        ephemeral: true
      });
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    try {
      const setupPreview = buildLiveStandingsSetupSummary(interaction);
      const standingsType = interaction.options.getString('type') || 'coop_league';
      const embed = await buildLiveStandingsEmbed(standingsType);
      console.log(`📊 Creating live standings message type: ${standingsType}`);
      const sent = await interaction.channel.send({ embeds: [embed] });
      const setupSummary = buildLiveStandingsSetupSummary(interaction, sent);
      setupSummary.type = standingsType === 'ucl' ? 'UCL Group Stage' : 'COOP League';

      saveLiveStandingsConfig(interaction.guild.id, {
        channelId: interaction.channel.id,
        messageId: sent.id,
        type: standingsType
      });

      try {
        startLiveStandingsUpdater(interaction.client, interaction.guild.id, standingsType);
      } catch (error) {
        console.error('❌ Live standings updater start error:', error);
      }

      sendAuditLog(interaction, {
        title: `🏆 ${setupSummary.type} Live Standings Set`,
        description: `${standingsType === 'ucl' ? 'UCL' : 'League'} live standings message was created in <#${interaction.channel.id}> and live updates were started.`,
        color: 0x5865F2,
        fields: [
          { name: '📢 Channel', value: `<#${interaction.channel.id}>`, inline: true },
          { name: '🆔 Message ID', value: sent.id, inline: true }
        ]
      });

      return finishInteraction(interaction, {
        embeds: [
          new (require('discord.js').EmbedBuilder)()
            .setTitle(`✅ ${setupSummary.type} Live Standings Set`)
            .setDescription(buildLiveStandingsSetupDescription(setupSummary, true))
            .addFields(
              { name: '📢 Channel', value: setupSummary.channel, inline: true },
              { name: '🏷️ Type', value: setupSummary.type, inline: true },
              { name: '🆔 Message ID', value: setupSummary.messageId, inline: true }
            )
            .setColor(0x2ECC71)
            .setFooter({ text: 'Live Standings Setup • Auto-refresh enabled' })
        ]
      });
    } catch (error) {
      console.error('❌ Set live standings error:', error);
      return finishInteraction(interaction, {
        content: `❌ Failed to set live standings: ${error.message}`
      });
    }
  },

  async restore(client) {
    try {
      if (typeof startLiveStandingsUpdater !== 'function') {
        console.error('❌ Restore live standings error: startLiveStandingsUpdater is not exported from utils/liveStandings.js');
        return false;
      }

      const guilds = client.guilds.cache.map(g => g.id);
      let restored = false;

      for (const guildId of guilds) {
        const leagueOk = startLiveStandingsUpdater(client, guildId, 'coop_league');
        if (leagueOk) restored = true;
        const uclOk = startLiveStandingsUpdater(client, guildId, 'ucl');
        if (uclOk) restored = true;
      }

      return restored;
    } catch (error) {
      console.error('❌ Restore live standings error:', error);
      return false;
    }
  }
};
