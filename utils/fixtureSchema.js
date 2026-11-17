

/**
 * COOP Fixture Schema Registry v3
 * Central source of truth for all competition row indexes
 */

const SCHEMAS = {
  // =========================
  // LEAGUE FIXTURES (no knockout)
  // =========================
  league: {
    MD: 0,
    DATE: 1,
    HOME: 2,
    AWAY: 3,
    HG: 4,
    AG: 5,
    RESULT: 6,
    HOME_SHORT: 7,
    AWAY_SHORT: 8,
    STATUS: 9
  },

  // =========================
  // UCL GROUP STAGE
  // =========================
  ucl_group: {
    MD: 0,
    DATE: 1,
    HOME: 2,
    AWAY: 3,
    HG: 4,
    AG: 5,
    RESULT: 6,
    HOME_SHORT: 7,
    AWAY_SHORT: 8,
    STATUS: 9,
    GROUP: 10
  },

  // =========================
  // CUP KNOCKOUT (FA / CARABAO / UCL KNOCKOUT)
  // =========================
  cups: {
    MD: 0,
    DATE: 1,
    HOME: 2,
    AWAY: 3,
    HG: 4,
    AG: 5,
    RESULT: 6,
    DECISION: 7,
    HOME_SHORT: 8,
    AWAY_SHORT: 9,
    STATUS: 10,
    ROUND: 11
  },

  // alias for clarity
  ucl_knockout: {
    MD: 0,
    DATE: 1,
    HOME: 2,
    AWAY: 3,
    HG: 4,
    AG: 5,
    RESULT: 6,
    DECISION: 7,
    HOME_SHORT: 8,
    AWAY_SHORT: 9,
    STATUS: 10,
    ROUND: 11
  }
};

/**
 * Get schema by competition key
 */
function getSchema(key = '') {
  const k = key.toLowerCase();

  if (k.includes('ucl_group') || k.includes('group')) return SCHEMAS.ucl_group;
  if (k.includes('ucl_knockout') || k.includes('uclko')) return SCHEMAS.ucl_knockout;

  if (k.includes('cup') || k.includes('fa') || k.includes('carabao')) return SCHEMAS.cups;

  return SCHEMAS.league;
}

module.exports = {
  SCHEMAS,
  getSchema
};