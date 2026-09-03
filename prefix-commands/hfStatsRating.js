function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function matchCount(stats = {}) {
  return Math.max(0, toNumber(stats.matches));
}

// Values are deliberately balanced across roles. A defensive performance
// (tackles, interceptions and saves) can rate as highly as a scoring one.
function calculateMatchImpact(form = {}) {
  return Math.max(0,
    toNumber(form.goals) * 2.5 +
    toNumber(form.assists) * 2.0 +
    toNumber(form.hattricks) * 1.5 +
    toNumber(form.mvps) * 2.5 +
    toNumber(form.interceptions) * 1.25 +
    toNumber(form.tackles) * 1.1 +
    toNumber(form.saves) * 1.6
  );
}

function calculateMatchRating(form = {}) {
  // Logarithmic scaling rewards large games but prevents stat volume from
  // handing out effortless 10/10 ratings.
  const rating = 4.8 + 1.55 * Math.log1p(calculateMatchImpact(form));
  return Math.min(9.75, Math.max(4.8, rating));
}

function getPerMatchOverall(stats = {}) {
  const matches = matchCount(stats);
  if (!matches) return null;

  return {
    goals: toNumber(stats.goals) / matches,
    assists: toNumber(stats.assists) / matches,
    mvps: toNumber(stats.mvps) / matches,
    hattricks: toNumber(stats.hattricks) / matches,
    interceptions: toNumber(stats.interceptions) / matches,
    tackles: toNumber(stats.tackles) / matches,
    saves: toNumber(stats.saves) / matches
  };
}

function getRecentForm(stats = {}) {
  return Array.isArray(stats.recentForm)
    ? stats.recentForm.filter(entry => entry && typeof entry === 'object').slice(-5)
    : [];
}

function weightedRecentRating(entries) {
  if (!entries.length) return 0;
  const ratings = entries.map(calculateMatchRating);
  const weights = ratings.map((_, index) => {
    if (ratings.length === 1) return 1;
    return 0.7 + (0.3 * index) / (ratings.length - 1);
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  return ratings.reduce((total, rating, index) => total + rating * weights[index], 0) / totalWeight;
}

function calculatePerformanceRating(stats = {}) {
  const matches = matchCount(stats);
  const overallPerMatch = getPerMatchOverall(stats);
  if (!overallPerMatch) return 0;

  const overallImpact = calculateMatchImpact(overallPerMatch);
  const overallRating = calculateMatchRating(overallPerMatch);
  const recentEntries = getRecentForm(stats);
  const recentRating = weightedRecentRating(recentEntries);

  // Overall totals divided by matches are the foundation. Last-five form is a
  // modest trend adjustment, not a replacement for a player's full season.
  const combinedRating = recentRating
    ? (overallRating * 0.7) + (recentRating * 0.3)
    : overallRating;

  // More matches make a rating more trustworthy. This moderates a one-game
  // outlier without making appearances themselves a source of rating.
  const confidence = 0.55 + (0.45 * Math.min(matches, 5) / 5);
  const sampleAdjusted = 6 + ((combinedRating - 6) * confidence);
  const sampleCap = matches === 1 ? 8.5
    : matches === 2 ? 9.0
      : matches === 3 ? 9.35
        : matches === 4 ? 9.6
          : 9.75;

  // A perfect rating requires sustained elite full-season contribution and
  // five elite recorded performances; it cannot come from a short hot run.
  const everyRecentMatchElite = recentEntries.length === 5
    && recentEntries.every(entry => calculateMatchImpact(entry) >= 18);
  if (matches >= 5 && overallImpact >= 18 && everyRecentMatchElite && combinedRating >= 9.6) {
    return 10;
  }

  return Number(Math.min(sampleCap, Math.max(4.8, sampleAdjusted)).toFixed(2));
}

function getRecentFormRatings(stats = {}) {
  return getRecentForm(stats).map(entry => Number(calculateMatchRating(entry).toFixed(1)));
}

module.exports = {
  calculatePerformanceRating,
  calculateMatchImpact,
  calculateMatchRating,
  getPerMatchOverall,
  getRecentForm,
  getRecentFormRatings
};
