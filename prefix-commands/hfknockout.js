const { AttachmentBuilder } = require('discord.js');
const { buildHFKnockoutImage } = require('../utils/hfKnockoutImage');

module.exports = {
  name: 'hfbracket',
  aliases: ['hfdraw', 'hfknockoutview'],
  usesHFTournamentContext: true,
  async execute(message) {
    const image = await buildHFKnockoutImage();
    return message.reply({ files: [new AttachmentBuilder(image, { name: 'hf-knockout.png' })] });
  }
};
