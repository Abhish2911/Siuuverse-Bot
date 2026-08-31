function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getPlayedMatchdayCount(fixtures = []) {
  return new Set(
    fixtures
      .filter(fixture => fixture?.played)
      .map(fixture => String(fixture.matchday || fixture.matchNo || '').trim())
      .filter(Boolean)
  ).size;
}

function getRecentStats(stats = {}) {
  const history = Array.isArray(stats.matchHistory)
    ? stats.matchHistory.filter(match => match && toNumber(match.matches) > 0)
    : [];

  if (!history.length) return stats;

  const recent = [...history]
    .sort((left, right) => new Date(left.recordedAt || 0) - new Date(right.recordedAt || 0))
    .slice(-5);

  return recent.reduce((totals, match) => {
    Object.keys(totals).forEach(field => {
      totals[field] += toNumber(match[field]);
    });
    return totals;
  }, {
    matches: 0,
    goals: 0,
    assists: 0,
    mvps: 0,
    hattricks: 0,
    interceptions: 0,
    tackles: 0,
    saves: 0
  });
}

function calculatePerformanceRating(stats = {}, options = {}) {
  const hasMatchHistory = Array.isArray(stats.matchHistory) && stats.matchHistory.length > 0;
  const recentStats = getRecentStats(stats);
  const matches = toNumber(recentStats.matches);
  if (matches <= 0) return 0;

  // Convert totals into per-match impact so playing more matches does not
  // inflate a player's rating. Defensive actions are intentionally worth
  // less than goals, assists and MVPs because they occur more frequently.
  const impact =
    toNumber(recentStats.goals) * 2.4 +
    toNumber(recentStats.assists) * 2.0 +
    toNumber(recentStats.hattricks) * 2.0 +
    toNumber(recentStats.mvps) * 2.7 +
    toNumber(recentStats.interceptions) * 0.95 +
    toNumber(recentStats.tackles) * 0.80 +
    toNumber(recentStats.saves) * 0.9;
  const impactPerMatch = Math.max(0, impact / matches);

  // Diminishing returns keep the middle of the scale useful instead of
  // allowing a few high-volume stats to push most players straight to 10.
  // Use a wider scoring span so genuinely strong performances separate from
  // the neutral range instead of clustering most players around 7.x.
  const performanceRating = 6 + 4.5 * (1 - Math.exp(-impactPerMatch / 5));

  // Per-match production alone is too noisy for players with only one game.
  // Shrink early ratings toward the neutral baseline until more matches are
  // available. The base prior gives 1 match 33% confidence, 3 matches 60%,
  // and 5 matches 71%; completed matchdays add a participation factor so a
  // player who has missed most of the season is penalized further.
  const baseConfidence = matches / (matches + 2);
  const expectedMatches = toNumber(options.expectedMatches);
  const participationConfidence = !hasMatchHistory && expectedMatches > 0
    ? Math.min(1, matches / expectedMatches)
    : 1;
  const sampleConfidence = baseConfidence * participationConfidence;
  const rating = 6 + (performanceRating - 6) * sampleConfidence;

  // A perfect score requires both exceptional production and a meaningful
  // sample size. The normal curve tops out below 10 by design.
  const eliteBonus = matches >= 5 && impactPerMatch >= 14 ? 0.5 : 0;
  const perfectScore = matches >= 5 && impactPerMatch >= 20;

  if (perfectScore) return 10;

  return Math.min(10, Math.max(0, Number((rating + eliteBonus * sampleConfidence).toFixed(2))));
}

module.exports = { calculatePerformanceRating, getPlayedMatchdayCount };
