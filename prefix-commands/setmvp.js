const TournamentStats = require('../models/TournamentStats');
const {
  canSubmitHFResult,
  findPlayerByUserId,
  getFirstIdArg,
  getMentionedUserId,
  loadHandFootballData,
  mentionUser
} = require('../utils/handfootball');
const { refreshAllHFLiveMessages } = require('../utils/handfootballLive');
const E = require('../utils/emojis');

function collectMessageText(targetMessage) {
  const parts = [];

  if (targetMessage?.content) {
    parts.push(targetMessage.content);
  }

  for (const embed of targetMessage?.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);

    for (const field of embed.fields || []) {
      if (field.name) parts.push(field.name);
      if (field.value) parts.push(field.value);
    }
  }

  return parts.join('\n');
}

function extractMvpUserId(text) {
  const raw = String(text || '');
  const motmMatch = raw.match(/man\s+of\s+the\s+match[\s\S]*?(?:->|=>|:|→)\s*<@!?(\d{5,25})>/i);
  if (motmMatch) return motmMatch[1];

  const arrowMatch = raw.match(/(?:->|=>|→)\s*<@!?(\d{5,25})>/);
  if (arrowMatch) return arrowMatch[1];

  const mentionMatch = raw.match(/<@!?(\d{5,25})>/);
  if (mentionMatch) return mentionMatch[1];

  const idMatch = raw.match(/\b\d{5,25}\b/);
  return idMatch ? idMatch[0] : '';
}

function extractRating(text) {
  const match = String(text || '').match(/\((\d+(?:\.\d+)?)\s*\/\s*10\)/);
  return match ? match[1] : '';
}

async function getReferenceContext(message) {
  if (!message.reference?.messageId) {
    return { text: '', userId: '', rating: '' };
  }

  const targetMessage = await message.fetchReference().catch(() => null);
  const text = collectMessageText(targetMessage);
  const userId = extractMvpUserId(text) || targetMessage?.mentions?.users?.first()?.id || '';

  return {
    text,
    userId,
    rating: extractRating(text)
  };
}

module.exports = {
  name: 'setmvp',
  aliases: ['mvp', 'setmotm'],

  async execute(message, args) {
    if (!canSubmitHFResult(message)) {
      return message.reply(`${E.wrong} Only the configured HandFootball result submitter role can use \`.setmvp\`.`);
    }

    const directUserId = getMentionedUserId(message) || getFirstIdArg(args);
    const reference = directUserId ? null : await getReferenceContext(message);
    const userId = directUserId || reference?.userId;

    if (!userId) {
      return message.reply(`${E.profile} Usage: reply to a MOTM message with \`.setmvp\`, or use \`.setmvp @user\`.`);
    }

    await TournamentStats.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: { userId },
        $inc: { mvps: 1 }
      },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );

    refreshAllHFLiveMessages(message.client, 'stats')
      .catch(error => console.error('HF live stats refresh after .setmvp failed:', error));

    const data = await loadHandFootballData().catch(() => ({ players: [] }));
    const player = findPlayerByUserId(data.players || [], userId);
    const ratingText = reference?.rating ? ` (${reference.rating}/10)` : '';
    const playerText = player ? `**${player.player}**` : mentionUser(userId);

    return message.reply(`${E.mvp} MVP updated for ${playerText}${ratingText}.`);
  }
};
