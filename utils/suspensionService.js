const Suspension = require('../models/suspension');

function clean(value) {
  return String(value || '').trim();
}

function normalizePlayerName(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCompetition(value) {
  const key = clean(value).toLowerCase();
  if (['league', 'fa', 'carabao', 'ucl'].includes(key)) return key;
  return 'league';
}

function normalizeTeamValue(value) {
  return clean(value).toLowerCase();
}

function getCompetitionPhase(competition, matchNo = '') {
  const comp = normalizeCompetition(competition);
  const text = clean(matchNo).toUpperCase();

  if (comp !== 'ucl') return 'standard';
  if (text.includes('GS-')) return 'gs';
  return 'ko';
}

function getYellowThreshold(competition, phase = 'standard') {
  const comp = normalizeCompetition(competition);

  if (comp === 'league') return 3;
  if (comp === 'ucl') return phase === 'gs' ? 2 : 2;
  if (comp === 'fa') return 2;
  if (comp === 'carabao') return 2;
  return 2;
}

function getYellowReductionOnServe(competition, phase = 'standard') {
  return getYellowThreshold(competition, phase);
}

function buildBaseRecord({ guildId, competition, playerName, teamName = '', teamShort = '' }) {
  return {
    guildId: clean(guildId),
    competition: normalizeCompetition(competition),
    playerName: clean(playerName),
    normalizedPlayerName: normalizePlayerName(playerName),
    teamName: clean(teamName),
    teamShort: clean(teamShort),
    yellowCards: 0,
    redCard: false,
    redMatchNo: null,
    yellowBanTriggeredAt: null,
    yellowCompetitionPhase: 'standard',
    bannedMatchNo: null,
    status: 'clear',
    suspensionReason: null,
    servedMatchNo: null,
    history: []
  };
}

async function getSuspensionRecord(guildId, competition, playerName) {
  return Suspension.findOne({
    guildId: clean(guildId),
    competition: normalizeCompetition(competition),
    normalizedPlayerName: normalizePlayerName(playerName)
  });
}

async function getOrCreateSuspensionRecord({ guildId, competition, playerName, teamName = '', teamShort = '' }) {
  const existing = await getSuspensionRecord(guildId, competition, playerName);
  if (existing) {
    existing.playerName = clean(playerName) || existing.playerName;
    if (teamName) existing.teamName = clean(teamName);
    if (teamShort) existing.teamShort = clean(teamShort);
    return existing;
  }

  return Suspension.create(buildBaseRecord({ guildId, competition, playerName, teamName, teamShort }));
}

function pushHistory(record, type, matchNo, note = '') {
  record.history.push({
    type,
    matchNo: clean(matchNo) || null,
    note: clean(note)
  });
}

function setSuspended(record, reason, triggerMatchNo) {
  record.status = 'suspended';
  record.suspensionReason = clean(reason);
  pushHistory(record, 'ban', triggerMatchNo, reason);
}

function getMatchOrderValue(matchNo) {
  const text = clean(matchNo).toUpperCase();
  if (!text) return Number.MAX_SAFE_INTEGER;

  const mdMatch = text.match(/MD\s*(\d+)(?:\.(\d+))?/i);
  if (mdMatch) {
    const md = Number(mdMatch[1]) || 0;
    const sub = Number(mdMatch[2]) || 0;
    return md * 100 + sub;
  }

  const stageMatch = text.match(/(QFQ|QF|SF|F|R16|RO16|R1|GS)[^\d]*(\d+)?(?:\.(\d+))?/i);
  if (stageMatch) {
    const stageMap = { GS: 10, R1: 15, R16: 20, RO16: 20, QFQ: 25, QF: 30, SF: 40, F: 50 };
    const stage = stageMap[String(stageMatch[1] || '').toUpperCase()] || 0;
    const main = Number(stageMatch[2]) || 0;
    const sub = Number(stageMatch[3]) || 0;
    return stage * 100 + main * 10 + sub;
  }

  const nums = text.match(/\d+/g) || [];
  if (nums.length >= 2) {
    return (Number(nums[0]) || 0) * 100 + (Number(nums[1]) || 0);
  }
  if (nums.length === 1) {
    return (Number(nums[0]) || 0) * 100;
  }

  return Number.MAX_SAFE_INTEGER;
}

function fixtureMatchesTeam(fixture, teamName = '', teamShort = '') {
  const teamKey = normalizeTeamValue(teamName);
  const shortKey = normalizeTeamValue(teamShort);

  const homeTeam = normalizeTeamValue(fixture?.homeTeam);
  const awayTeam = normalizeTeamValue(fixture?.awayTeam);
  const homeShort = normalizeTeamValue(fixture?.homeShort);
  const awayShort = normalizeTeamValue(fixture?.awayShort);

  return Boolean(
    (teamKey && (homeTeam === teamKey || awayTeam === teamKey)) ||
    (shortKey && (homeShort === shortKey || awayShort === shortKey))
  );
}

function isByeFixture(fixture) {
  return (
    normalizeTeamValue(fixture?.homeTeam) === 'bye' ||
    normalizeTeamValue(fixture?.awayTeam) === 'bye' ||
    normalizeTeamValue(fixture?.homeShort) === 'bye' ||
    normalizeTeamValue(fixture?.awayShort) === 'bye'
  );
}

function isFixturePlayed(fixture) {
  const hg = fixture?.hg;
  const ag = fixture?.ag;
  return hg !== '' && hg !== undefined && ag !== '' && ag !== undefined;
}

function findNextTeamFixture(fixtures = [], teamName = '', teamShort = '', afterMatchNo = '') {
  const afterOrder = getMatchOrderValue(afterMatchNo);

  return fixtures
    .filter(fixture => fixtureMatchesTeam(fixture, teamName, teamShort))
    .filter(fixture => clean(fixture?.matchNo))
    .filter(fixture => !isByeFixture(fixture))
    .filter(fixture => !isFixturePlayed(fixture))
    .filter(fixture => getMatchOrderValue(fixture.matchNo) > afterOrder)
    .sort((a, b) => getMatchOrderValue(a.matchNo) - getMatchOrderValue(b.matchNo))[0] || null;
}

async function addYellowCard({ guildId, competition, playerName, teamName = '', teamShort = '', matchNo, threshold = null }) {
  const record = await getOrCreateSuspensionRecord({ guildId, competition, playerName, teamName, teamShort });
  const phase = getCompetitionPhase(competition, matchNo);
  const resolvedThreshold = Number.isFinite(Number(threshold)) && Number(threshold) > 0
    ? Number(threshold)
    : getYellowThreshold(competition, phase);

  record.playerName = clean(playerName);
  if (teamName) record.teamName = clean(teamName);
  if (teamShort) record.teamShort = clean(teamShort);

  record.yellowCards += 1;
  pushHistory(record, 'yellow', matchNo, `Yellow card ${record.yellowCards} (${phase})`);

  if (record.yellowCards >= resolvedThreshold && record.status !== 'suspended') {
    record.yellowBanTriggeredAt = clean(matchNo) || null;
    record.yellowCompetitionPhase = phase;
    record.bannedMatchNo = null;
    setSuspended(record, `${resolvedThreshold} yellow cards`, matchNo);
  }

  await record.save();
  return record;
}

async function addRedCard({ guildId, competition, playerName, teamName = '', teamShort = '', matchNo }) {
  const record = await getOrCreateSuspensionRecord({ guildId, competition, playerName, teamName, teamShort });

  record.playerName = clean(playerName);
  if (teamName) record.teamName = clean(teamName);
  if (teamShort) record.teamShort = clean(teamShort);

  record.redCard = true;
  record.redMatchNo = clean(matchNo) || null;
  record.bannedMatchNo = null;
  pushHistory(record, 'red', matchNo, 'Straight red card');
  setSuspended(record, 'Red card', matchNo);

  await record.save();
  return record;
}

async function assignBannedMatch({ guildId, competition, playerName, bannedMatchNo }) {
  const record = await getSuspensionRecord(guildId, competition, playerName);
  if (!record) return null;

  record.bannedMatchNo = clean(bannedMatchNo) || null;
  await record.save();
  return record;
}

async function assignNextBannedMatch({ guildId, competition, playerName, teamName = '', teamShort = '', fixtures = [], afterMatchNo = '' }) {
  const record = await getSuspensionRecord(guildId, competition, playerName);
  if (!record) return null;

  const nextFixture = findNextTeamFixture(
    fixtures,
    teamName || record.teamName,
    teamShort || record.teamShort,
    afterMatchNo || record.redMatchNo || record.yellowBanTriggeredAt || ''
  );

  record.bannedMatchNo = clean(nextFixture?.matchNo) || null;
  await record.save();
  return record;
}

async function markSuspensionServed({ guildId, competition, playerName, servedMatchNo }) {
  const record = await getSuspensionRecord(guildId, competition, playerName);
  if (!record) return null;

  const yellowPhase = clean(record.yellowCompetitionPhase || 'standard').toLowerCase() || 'standard';
  const yellowReduction = getYellowReductionOnServe(record.competition, yellowPhase);

  if (record.yellowCards > 0 && record.yellowBanTriggeredAt) {
    record.yellowCards = Math.max(0, record.yellowCards - yellowReduction);
  }

  record.status = 'served';
  record.servedMatchNo = clean(servedMatchNo) || null;
  record.bannedMatchNo = null;
  record.redCard = false;
  record.redMatchNo = null;
  record.yellowBanTriggeredAt = null;
  record.yellowCompetitionPhase = 'standard';
  record.suspensionReason = null;

  pushHistory(record, 'served', servedMatchNo, 'Suspension served');

  await record.save();
  return record;
}

async function resetPlayerSuspension({ guildId, competition, playerName, keepYellowCards = true }) {
  const record = await getSuspensionRecord(guildId, competition, playerName);
  if (!record) return null;

  record.status = 'clear';
  record.redCard = false;
  record.redMatchNo = null;
  record.yellowBanTriggeredAt = null;
  record.yellowCompetitionPhase = 'standard';
  record.bannedMatchNo = null;
  record.suspensionReason = null;
  record.servedMatchNo = null;

  if (!keepYellowCards) {
    record.yellowCards = 0;
  }

  await record.save();
  return record;
}

async function getTeamSuspensions(guildId, competition, teamNameOrShort) {
  const teamKey = clean(teamNameOrShort).toLowerCase();
  if (!teamKey) return [];

  return Suspension.find({
    guildId: clean(guildId),
    competition: normalizeCompetition(competition),
    status: 'suspended',
    $or: [
      { teamName: new RegExp(`^${teamKey}$`, 'i') },
      { teamShort: new RegExp(`^${teamKey}$`, 'i') }
    ]
  }).sort({ updatedAt: -1 });
}

async function getCompetitionSuspensions(guildId, competition) {
  return Suspension.find({
    guildId: clean(guildId),
    competition: normalizeCompetition(competition)
  }).sort({ status: 1, updatedAt: -1 });
}

async function resetCompetitionYellows(guildId, competition) {
  await Suspension.updateMany(
    {
      guildId: clean(guildId),
      competition: normalizeCompetition(competition)
    },
    {
      $set: {
        yellowCards: 0,
        yellowBanTriggeredAt: null,
        yellowCompetitionPhase: 'standard'
      }
    }
  );

  return true;
}

async function resetTeamCompetitionYellows(guildId, competition, teamNameOrShort) {
  const teamKey = clean(teamNameOrShort).toLowerCase();
  if (!teamKey) return false;

  await Suspension.updateMany(
    {
      guildId: clean(guildId),
      competition: normalizeCompetition(competition),
      $or: [
        { teamName: new RegExp(`^${teamKey}$`, 'i') },
        { teamShort: new RegExp(`^${teamKey}$`, 'i') }
      ]
    },
    {
      $set: {
        yellowCards: 0,
        yellowBanTriggeredAt: null,
        yellowCompetitionPhase: 'standard'
      }
    }
  );

  return true;
}

module.exports = {
  clean,
  normalizePlayerName,
  normalizeCompetition,
  normalizeTeamValue,
  getCompetitionPhase,
  getYellowThreshold,
  getYellowReductionOnServe,
  buildBaseRecord,
  getSuspensionRecord,
  getOrCreateSuspensionRecord,
  getMatchOrderValue,
  fixtureMatchesTeam,
  isByeFixture,
  isFixturePlayed,
  findNextTeamFixture,
  addYellowCard,
  addRedCard,
  assignBannedMatch,
  assignNextBannedMatch,
  markSuspensionServed,
  resetPlayerSuspension,
  resetCompetitionYellows,
  resetTeamCompetitionYellows,
  getTeamSuspensions,
  getCompetitionSuspensions
};
