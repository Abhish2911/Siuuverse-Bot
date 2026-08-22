const { EmbedBuilder } = require('discord.js');
const TournamentStats = require('../models/TournamentStats');
const E = require('../utils/emojis');
const {
  loadHandFootballData,
  findPlayerByUserId,
  findPlayerByName,
  mentionUser,
  getMentionedUserId,
  getFirstIdArg,
  getSearchText
} = require('../utils/handfootball');

const ZERO_STATS = {
  matches: 0,
  goals: 0,
  assists: 0,
  mvps: 0,
  hattricks: 0,
  interceptions: 0,
  tackles: 0,
  saves: 0
};

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calculatePerformanceRating(stats) {
  const matches = toNumber(stats.matches);
  if (matches <= 0) return 0;

  const attackingPoints =
    toNumber(stats.goals) * 4 +
    toNumber(stats.assists) * 3 +
    toNumber(stats.hattricks) * 2 +
    toNumber(stats.mvps) * 3;
  const defensivePoints =
    toNumber(stats.interceptions) +
    toNumber(stats.tackles) +
    toNumber(stats.saves);

  const rating = 3 +
    (attackingPoints / matches) * 0.6 +
    (defensivePoints / matches) * 0.9;

  return Math.min(10, Math.max(0, Number(rating.toFixed(2))));
}

function buildStatLine(emoji, label, value) {
  const spacing = '\u00a0';
  return `${emoji || '•'} \`${label.padEnd(16, spacing)}${String(value).padStart(5, spacing)}\``;
}

function resolvePlayer(data, message, args) {
  const mentionedUserId = getMentionedUserId(message);
  const idArg = getFirstIdArg(args);
  const searchText = getSearchText(args);

  if (mentionedUserId || idArg) {
    return findPlayerByUserId(data.players, mentionedUserId || idArg);
  }

  if (searchText) {
    return findPlayerByName(data.players, searchText);
  }

  return findPlayerByUserId(data.players, message.author.id);
}

async function getAvatarUrl(client, userId, fallbackUser) {
  if (!userId) {
    return fallbackUser.displayAvatarURL({ extension: 'png', size: 256 });
  }

  try {
    const user = await client.users.fetch(userId);
    return user.displayAvatarURL({ extension: 'png', size: 256 });
  } catch {
    return fallbackUser.displayAvatarURL({ extension: 'png', size: 256 });
  }
}

module.exports = {
  name: 'myhfstats',
  aliases: ['hfstats', 'hfprofile', 'mystats'],

  async execute(message, args, client) {
    const data = await loadHandFootballData();
    const player = resolvePlayer(data, message, args);

    if (!player) {
      return message.reply(`${E.missing} HandFootball player not found.`);
    }

    const savedStats = await TournamentStats.findOne({
      userId: player.userId
    }).lean();

    const stats = {
      ...ZERO_STATS,
      ...(savedStats || {})
    };

    const goals = toNumber(stats.goals);
    const assists = toNumber(stats.assists);
    const rating = calculatePerformanceRating(stats);
    const avatarUrl = await getAvatarUrl(client, player.userId, message.author);
    const leagueName = process.env.HF_LEAGUE_NAME || 'Siuuverse HandFootball League';

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.profile, '👤')} ${player.player}'s Player Stats`)
      .setDescription(
        `**Period:** Current Season\n` +
        `**Tournament:** ${leagueName}\n\n` +
        `**Performance Breakdown**\n` +
        [
          buildStatLine(safeEmoji(E.goal, '⚽'), 'Goals:', goals),
          buildStatLine(safeEmoji(E.assist, '🎯'), 'Assists:', assists),
          buildStatLine(safeEmoji(E.interception, '🧠'), 'Interceptions:', toNumber(stats.interceptions)),
          buildStatLine(safeEmoji(E.tackle, '🛡️'), 'Tackles:', toNumber(stats.tackles)),
          buildStatLine(safeEmoji(E.save, '🧤'), 'Saves:', toNumber(stats.saves)),
          buildStatLine(safeEmoji(E.trophy, '🎩'), 'Hattricks:', toNumber(stats.hattricks)),
          buildStatLine(safeEmoji(E.mvp, '⭐'), 'MVPs:', toNumber(stats.mvps)),
          buildStatLine(safeEmoji(E.played, '📊'), 'Matches:', toNumber(stats.matches)),
          buildStatLine('⭐', 'Rating:', `${rating}/10`)
        ].join('\n')
      )
      .setColor(0xF1C40F)
      .setThumbnail(avatarUrl)
      .addFields({
        name: 'Player',
        value: `${mentionUser(player.userId)}${player.isCaptain ? ` • ${safeEmoji(E.captain, '👑')} Captain` : ''}`,
        inline: false
      })
      .setFooter({
        text: `${message.author.username} • HandFootball stats`
      })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};

module.exports.calculatePerformanceRating = calculatePerformanceRating;
