const { findActiveGame, PenaltyRoyaleGame, buildGamePayload } = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prstatus',
  aliases: ['prgame', 'penaltystatus'],

  async execute(message) {
    const game = await findActiveGame(message.guild.id, message.channel.id)
      || await PenaltyRoyaleGame.findOne({
        guildId: message.guild.id,
        channelId: message.channel.id,
        status: 'finished'
      }).sort({ updatedAt: -1 });

    if (!game) return message.reply(`${E.warning} No Penalty Royale game has been played in this channel yet.`);
    return message.reply(buildGamePayload(game, { controls: false }));
  }
};
