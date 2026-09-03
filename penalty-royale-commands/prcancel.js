const {
  findActiveGame,
  canCancelGame,
  refreshGameMessage,
  clearRoundTimer,
  clearLobbyTimer
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prcancel',
  aliases: ['prstop'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game to cancel.`);
    if (!canCancelGame(message, game)) {
      return message.reply(`${E.warning} Only the host, a server administrator, or the bot owner can cancel this game.`);
    }

    game.status = 'cancelled';
    game.phase = 'finished';
    game.roundDeadlineAt = null;
    game.lobbyDeadlineAt = null;
    game.lastRoundSummary = `${E.cancel} This Penalty Royale game was cancelled.`;
    await game.save();
    clearRoundTimer(game._id);
    clearLobbyTimer(game._id);
    await refreshGameMessage(client, game).catch(() => null);
    return message.reply(`${E.cancel} Penalty Royale cancelled. No stats were recorded.`);
  }
};
