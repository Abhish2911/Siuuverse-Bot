function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calculatePerformanceRating(stats = {}) {
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

module.exports = { calculatePerformanceRating };
