const { SlashCommandBuilder } = require('discord.js');
const { translate } = require('../utils/translator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text with Grok')
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Text to translate')
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addStringOption(option =>
      option
        .setName('to')
        .setDescription('Target language (defaults to English)')
        .setRequired(false)
        .setMaxLength(50)
    ),

  async execute(interaction) {
    const text = interaction.options.getString('text', true).trim();
    const targetLanguage = interaction.options.getString('to')?.trim() || 'English';

    if (!interaction.inGuild()) {
      return { content: '❌ Translation is only available in a server.' };
    }
    if (!text) {
      return { content: '❌ Enter some text to translate.' };
    }

    try {
      const embeds = await translate(text, targetLanguage, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id
      });
      await interaction.editReply({ embeds: [embeds[0]] });
      for (const embed of embeds.slice(1)) {
        await interaction.followUp({ embeds: [embed] });
      }
    } catch (error) {
      console.error('❌ Grok slash translation failed:', error);
      if (error.code === 'GROK_ACCESS_DENIED') return { content: error.message };
      if (error.code === 'GROK_CONTROLS_UNAVAILABLE') {
        return { content: '❌ Grok is temporarily unavailable because server settings could not be checked. Please try again later.' };
      }
      return { content: '❌ I could not translate that right now. Please try again later.' };
    }
  }
};
