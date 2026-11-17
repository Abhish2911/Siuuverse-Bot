const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const GrokGuildSettings = require('../models/GrokGuildSettings');
const { getGrokSettings } = require('../utils/grokControls');

const ACTIONS = [
  { name: 'Enable Grok', value: 'enable' },
  { name: 'Disable Grok', value: 'disable' },
  { name: 'Restrict to a channel', value: 'add-channel' },
  { name: 'Remove a channel from the allowlist', value: 'remove-channel' },
  { name: 'Allow all channels', value: 'all-channels' },
  { name: 'Show settings', value: 'status' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('groksettings')
    .setDescription('Configure Grok access for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Setting to change')
        .setRequired(true)
        .addChoices(...ACTIONS)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to add or remove')
        .setRequired(false)
    ),

  async execute(interaction) {
    const respond = content => interaction.reply({
      content,
      ephemeral: true,
      allowedMentions: { parse: [] }
    });

    if (!interaction.inGuild()) {
      return respond('❌ Grok settings can only be used in a server.');
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return respond('❌ You need Manage Server permission to change Grok settings.');
    }

    const action = interaction.options.getString('action', true);
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    try {
      if (action === 'status') {
        const settings = await getGrokSettings(guildId);
        const channelText = settings.channelMode === 'all'
          ? 'All channels'
          : settings.allowedChannelIds.length
            ? settings.allowedChannelIds.map(id => `<#${id}>`).join(', ')
            : 'No channels (Grok is blocked everywhere)';

        return respond([
          `**Grok:** ${settings.enabled ? 'Enabled' : 'Disabled'}`,
          `**Channels:** ${channelText}`
        ].join('\n'));
      }

      if (['add-channel', 'remove-channel'].includes(action) && !channel) {
        return respond('❌ Select a channel for this action.');
      }

      if (action === 'enable') {
        await GrokGuildSettings.findOneAndUpdate(
          { guildId },
          { $set: { enabled: true } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
      } else if (action === 'disable') {
        await GrokGuildSettings.findOneAndUpdate(
          { guildId },
          { $set: { enabled: false } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
      } else if (action === 'add-channel') {
        await GrokGuildSettings.findOneAndUpdate(
          { guildId },
          {
            $set: { channelMode: 'selected' },
            $addToSet: { allowedChannelIds: channel.id }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
      } else if (action === 'remove-channel') {
        await GrokGuildSettings.findOneAndUpdate(
          { guildId },
          {
            $set: { channelMode: 'selected' },
            $pull: { allowedChannelIds: channel.id }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
      } else if (action === 'all-channels') {
        await GrokGuildSettings.findOneAndUpdate(
          { guildId },
          {
            $set: { channelMode: 'all', allowedChannelIds: [] }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
      }

      return respond('✅ Grok settings updated. Use `/groksettings action:status` to review them.');
    } catch (error) {
      console.error('❌ Failed to update Grok server settings:', error);
      return respond('❌ Could not update Grok settings. Check that MongoDB is connected and try again.');
    }
  }
};
