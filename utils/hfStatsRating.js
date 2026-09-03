function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calculateMatchImpact(form = {}) {
  return Math.max(0,
    toNumber(form.goals) * 3.0 +
    toNumber(form.assists) * 2.2 +
    toNumber(form.hattricks) * 1.5 +
    toNumber(form.mvps) * 2.7 +
    toNumber(form.interceptions) * 0.4 +
    toNumber(form.tackles) * 0.3 +
    toNumber(form.saves) * 0.5
  );
}

function calculateMatchRating(form = {}) {
  // A logarithmic curve rewards a great all-round match without allowing
  // stat volume to turn ordinary form into an automatic 10/10.
  const rating = 4.5 + 1.5 * Math.log1p(calculateMatchImpact(form));
  return Math.min(9.75, Math.max(4.5, rating));
}

function getRecentForm(stats = {}) {
  const recorded = Array.isArray(stats.recentForm)
    ? stats.recentForm.filter(entry => entry && typeof entry === 'object').slice(-5)
    : [];

  // Ratings intentionally depend only on match-by-match form. Existing
  // aggregate totals cannot be accurately split into five performances, so
  // players become rated as new match stats are submitted with `.as`.
  return { entries: recorded };
}

function calculatePerformanceRating(stats = {}) {
  const { entries } = getRecentForm(stats);
  if (!entries.length) return 0;

  const matchRatings = entries.map(calculateMatchRating);
  const weights = matchRatings.map((_, index) => {
    if (matchRatings.length === 1) return 1;
    return 0.7 + (0.3 * index) / (matchRatings.length - 1);
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedRating = matchRatings.reduce(
    (sum, rating, index) => sum + rating * weights[index],
    0
  ) / weightTotal;

  // Small samples are useful but cannot claim an elite rating. This is based
  // only on the number of recorded form entries, never league appearances.
  const formCap = entries.length === 1 ? 8.25
    : entries.length === 2 ? 8.75
      : entries.length < 5 ? 9.3
        : 9.75;
  const averageImpact = entries.reduce((sum, entry) => sum + calculateMatchImpact(entry), 0) / entries.length;
  const everyMatchElite = entries.every(entry => calculateMatchImpact(entry) >= 20);

  // 10/10 is reserved for five exceptional consecutive performances, not a
  // one-off stat line. The ordinary curve deliberately stops at 9.75.
  if (entries.length === 5 && everyMatchElite && averageImpact >= 30) {
    return 10;
  }

  return Number(Math.min(formCap, Math.max(0, weightedRating)).toFixed(2));
}

function getRecentFormRatings(stats = {}) {
  const { entries } = getRecentForm(stats);
  return entries.map(entry => Number(calculateMatchRating(entry).toFixed(1)));
}

module.exports = {
  calculatePerformanceRating,
  calculateMatchImpact,
  calculateMatchRating,
  getRecentForm,
  getRecentFormRatings
};
