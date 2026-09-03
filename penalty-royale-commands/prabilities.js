const {
  findActiveGame,
  getPlayer,
  sendAbilityInventory
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

module.exports = {
  name: 'prabilities',
  aliases: ['prpowers', 'prpowerups'],

  async execute(message, args, client) {
    const game = await findActiveGame(message.guild.id, message.channel.id);
    if (!game) return message.reply(`${E.warning} There is no active Penalty Royale game in this channel.`);

    const mentionedId = message.mentions.users.first()?.id;
    if (mentionedId && mentionedId !== message.author.id) {
      return message.reply(`${E.warning} Ability inventories are secret. Players can only view their own.`);
    }

    const player = getPlayer(game, message.author.id);
    if (!player) return message.reply(`${E.warning} That player is not in this game.`);

    const delivered = await sendAbilityInventory(client, player);
    if (!delivered) {
      return message.reply(`${E.warning} I could not DM you. Enable DMs from server members, then try again.`);
    }
    return message.reply(`${E.correct} Your secret ability inventory was sent by DM.`);
  }
};
