const { EmbedBuilder } = require('discord.js');
const { PenaltyRoyaleProfile } = require('../utils/penaltyRoyale');
const E = require('../utils/emojis');

const STAT_DEFS = {
  wins: { label: 'Wins', emoji: E.trophy, field: 'wins', aliases: ['win', 'w'] },
  goals: { label: 'Goals', emoji: E.goal, field: 'goals', aliases: ['goal', 'g'] },
  saves: { label: 'Saves', emoji: E.save, field: 'saves', aliases: ['save'] },
  predictions: { label: 'Predictions', emoji: E.prPrediction, field: 'predictions', aliases: ['prediction', 'predict'] },
  predictionpoints: { label: 'Prediction Points', emoji: E.prPrediction, field: 'predictionPoints', aliases: ['points', 'predictionpoints', 'predpoints'] },
  streak: { label: 'Best Win Streak', emoji: E.fire, field: 'bestWinStreak', aliases: ['streak', 'winstreak'] },
  goalstreak: { label: 'Best Goal Streak', emoji: E.fire, field: 'bestGoalStreak', aliases: ['goalstreak', 'goalsstreak'] },
  savestreak: { label: 'Best Save Streak', emoji: E.fire, field: 'bestSaveStreak', aliases: ['savestreak', 'savesstreak'] },
  predictionstreak: { label: 'Best Prediction Streak', emoji: E.fire, field: 'bestPredictionStreak', aliases: ['predictionstreak', 'predstreak'] },
  abilities: { label: 'Abilities Used', emoji: E.prAbility, field: 'abilitiesUsed', aliases: ['ability', 'abilities', 'powers'] }
};

function getStat(input) {
  const selected = String(input || 'wins').trim().toLowerCase();
  return Object.values(STAT_DEFS).find(stat => stat.field === selected || stat.aliases.includes(selected)) || STAT_DEFS.wins;
}

module.exports = {
  name: 'prleaderboard',
  aliases: ['prlb', 'prrank'],

  async execute(message, args) {
    const stat = getStat(args[0]);
    const rows = await PenaltyRoyaleProfile.find({ guildId: message.guild.id })
      .sort({ [stat.field]: -1, goals: -1, wins: -1, displayName: 1 })
      .limit(10)
      .lean();

    if (!rows.length || !rows.some(row => Number(row[stat.field]) > 0)) {
      return message.reply(`${E.warning} No Penalty Royale ${stat.label.toLowerCase()} have been recorded yet.`);
    }

    const lines = rows
      .filter(row => Number(row[stat.field]) > 0)
      .map((row, index) => `\`${String(index + 1).padStart(2, ' ')}. ${String(row.displayName || 'Unknown player').slice(0, 20).padEnd(20, ' ')} ${String(row[stat.field]).padStart(4, ' ')}\` <@${row.userId}>`);

    const embed = new EmbedBuilder()
      .setTitle(`${stat.emoji} Penalty Royale ${stat.label} Leaderboard`)
      .setDescription(lines.join('\n'))
      .setColor(0xF1C40F)
      .setFooter({ text: 'Use .prleaderboard wins|goals|saves|predictions|predictionpoints|streak|goalstreak|savestreak|predictionstreak|abilities' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }
};
