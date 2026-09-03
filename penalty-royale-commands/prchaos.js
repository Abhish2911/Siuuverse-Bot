const {
  CHAOS_DEFS,
  findActiveGame,
  isManager,
  armChaosRound,
  refreshGameMessage,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prchaos',
  aliases: ['chaospr'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game in this channel.`);
    if (!isManager(message, game)) return message.reply(`${E.warning} Only the host or a server manager can arm a chaos round.`);

    try {
      const mode = armChaosRound(game, args[0] || 'random');
      await game.save();
      await refreshGameMessage(client, game).catch(() => null);
      const chaos = CHAOS_DEFS[mode];
      const roundLabel = game.status === 'lobby'
        ? 'selected for the **full match**'
        : `armed for **Round ${game.round}**`;
      return message.reply(`${chaos.emoji} **${chaos.label}** is ${roundLabel}: ${chaos.description}`);
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};
