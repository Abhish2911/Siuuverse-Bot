const {
  findActiveGame,
  isManager,
  getPlayer,
  grantRandomAbility,
  notifyAbilityAssignments,
  sendDmFallback,
  refreshGameMessage
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

function targetPlayers(message, game, args) {
  const targetToken = String(args[0] || '').trim().toLowerCase();
  const mentionedIds = [...message.mentions.users.values()].map(user => user.id);

  if (!targetToken || targetToken === 'all' || targetToken === 'everyone') {
    return game.players;
  }

  if (!mentionedIds.length) {
    throw new Error('Mention a player or use `all`.');
  }

  const players = mentionedIds
    .map(userId => getPlayer(game, userId))
    .filter(Boolean);
  if (!players.length) throw new Error('That mentioned player is not in this game.');
  return players;
}

module.exports = {
  name: 'prgiveability',
  aliases: ['prga', 'prgive', 'prabilitygive'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game in this channel.`);
    if (!isManager(message, game)) return message.reply(`${E.warning} Only the host or a server manager can grant abilities.`);

    try {
      const players = targetPlayers(message, game, args);
      const assignments = players.map(player => ({
        player,
        ability: grantRandomAbility(player)
      }));
      await game.save();
      await refreshGameMessage(client, game).catch(() => null);
      const dmResults = await notifyAbilityAssignments(client, assignments);
      await sendDmFallback(message.channel, dmResults.failedAssignments);

      const recipients = players.length === game.players.length
        ? 'every player'
        : players.map(player => `<@${player.userId}>`).join(', ');
      return message.reply(
        `${E.correct} Granted a **random secret ability** to ${recipients}. ` +
        `DMs delivered to **${dmResults.delivered}/${assignments.length}** player(s).`
      );
    } catch (error) {
      return message.reply(`${E.warning} ${error.message}`);
    }
  }
};
