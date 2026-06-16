const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const liveStandings2 = require('../utils/liveStandings2');
const standings2 = require('./standings2');
const uclstandings2 = require('./uclstandings2');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlivestandings2')
    .setDescription('Create a live image standings message')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Image type')
        .setRequired(true)
        .addChoices(
          { name: 'League Standings', value: 'standings2' },
          { name: 'UCL Standings', value: 'uclstandings2' }
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return {
        content: '❌ This command can only be used in a server.',
        ephemeral: true
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: '🚫 Owner only command.',
        ephemeral: true
      };
    }

    try {
      console.log('Starting standings2 image generation...');

      const type = interaction.options.getString('type');

      const imageModule = type === 'uclstandings2'
        ? uclstandings2
        : standings2;

      if (typeof imageModule.generateImage !== 'function') {
        throw new Error(`${type}.generateImage() is not exported`);
      }

      const imageBuffer = await imageModule.generateImage();
      console.log('Standings2 image generation completed.');

      const attachment = new AttachmentBuilder(imageBuffer, {
        name: `${type}.png`
      });

      const sent = await interaction.channel.send({
        files: [attachment]
      });

      if (typeof liveStandings2.saveLiveStandings2Config !== 'function') {
        throw new Error('saveLiveStandings2Config is not exported from utils/liveStandings2.js');
      }

      liveStandings2.saveLiveStandings2Config(
        interaction.guild.id,
        {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: sent.id
        },
        type
      );

      if (typeof liveStandings2.startLiveStandings2Updater === 'function') {
        liveStandings2.startLiveStandings2Updater(
          interaction.client,
          interaction.guild.id,
          type
        );
      }

      return {
        content: `✅ Live Standings2 created. Message ID: ${sent.id}`
      };
    } catch (error) {
      console.error(error);
      return {
        content: `❌ Failed to create live standings2: ${error.message}`,
        ephemeral: true
      };
    }
  },

  async restore(client) {
    const guilds = client.guilds.cache.map(g => g.id);
    let restored = false;

    for (const guildId of guilds) {
      for (const type of ['standings2', 'uclstandings2']) {
        try {
          console.log('[Restore] Checking:', guildId, type);

          const config = typeof liveStandings2.getLiveStandings2Config === 'function'
            ? liveStandings2.getLiveStandings2Config(guildId, type)
            : null;

          if (!config) {
            console.log('[Restore] Missing config:', guildId, type);
            continue;
          }

          console.log('[Restore] Found config:', guildId, type, config.messageId);

          if (typeof liveStandings2.startLiveStandings2Updater === 'function') {
            liveStandings2.startLiveStandings2Updater(client, guildId, type);
            restored = true;
          }
        } catch (error) {
          console.error('[Restore] Failed:', guildId, type, error);
        }
      }
    }

    return restored;
  }
};
