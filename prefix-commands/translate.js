const { translate } = require('../utils/translator');

module.exports = {
  name: 'translate',
  aliases: ['tr'],
  usesHFTournamentContext: false,

  async execute(message, args) {
    let targetLanguage = 'English';
    let text = '';
    let referencedMessage = null;
    if (message.reference?.messageId) {
      try {
        referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      } catch (error) {
        console.error('❌ Could not fetch message for translation:', error);
        return message.reply('❌ I could not access the message you replied to.');
      }
    }

    if (referencedMessage && args.length === 0) {
      text = referencedMessage.content.trim();
    } else if (referencedMessage && args.length === 1) {
      targetLanguage = args[0];
      text = referencedMessage.content.trim();
    } else if (args.length > 1 && args[0].toLowerCase() === 'to') {
      targetLanguage = args[1];
      text = args.slice(2).join(' ').trim();
    } else if (args.length > 1) {
      targetLanguage = args[0];
      text = args.slice(1).join(' ').trim();
    } else {
      text = args.join(' ').trim();
    }

    if (!text) {
      return message.reply(
        'Reply to a message with `.translate` to translate it to English, or use `.translate <language> <text>`. Example: `.translate Spanish Hello`.'
      );
    }

    if (!targetLanguage.trim()) {
      return message.reply('Please specify a target language, for example `.translate Spanish Hello`.');
    }

    try {
      await message.channel.sendTyping();
      const embeds = await translate(text, targetLanguage, {
        guildId: message.guild.id,
        channelId: message.channel.id,
        userId: message.author.id
      });
      for (const [index, embed] of embeds.entries()) {
        if (index === 0) {
          await message.reply({ embeds: [embed] });
        } else {
          await message.channel.send({ embeds: [embed] });
        }
      }
    } catch (error) {
      console.error('❌ Grok translation failed:', error);
      if (['GROK_ACCESS_DENIED', 'GROK_CONTROLS_UNAVAILABLE'].includes(error.code)) {
        return message.reply(
          error.code === 'GROK_CONTROLS_UNAVAILABLE'
            ? '❌ Grok is temporarily unavailable because server settings could not be checked. Please try again later.'
            : error.message
        );
      }
      await message.reply('❌ I could not translate that right now. Please try again later.');
    }
  }
};
