const {
  findActiveGame,
  isManager,
  resolveAndPublishRound,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prresolve',
  aliases: ['prforce'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game in this channel.`);
    if (!isManager(message, game)) return message.reply(`${E.warning} Only the host or a server manager can force-resolve a round.`);

    try {
      if (game.status === 'shooting') {
        return message.reply(`${E.warning} Wait for the shooter and goalkeeper phase, or let its timer advance to predictors.`);
      }
      await resolveAndPublishRound(client, game, message.channel);
      return message.reply(`${E.rightArrow} Missing defenders were counted as no prediction and the round was resolved.`);
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};
