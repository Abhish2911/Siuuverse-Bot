const E = require('../utils/emojis');
const { findPlayerByUserId, loadHandFootballData } = require('../utils/handfootball');
const { buildReservationEmbed } = require('../utils/hfReservations');

module.exports = {
  name: 'myreserve',
  aliases: ['myreserves'],

  async execute(message) {
    const data = await loadHandFootballData();
    const player = findPlayerByUserId(data.players, message.author.id);

    if (!player) {
      return message.reply(`${E.missing} You are not registered in a HandFootball team.`);
    }

    return message.reply({
      embeds: [buildReservationEmbed(data, data.fixtures, player.team)],
      allowedMentions: { parse: [] }
    });
  }
};
