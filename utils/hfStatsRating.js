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

function calculatePerformanceRating(stats = {}, options = {}) {
  const matches = toNumber(stats.matches);
  if (matches <= 0) return 0;

  // Convert totals into per-match impact so playing more matches does not
  // inflate a player's rating. Defensive actions are intentionally worth
  // less than goals, assists and MVPs because they occur more frequently.
  const impact =
    toNumber(stats.goals) * 2.2 +
    toNumber(stats.assists) * 1.7 +
    toNumber(stats.hattricks) * 1.7 +
    toNumber(stats.mvps) * 2.5 +
    toNumber(stats.interceptions) * 0.75 +
    toNumber(stats.tackles) * 0.60 +
    toNumber(stats.saves) * 0.7;
  const impactPerMatch = Math.max(0, impact / matches);

  // Diminishing returns keep the middle of the scale useful instead of
  // allowing a few high-volume stats to push most players straight to 10.
  const performanceRating = 6 + 3.5 * (1 - Math.exp(-impactPerMatch / 5));

  // Per-match production alone is too noisy for players with only one game.
  // Shrink early ratings toward the neutral baseline until more matches are
  // available. The base prior gives 1 match 33% confidence, 3 matches 60%,
  // and 5 matches 71%; completed matchdays add a participation factor so a
  // player who has missed most of the season is penalized further.
  const baseConfidence = matches / (matches + 2);
  const expectedMatches = toNumber(options.expectedMatches);
  const participationConfidence = expectedMatches > 0
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
