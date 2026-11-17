const { AttachmentBuilder } = require('discord.js');
const { buildHFStandingsImage } = require('../utils/hfStandingsImage');
const E = require('../utils/emojis');
const { getActiveHFTournament } = require('../utils/hfTournamentConfig');

module.exports = {
  name: 'hfstandings',
  aliases: ['hftable', 'handfootballstandings'],

  async execute(message) {
    const buffer = await buildHFStandingsImage();
    const attachment = new AttachmentBuilder(buffer, { name: 'hf-standings.png' });
    const leagueName = getActiveHFTournament().leagueName || 'HandFootball League';
    const unix = Math.floor(Date.now() / 1000);

    return message.reply({
      content: `${E.league} **${leagueName} — HF Standings**\n${E.calendar} Updated: <t:${unix}:R>`,
      files: [attachment]
    });
  }
};
