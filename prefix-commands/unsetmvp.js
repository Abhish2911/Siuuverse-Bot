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
const { getReferenceContext } = require('./setmvp');
const E = require('../utils/emojis');

module.exports = {
  name: 'unsetmvp',
  aliases: ['removemvp', 'delmvp'],

  async execute(message, args) {
    if (!canSubmitHFResult(message)) {
      return message.reply(`${E.wrong} Only the configured HandFootball result submitter role can use \.unsetmvp\.`);
    }

    const directUserId = getMentionedUserId(message) || getFirstIdArg(args);
    const reference = directUserId ? null : await getReferenceContext(message);
    const userId = directUserId || reference?.userId;
    if (!userId) {
      return message.reply(`${E.profile} Reply to the MOTM message with \.unsetmvp\, or use \.unsetmvp @user\.`);
    }

    const updated = await TournamentStats.findOneAndUpdate(
      { userId, mvps: { $gt: 0 } },
      { $inc: { mvps: -1 } },
      { returnDocument: 'after' }
    ).lean();

    if (!updated) {
      return message.reply(`${E.warning} No MVP was recorded for ${mentionUser(userId)}.`);
    }

    refreshAllHFLiveMessages(message.client, 'stats')
      .catch(error => console.error('HF live stats refresh after .unsetmvp failed:', error));

    const data = await loadHandFootballData().catch(() => ({ players: [] }));
    const player = findPlayerByUserId(data.players || [], userId);
    const playerText = player ? `**${player.player}**` : mentionUser(userId);

    return message.reply(`${E.correct} Removed 1 MVP from ${playerText}.`);
  }
};
