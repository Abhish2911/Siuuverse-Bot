const {
  findActiveGame,
  isManager,
  resolveRound,
  applyGameStats,
  refreshGameMessage,
  scheduleRoundTimer,
  sendRoundMedia,
  notifyAbilityAssignments,
  sendDmFallback,
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
      const resolution = resolveRound(game, { fillMissingPredictions: true });
      await game.save();
      if (game.status === 'finished') await applyGameStats(game);
      await refreshGameMessage(client, game).catch(() => null);
      await sendRoundMedia(message.channel, resolution);
      if (resolution.earnedAbilities?.length) {
        const dmResults = await notifyAbilityAssignments(client, resolution.earnedAbilities);
        await sendDmFallback(message.channel, dmResults.failedAssignments);
      }
      scheduleRoundTimer(client, game);
      return message.reply(`${E.rightArrow} Missing defenders were counted as no prediction and the round was resolved.`);
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};
