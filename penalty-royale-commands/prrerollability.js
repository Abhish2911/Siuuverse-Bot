const {
  ABILITY_DEFS,
  findActiveGame,
  isManager,
  getPlayer,
  grantRandomAbility,
  notifyAbilityAssignments,
  sendDmFallback,
  refreshGameMessage,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prrerollability',
  aliases: ['prreroll', 'prra'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game in this channel.`);
    if (!isManager(message, game)) return message.reply(`${E.warning} Only the host or a server manager can reroll an ability.`);
    if (game.round !== 1 || game.roundHistory.length) {
      return message.reply(`${E.warning} Abilities can only be rerolled before Round 1 resolves.`);
    }

    const userId = message.mentions.users.first()?.id || args.find(value => /^\d{15,25}$/.test(String(value)));
    const player = getPlayer(game, userId);
    if (!player) return message.reply(`${E.warning} Mention a player who is in this game.`);

    try {
      player.abilities = Object.fromEntries(Object.keys(ABILITY_DEFS).map(key => [key, 0]));
      const ability = grantRandomAbility(player);
      await game.save();
      await refreshGameMessage(client, game).catch(() => null);
      const dmResults = await notifyAbilityAssignments(client, [{ player, ability }]);
      await sendDmFallback(message.channel, dmResults.failedAssignments);
      return message.reply(
        dmResults.delivered
          ? `${E.correct} ${mentionPlayer(player.userId)} received a new secret ability by DM.`
          : `${E.warning} I still could not DM ${mentionPlayer(player.userId)}. Enable DMs and try again.`
      );
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};

function mentionPlayer(userId) {
  return `<@${userId}>`;
}
