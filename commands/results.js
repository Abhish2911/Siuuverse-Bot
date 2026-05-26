const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function resultLabel(result) {
  if (result === 'H') return `${safeEmoji(E.win, '✅')} Home Win`;
  if (result === 'A') return `${safeEmoji(E.win, '✅')} Away Win`;
  return `${safeEmoji(E.draw, '🤝')} Draw`;
}

function matchTag(homeGoals, awayGoals) {
  const total = toNumber(homeGoals) + toNumber(awayGoals);
  const diff = Math.abs(toNumber(homeGoals) - toNumber(awayGoals));

  if (total >= 6 && diff <= 1) return `${safeEmoji(E.fire, '🔥')} Thriller`;
  if (total >= 5) return `${safeEmoji(E.fire, '🔥')} Goal Fest`;
  if (diff >= 3) return `${safeEmoji(E.goldenBoot, '🏆')} Dominant`;
  if (diff === 0) return `${safeEmoji(E.draw, '🤝')} Tight Draw`;
  return `${safeEmoji(E.played, '🎮')} Played`;
}

function shortName(value, len = 8) {
  const str = String(value || '-').trim();
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
}

function buildResultsSummary(matches) {
  const latest = matches[0];
  const second = matches[1];
  const third = matches[2];

  const formatMatch = row => {
    if (!row) return 'N/A';
    const home = shortName(row[7] || row[2], 8);
    const away = shortName(row[8] || row[3], 8);
    const hg = row[4] ?? '-';
    const ag = row[5] ?? '-';
    return `\`${home}\` ${hg}-${ag} \`${away}\``;
  };

  return {
    matches: matches.length,
    totalGoals: matches.reduce((sum, row) => sum + toNumber(row[4]) + toNumber(row[5]), 0),
    draws: matches.filter(row => {
      const result = row[6] || (toNumber(row[4]) > toNumber(row[5]) ? 'H' : toNumber(row[4]) < toNumber(row[5]) ? 'A' : 'D');
      return result === 'D';
    }).length,
    latest: formatMatch(latest),
    second: formatMatch(second),
    third: formatMatch(third)
  };
}

function buildResultsDescription(summary, limit) {
  return (
    `${safeEmoji(E.calendar, '📢')} **Latest Completed Results**\n` +
    `Most recent finished league fixtures from the current results data.\n\n` +
    `${safeEmoji(E.played, '🎮')} **Matches Shown:** ${summary.matches}/${limit}\n` +
    `${safeEmoji(E.goal, '⚽')} **Goals:** ${summary.totalGoals}\n` +
    `${safeEmoji(E.draw, '🤝')} **Draws:** ${summary.draws}\n\n` +
    `${safeEmoji(E.fire, '🔥')} **Latest:** ${summary.latest}\n` +
    `${safeEmoji(E.runnerUp || E.medal, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}`
  );
}

function buildResultLine(row, index) {
  const matchNo = String(row[0] || '-');
  const date = String(row[1] || '-');
  const home = shortName(row[7] || row[2], 8);
  const away = shortName(row[8] || row[3], 8);
  const hg = row[4] ?? '-';
  const ag = row[5] ?? '-';
  const rawResult = row[6] || (toNumber(hg) > toNumber(ag) ? 'H' : toNumber(hg) < toNumber(ag) ? 'A' : 'D');
  const tag = matchTag(hg, ag);

  return `${index + 1}. **MD ${matchNo}** • ${date}\n` +
    `> **${home}** ${safeEmoji(E.vs, '⚔️')} **${away}** — **${hg}-${ag}**\n` +
    `> ${resultLabel(rawResult)} • ${tag}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('results')
    .setDescription('Show latest match results')
    .addIntegerOption(option =>
      option
        .setName('limit')
        .setDescription('How many recent results to show')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction) {
    try {
      const limit = interaction.options.getInteger('limit') || 5;
      const data = await cachedGetData('Fixtures!A:I');

      if (!Array.isArray(data) || data.length <= 1) {
        return {
          embeds: [
            new EmbedBuilder()
              .setTitle(`${safeEmoji(E.calendar, '📢')} Recent Results`)
              .setDescription('```ini\nNo results yet\n```')
              .setColor(0x2ECC71)
              .setFooter({ text: `Last ${limit} completed fixtures` })
          ]
        };
      }

      const rows = data.slice(1).filter(row => {
        if (!Array.isArray(row)) return false;
        return (
          row[0] && row[1] &&
          row[4] !== '' && row[4] !== undefined &&
          row[5] !== '' && row[5] !== undefined
        );
      });

      const lastMatches = rows.slice(-limit).reverse();

      const lines = lastMatches.map(buildResultLine).join('\n\n');
      const summary = buildResultsSummary(lastMatches);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.calendar, '📢')} Recent Results`)
            .setDescription(buildResultsDescription(summary, limit))
            .addFields(
              { name: `${safeEmoji(E.stats || E.rank, '📊')} Result Feed`, value: lines || '```ini\nNo results yet\n```', inline: false },
              { name: `${safeEmoji(E.played, '🎮')} Matches`, value: String(summary.matches), inline: true },
              { name: `${safeEmoji(E.goal, '⚽')} Goals`, value: String(summary.totalGoals), inline: true },
              { name: `${safeEmoji(E.draw, '🤝')} Draws`, value: String(summary.draws), inline: true }
            )
            .setColor(0x2ECC71)
            .setFooter({ text: `Recent Results • Latest ${limit} completed fixtures • Use /results limit:10 for more` })
            .setTimestamp()
        ]
      };
    } catch (error) {
      console.error('results.js error:', error);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.calendar, '📢')} Recent Results`)
            .setDescription(`\`\`\`ini\nCould not load results right now\n${error.message || 'Unknown error'}\n\`\`\``)
            .setColor(0xE74C3C)
        ]
      };
    }
  }
};