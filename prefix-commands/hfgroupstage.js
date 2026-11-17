const { AttachmentBuilder } = require('discord.js');
const { buildHFGroupStageImage } = require('../utils/hfGroupStageImage');

module.exports = {
  name: 'hfgroupstage',
  aliases: ['hfgroups', 'hfgrouptable'],
  usesHFTournamentContext: true,
  async execute(message) {
    const image = await buildHFGroupStageImage();
    return message.reply({ files: [new AttachmentBuilder(image, { name: 'hf-group-stage.png' })] });
  }
};
