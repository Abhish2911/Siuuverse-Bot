const TournamentStats = require('../models/TournamentStats');
const { canSubmitHFResult } = require('../utils/handfootball');
const { refreshAllHFLiveMessages } = require('../utils/handfootballLive');
const E = require('../utils/emojis');

const STAT_PATTERN = /(^|[^\d])(\d{5,25})\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;

const STAT_FIELDS = [
  'matches',
  'goals',
  'assists',
  'interceptions',
  'tackles',
  'saves'
];

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
  if (message.reference?.messageId) {
    const targetMessage = await message.fetchReference().catch(() => null);
    const targetText = collectMessageText(targetMessage).trim();

    if (targetText) {
      return targetText;
    }
  }

  return getInlineStatsText(message);
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
      interceptions: 0,
      tackles: 0,
      saves: 0
    };

    current.goals += toStatNumber(match[3]);
    current.assists += toStatNumber(match[4]);
    current.interceptions += toStatNumber(match[5]);
    current.tackles += toStatNumber(match[6]);
    current.saves += toStatNumber(match[7]);

    rowsByUser.set(userId, current);
  }

  return [...rowsByUser.values()];
}

function subtractStats(existingStats, row) {
  return STAT_FIELDS.reduce((nextStats, field) => {
    const currentValue = Number(existingStats?.[field]) || 0;
    const removeValue = Number(row?.[field]) || 0;

    nextStats[field] = Math.max(0, currentValue - removeValue);
    return nextStats;
  }, {});
}

module.exports = {
  name: 'removestats',
  aliases: ['rs', 'subtractstats', 'undostats'],

  async execute(message) {
    if (!canSubmitHFResult(message)) {
      return message.reply(`${E.wrong} Only the configured HandFootball result submitter role can use \`.rs\`.`);
    }

    const statsText = await getStatsText(message);
    const rows = parseRawStats(statsText);

    if (!rows.length) {
      return message.reply(
        `${E.warning} Reply to a raw stats message with \`.rs\`, or paste the raw stats after \`.rs\`.`
      );
    }

    const savedStats = await TournamentStats.find({
      userId: { $in: rows.map(row => row.userId) }
    }).lean();
    const savedStatsByUser = new Map(savedStats.map(stats => [stats.userId, stats]));

    const operations = rows
      .filter(row => savedStatsByUser.has(row.userId))
      .map(row => ({
        updateOne: {
          filter: { userId: row.userId },
          update: {
            $set: subtractStats(savedStatsByUser.get(row.userId), row)
          }
        }
      }));

    if (!operations.length) {
      return message.reply(`${E.missing} No matching saved stats were found to remove.`);
    }

    await TournamentStats.bulkWrite(operations, { ordered: false });

    refreshAllHFLiveMessages(message.client, 'stats')
      .catch(error => console.error('HF live stats refresh after .rs failed:', error));

    return message.reply(`${E.correct} Stats removed for **${operations.length}** player${operations.length === 1 ? '' : 's'}.`);
  }
};
