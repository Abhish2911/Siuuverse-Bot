const {
  findActiveGame,
  startGame,
  notifyAbilityAssignments,
  sendDmFallback,
  scheduleRoundTimer,
  clearLobbyTimer,
  refreshGameMessage,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prstart',
  aliases: ['startpr'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no Penalty Royale lobby to start.`);

    try {
      const assignments = startGame(game, message);
      await game.save();
      clearLobbyTimer(game._id);
      await refreshGameMessage(client, game).catch(() => null);
      const dmResults = await notifyAbilityAssignments(client, assignments);
      await sendDmFallback(message.channel, dmResults.failedAssignments);
      scheduleRoundTimer(client, game);
      return message.reply(
        `${E.trophy} Penalty Royale has started! <@${game.shooterId}> shoots first. ` +
        `Starting abilities were DM'd to **${dmResults.delivered}/${assignments.length}** player(s); extra abilities require a 3-streak.`
      );
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};
