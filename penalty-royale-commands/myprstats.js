const { EmbedBuilder } = require('discord.js');
const { PenaltyRoyaleProfile } = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

const ZERO = {
  games: 0, wins: 0, losses: 0, draws: 0, goals: 0, shots: 0, misses: 0,
  saves: 0, predictions: 0, correctPredictions: 0, predictionPoints: 0, shieldsEarned: 0,
  abilitiesUsed: 0, currentWinStreak: 0, bestWinStreak: 0,
  bestGoalStreak: 0, bestSaveStreak: 0, bestPredictionStreak: 0
};

function resolveTarget(message, args) {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned;
  const id = args.find(value => /^\d{15,25}$/.test(String(value)));
  if (id) return { id, username: 'Unknown player', displayAvatarURL: () => null };
  return message.author;
}

function percent(numerator, denominator) {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function saveGoalRatio(saves, goals) {
  if (!goals) return saves ? `${saves}:0` : '0:0';
  return `${(saves / goals).toFixed(2)}:1`;
}

module.exports = {
  name: 'myprstats',
  aliases: ['prstats', 'prprofile'],

  async execute(message, args, client) {
    const target = resolveTarget(message, args);
    const saved = await PenaltyRoyaleProfile.findOne({
      guildId: message.guild.id,
      userId: target.id
    }).lean();
    const stats = { ...ZERO, ...(saved || {}) };
    const user = target.id === message.author.id
      ? message.author
      : await client.users.fetch(target.id).catch(() => target);
    const name = saved?.displayName || user?.globalName || user?.username || 'Unknown player';

    const embed = new EmbedBuilder()
      .setTitle(`${E.profile} ${name}'s Penalty Royale Profile`)
      .setColor(0xF1C40F)
      .setDescription(`${target.id === message.author.id ? 'Your' : `${name}'s`} all-time Penalty Royale record in this server.`)
      .addFields(
        {
          name: 'Match record',
          value: `Games: **${stats.games}**\nWins: **${stats.wins}** • Losses: **${stats.losses}** • Draws: **${stats.draws}**\nWin rate: **${percent(stats.wins, stats.games)}**`,
          inline: true
        },
        {
          name: 'Attacking',
          value: `${E.goal} Goals: **${stats.goals}**\n${E.scorer} Shots: **${stats.shots}**\nConversion: **${percent(stats.goals, stats.shots)}**`,
          inline: true
        },
        {
          name: 'Goalkeeping',
          value: `${E.save} GK saves: **${stats.saves}**\n${E.prPrediction} Predictions: **${stats.predictions}**\nPrediction points: **${stats.predictionPoints}**\nAccuracy: **${percent(stats.correctPredictions, stats.predictions)}**`,
          inline: true
        },
        {
          name: 'Rewards & records',
          value: `${E.prShield} Shields earned: **${stats.shieldsEarned}** • ${E.prAbility} Abilities used: **${stats.abilitiesUsed}**\n${E.fire} Win streak: **${stats.currentWinStreak}** (best ${stats.bestWinStreak})\nBest goal streak: **${stats.bestGoalStreak}** • Best GK-save streak: **${stats.bestSaveStreak}**\nBest correct-prediction streak: **${stats.bestPredictionStreak}**`
        }
      )
      .setFooter({ text: 'Use .prleaderboard to see the server rankings' })
      .setTimestamp();

    const avatar = user?.displayAvatarURL?.({ extension: 'png', size: 256 });
    if (avatar) embed.setThumbnail(avatar);
    return message.reply({ embeds: [embed] });
  }
};
