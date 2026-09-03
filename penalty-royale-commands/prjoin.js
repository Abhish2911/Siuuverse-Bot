const {
  findActiveGame,
  addPlayer,
  displayName,
  refreshGameMessage,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prjoin',
  aliases: ['joinpr'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale lobby or game in this channel. Start one with `.prcreate`.`);

    try {
      const team = args[0];
      const assignedTeam = addPlayer(game, {
        userId: message.author.id,
        name: displayName(message.member || message.author),
        team
      });
      await game.save();
      await refreshGameMessage(client, game).catch(() => null);
      return message.reply(`${E.goal} You joined **Penalty Royale**${assignedTeam ? ` on **Team ${assignedTeam}**` : ''}!`);
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  }
};
