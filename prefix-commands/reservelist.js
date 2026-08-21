const { buildReservationEmbed } = require('../utils/hfReservations');
const { findTeamByName, loadHandFootballData } = require('../utils/handfootball');

module.exports = {
  name: 'reservelist',
  aliases: ['reserved', 'reserves'],

  async execute(message, args) {
    const data = await loadHandFootballData();
    const query = args.join(' ').trim();
    const team = query ? findTeamByName(data, query) : null;

    return message.reply({
      embeds: [buildReservationEmbed(data, data.fixtures, team?.team || (query ? query : ''))],
      allowedMentions: { parse: [] }
    });
  }
};
