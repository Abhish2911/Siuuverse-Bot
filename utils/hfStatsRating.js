function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calculatePerformanceRating(stats = {}) {
  const matches = toNumber(stats.matches);
  if (matches <= 0) return 0;

  // Convert totals into per-match impact so playing more matches does not
  // inflate a player's rating. Defensive actions are intentionally worth
  // less than goals, assists and MVPs because they occur more frequently.
  const impact =
    toNumber(stats.goals) * 2 +
    toNumber(stats.assists) * 1.5 +
    toNumber(stats.hattricks) * 1.5 +
    toNumber(stats.mvps) * 2.5 +
    toNumber(stats.interceptions) * 0.35 +
    toNumber(stats.tackles) * 0.25 +
    toNumber(stats.saves) * 0.45;
  const impactPerMatch = Math.max(0, impact / matches);

  // Diminishing returns keep the middle of the scale useful instead of
  // allowing a few high-volume stats to push most players straight to 10.
  const rating = 4 + 5.5 * (1 - Math.exp(-impactPerMatch / 5));

  // A perfect score requires both exceptional production and a meaningful
  // sample size. The normal curve tops out below 10 by design.
  const eliteBonus = matches >= 5 && impactPerMatch >= 14 ? 0.5 : 0;
  const perfectScore = matches >= 5 && impactPerMatch >= 20;

  if (perfectScore) return 10;

  return Math.min(10, Math.max(0, Number((rating + eliteBonus).toFixed(2))));
}

module.exports = { calculatePerformanceRating };
