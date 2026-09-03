const {
  createGame,
  displayName,
  buildGamePayload,
  scheduleLobbyTimer,
  handleButton,
  GameActionError
} = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

function parseMode(input) {
  const value = String(input || 'royale').trim().toLowerCase();
  if (['royale', 'r', 'solo'].includes(value)) return 'royale';
  if (['teams', 'team', '4v4'].includes(value)) return 'teams';
  return '';
}

function parseSettings(mode, args) {
  const positional = [];
  let lives = 3;
  let timer = 30;

  for (const raw of args) {
    const token = String(raw || '').trim().toLowerCase();
    const livesMatch = token.match(/^(?:lives?|l)=(\d+)$/);
    const timerMatch = token.match(/^(?:timer|time|t)=(\d+)$/);
    if (livesMatch) {
      lives = Number(livesMatch[1]);
    } else if (timerMatch) {
      timer = Number(timerMatch[1]);
    } else if (/^\d+$/.test(token)) {
      positional.push(Number(token));
    } else {
      throw new GameActionError('Use numbers or `lives=<1–5>` / `timer=<10–120>`.');
    }
  }

  if (mode === 'teams') {
    if (positional.length > 1) throw new GameActionError('Team mode accepts one optional timer: `.prcreate teams 45`.');
    if (positional.length) timer = positional[0];
  } else {
    if (positional.length > 2) throw new GameActionError('Royale accepts lives and timer: `.prcreate royale 5 45`.');
    if (positional[0] !== undefined) lives = positional[0];
    if (positional[1] !== undefined) timer = positional[1];
  }

  if (!Number.isInteger(timer) || timer < 10 || timer > 120) {
    throw new GameActionError('Round timer must be between 10 and 120 seconds.');
  }
  if (!Number.isInteger(lives) || lives < 1 || lives > 5) {
    throw new GameActionError('Royale lives must be between 1 and 5.');
  }

  return { startingLives: lives, roundTimeoutSeconds: timer };
}

module.exports = {
  name: 'prcreate',
  aliases: ['prnew', 'penaltyroyale', 'pr'],

  async execute(message, args, client) {
    const mode = parseMode(args[0]);
    if (!mode) {
      return message.reply('Usage: `.prcreate [royale|teams] [settings]` — examples: `.prcreate royale 5 45` or `.prcreate teams 45`.');
    }

    try {
      const settings = parseSettings(mode, args.slice(1));
      const game = await createGame({
        guildId: message.guild.id,
        channelId: message.channel.id,
        hostId: message.author.id,
        hostName: displayName(message.member || message.author),
        mode,
        ...settings
      });
      const gameMessage = await message.reply(buildGamePayload(game));
      game.messageId = gameMessage.id;
      await game.save();
      scheduleLobbyTimer(client || message.client, game);
      return null;
    } catch (error) {
      if (error instanceof GameActionError) return message.reply(`${E.warning} ${error.message}`);
      throw error;
    }
  },

  buttonHandler: handleButton
};
