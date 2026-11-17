const TournamentStats = require('../models/TournamentStats');
const HFTournament = require('../models/HFTournament');
const { canSubmitHFResult } = require('../utils/handfootball');
const { refreshAllHFLiveMessages } = require('../utils/handfootballLive');
const { sendStatsSummaryToChannel } = require('../utils/hfStatsSummary');
const { calculateMatchRating } = require('../utils/hfStatsRating');
const E = require('../utils/emojis');

const STAT_PATTERN = /(^|[^\d])(\d{5,25})\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;

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

function getInlineStatsText(message) {
  const content = String(message.content || '').trim();
  const firstSpaceIndex = content.search(/\s/);

  if (firstSpaceIndex === -1) {
    return '';
  }

  return content.slice(firstSpaceIndex + 1).trim();
}

async function getStatsText(message) {
  const targetMessage = await getReferencedMessage(message);
  if (targetMessage) {
    const targetText = collectMessageText(targetMessage).trim();

    if (targetText) {
      return targetText;
    }
  }

  return getInlineStatsText(message);
}

async function getReferencedMessage(message) {
  const referenceId = message.reference?.messageId || message.reference?.message_id;
  if (!referenceId) return null;
  return message.fetchReference().catch(() => (
    message.channel?.messages?.fetch(referenceId).catch(() => null)
  ));
}

function toStatNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function parseRawStats(text) {
  const rowsByUser = new Map();
  const cleanedText = String(text || '').replace(/```(?:\w+)?/g, '');
  let match;

  while ((match = STAT_PATTERN.exec(cleanedText)) !== null) {
    const userId = match[2];
    const current = rowsByUser.get(userId) || {
      userId,
      matches: 1,
      goals: 0,
      assists: 0,
      hattricks: 0,
      interceptions: 0,
      tackles: 0,
      saves: 0
    };

    current.goals += toStatNumber(match[3]);
    current.hattricks = current.goals >= 3 ? 1 : 0;
    current.assists += toStatNumber(match[4]);
    current.interceptions += toStatNumber(match[5]);
    current.tackles += toStatNumber(match[6]);
    current.saves += toStatNumber(match[7]);

    rowsByUser.set(userId, current);
  }

  return [...rowsByUser.values()];
}

function toRecentForm(row, recordedAt) {
  return {
    goals: row.goals,
    assists: row.assists,
    mvps: 0,
    hattricks: row.hattricks,
    interceptions: row.interceptions,
    tackles: row.tackles,
    saves: row.saves,
    recordedAt
  };
}

module.exports = {
  name: 'as',
  aliases: ['allotstats', 'addstats'],

  async execute(message) {
    if (!canSubmitHFResult(message)) {
      return message.reply(`${E.wrong} Only the configured HandFootball result submitter role can use \`.as\`.`);
    }

    const statsText = await getStatsText(message);
    const rows = parseRawStats(statsText);

    if (!rows.length) {
      return message.reply(
        `${E.warning} Reply to a raw stats message with \`.as\`, or paste the raw stats after \`.as\`.`
      );
    }

    const tournament = await HFTournament.findOne({
      guildId: message.guild.id,
      status: { $in: ['registration', 'active'] }
    }).sort({ createdAt: -1 });
    if (!tournament) {
      return message.reply(`${E.missing} Create or activate a Mongo HF tournament before recording stats.`);
    }

    const statsScope = { guildId: message.guild.id, tournamentId: tournament.tournamentId };

    const recordedAt = new Date();
    await TournamentStats.bulkWrite(
      rows.map(row => ({
        updateOne: {
          filter: { ...statsScope, userId: row.userId },
          update: {
            $setOnInsert: { ...statsScope, userId: row.userId },
            $inc: {
              matches: row.matches,
              goals: row.goals,
              assists: row.assists,
              hattricks: row.hattricks,
              interceptions: row.interceptions,
              tackles: row.tackles,
              saves: row.saves
            },
            $push: {
              recentForm: {
                $each: [toRecentForm(row, recordedAt)],
                $slice: -5
              }
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );

    const updatedStats = await TournamentStats.find({ ...statsScope, userId: { $in: rows.map(row => row.userId) } });
    await Promise.all(updatedStats.map(async stats => {
      const entries = (stats.recentForm || []).slice(-5);
      const ratingAverage = entries.length >= 5
        ? Number((entries.reduce((sum, entry) => sum + calculateMatchRating(entry), 0) / entries.length).toFixed(2))
        : null;
      await TournamentStats.updateOne(
        { _id: stats._id },
        { $set: { ratingMatches: stats.matches, ratingAverage } }
      );
    }));

    const sourceMessage = await getReferencedMessage(message);
    const summary = sourceMessage
      ? await sendStatsSummaryToChannel(message, rows, sourceMessage, tournament.statsChannelId).catch(error => ({ error }))
      : null;

    refreshAllHFLiveMessages(message.client, 'stats', message.guild.id)
      .catch(error => console.error('HF live stats refresh after .as failed:', error));

    if (summary?.error) {
      console.error('❌ Failed to send HF stats summary DMs:', summary.error);
    }

    const summaryText = summary?.error
      ? ' Summary DM failed; check the bot logs.'
      : summary
        ? ` Stats log sent to the tournament channel (${summary.sent}/${summary.attempted}).${summary.reason ? ` ${summary.reason}` : ''}`
        : ' No source message was found, so no stats log was sent.';

    return message.reply(`${E.correct} Stats updated.${summaryText}`);
  }
};

module.exports.parseRawStats = parseRawStats;
module.exports.getReferencedMessage = getReferencedMessage;
