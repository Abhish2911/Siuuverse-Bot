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

  if (recorded.length) return { entries: recorded, legacy: false };

  // Older seasons store aggregate totals only. Estimate one conservative
  // performance from their historical average so existing players do not lose
  // their ratings. This does not reward number of appearances: matches are
  // used only to normalize totals into an average performance.
  const matches = Math.max(0, toNumber(stats.matches));
  if (!matches) return { entries: [], legacy: false };

  return {
    entries: [{
      goals: toNumber(stats.goals) / matches,
      assists: toNumber(stats.assists) / matches,
      mvps: toNumber(stats.mvps) / matches,
      hattricks: toNumber(stats.hattricks) / matches,
      interceptions: toNumber(stats.interceptions) / matches,
      tackles: toNumber(stats.tackles) / matches,
      saves: toNumber(stats.saves) / matches
    }],
    legacy: true
  };
}

function calculatePerformanceRating(stats = {}) {
  const { entries, legacy } = getRecentForm(stats);
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
  const formCap = legacy ? 9.0
    : entries.length === 1 ? 8.25
    : entries.length === 2 ? 8.75
      : entries.length < 5 ? 9.3
        : 9.75;
  const averageImpact = entries.reduce((sum, entry) => sum + calculateMatchImpact(entry), 0) / entries.length;
  const everyMatchElite = entries.every(entry => calculateMatchImpact(entry) >= 20);

  // 10/10 is reserved for five exceptional consecutive performances, not a
  // one-off stat line. The ordinary curve deliberately stops at 9.75.
  if (!legacy && entries.length === 5 && everyMatchElite && averageImpact >= 30) {
    return 10;
  }

  if (legacy) {
    // Historic totals can only provide an approximation. Preserve meaningful
    // separation instead of forcing every old player above 8: solid records
    // reach 8+, exceptional ones approach 9, and low-impact records remain
    // lower. Match count only normalizes totals; it never raises the rating.
    const historicalRating = 6.2 + Math.max(0, (weightedRating - 4.5) * 0.7);
    return Number(Math.min(formCap, historicalRating).toFixed(2));
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
