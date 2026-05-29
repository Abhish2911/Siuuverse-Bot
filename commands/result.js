const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const {
  buildMixedPrefixList,
  invalidateSheetCache,
  sendAuditLog,
  getAllowedMatchday
} = require('../utils/helpers');
const { refreshLiveStandings } = require('../utils/liveStandings');
let addYellowCard = async () => null;
let addRedCard = async () => null;
let assignNextBannedMatch = async () => null;

try {
  ({ addYellowCard, addRedCard, assignNextBannedMatch } = require('../utils/suspensionService'));
} catch (error) {
  console.warn('Suspension service unavailable:', error.message);
}
const { buildWeeklySummaryPayload } = require('./weeklysummary');
const E = require('../utils/emojis');


const pendingResults = new Map();

const PENDING_TTL = 5 * 60 * 1000;
const RESERVE_SHEET_RANGE = 'Reserve!A:F';
const SUBMITTED_AT_INDEX = 18; // Column S in result sheets
const ALL_RESULT_SOURCES = [
  { key: 'league', label: 'League', range: 'Matches_Entry!A:S' },
  { key: 'ucl', label: 'UCL', range: 'UCL_Coop_Results!A:S' },
  { key: 'fa', label: 'FA Cup', range: 'FA_Cup_Coop_Results!A:S' },
  { key: 'carabao', label: 'Carabao Cup', range: 'Carabao_Coop_Results!A:S' }
];

function cleanPending(map) {
  const now = Date.now();
  for (const [key, value] of map.entries()) {
    if (!value?.createdAt || now - value.createdAt > PENDING_TTL) {
      map.delete(key);
    }
  }
}


function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getSubmittedDateKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return getTodayKey(date);
}

function sameTeam(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function getCompetitionDailyLimit(key) {
  if (key === 'league') return envNumber('MAX_LEAGUE_RESULTS_PER_TEAM_PER_DAY', 3);
  if (key === 'ucl') return envNumber('MAX_UCL_RESULTS_PER_TEAM_PER_DAY', 2);
  return envNumber('MAX_CUP_RESULTS_PER_TEAM_PER_DAY', 2);
}

function getTotalDailyLimit() {
  return envNumber('MAX_TOTAL_RESULTS_PER_TEAM_PER_DAY', 4);
}

async function getDailyResultCounts({ homeTeam, awayTeam, currentMatchNo }) {
  const today = getTodayKey();
  const counts = {
    home: { total: 0, league: 0, ucl: 0, fa: 0, carabao: 0 },
    away: { total: 0, league: 0, ucl: 0, fa: 0, carabao: 0 }
  };

  const sheets = await Promise.all(
    ALL_RESULT_SOURCES.map(source =>
      getData(source.range)
        .then(rows => ({ ...source, rows: Array.isArray(rows) ? rows.slice(1) : [] }))
        .catch(() => ({ ...source, rows: [] }))
    )
  );

  for (const source of sheets) {
    for (const row of source.rows) {
      const matchNo = normalizeMatchNo(row[0]);
      if (currentMatchNo && matchNo === currentMatchNo) continue;

      const submittedAt = row[SUBMITTED_AT_INDEX];
      if (getSubmittedDateKey(submittedAt) !== today) continue;

      const rowHome = clean(row[1]);
      const rowAway = clean(row[2]);

      if (sameTeam(rowHome, homeTeam) || sameTeam(rowAway, homeTeam)) {
        counts.home.total += 1;
        counts.home[source.key] += 1;
      }

      if (sameTeam(rowHome, awayTeam) || sameTeam(rowAway, awayTeam)) {
        counts.away.total += 1;
        counts.away[source.key] += 1;
      }
    }
  }

  return counts;
}

async function checkDailyResultLimit({ competition, homeTeam, awayTeam, matchNo }) {
  const competitionLimit = getCompetitionDailyLimit(competition.key);
  const totalLimit = getTotalDailyLimit();
  const counts = await getDailyResultCounts({ homeTeam, awayTeam, currentMatchNo: matchNo });

  const checks = [
    { side: 'home', team: homeTeam, counts: counts.home },
    { side: 'away', team: awayTeam, counts: counts.away }
  ];

  for (const item of checks) {
    const competitionCount = item.counts[competition.key] || 0;

    if (competitionLimit > 0 && competitionCount >= competitionLimit) {
      return {
        ok: false,
        team: item.team,
        reason: `${item.team} has already submitted **${competitionCount}/${competitionLimit}** ${competition.label} result(s) today.`
      };
    }

    if (totalLimit > 0 && item.counts.total >= totalLimit) {
      return {
        ok: false,
        team: item.team,
        reason: `${item.team} has already submitted **${item.counts.total}/${totalLimit}** total result(s) today across all competitions.`
      };
    }
  }

  return { ok: true, counts, competitionLimit, totalLimit };
}

function compactList(value, empty = 'None') {
  const text = String(value || '').trim();
  if (!text) return empty;

  return text
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => `• ${item}`)
    .join('\n') || empty;
}

function compactCountList(value, empty = 'None') {
  const entries = splitRawEntries(value);
  if (!entries.length) return empty;

  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => `• ${name} (${count})`)
    .join('\n');
}

function repeatedCount(value) {
  return splitRawEntries(value).length;
}

function splitRawEntries(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function hasExplicitPrefix(value, homeShort, awayShort) {
  const text = String(value || '').trim().toUpperCase();
  const home = String(homeShort || '').trim().toUpperCase();
  const away = String(awayShort || '').trim().toUpperCase();

  return Boolean(
    (home && (text.startsWith(`${home}-`) || text.startsWith(`${home} -`))) ||
    (away && (text.startsWith(`${away}-`) || text.startsWith(`${away} -`)))
  );
}

function preserveExplicitPrefixes(rawValue, builtValue, homePlayers, awayPlayers, homeShort, awayShort) {
  const rawEntries = splitRawEntries(rawValue);
  if (!rawEntries.length) return builtValue;

  const builtEntries = splitRawEntries(builtValue);
  if (!builtEntries.length) return builtValue;

  const stripKnownPrefix = value => {
    const text = String(value || '').trim();
    const home = String(homeShort || '').trim();
    const away = String(awayShort || '').trim();

    if (home && new RegExp(`^${home}\\s*-\\s*`, 'i').test(text)) {
      return text.replace(new RegExp(`^${home}\\s*-\\s*`, 'i'), '').trim();
    }

    if (away && new RegExp(`^${away}\\s*-\\s*`, 'i').test(text)) {
      return text.replace(new RegExp(`^${away}\\s*-\\s*`, 'i'), '').trim();
    }

    return text;
  };

  const normalizeBaseName = value => stripKnownPrefix(value).toLowerCase();
  const used = new Set();

  const updated = builtEntries.map(entry => {
    const builtBase = normalizeBaseName(entry);

    for (let i = 0; i < rawEntries.length; i++) {
      if (used.has(i)) continue;

      const rawEntry = rawEntries[i];
      if (!hasExplicitPrefix(rawEntry, homeShort, awayShort)) continue;

      const rawBase = normalizeBaseName(rawEntry);

      if (rawBase && rawBase === builtBase) {
        used.add(i);
        return rawEntry;
      }
    }

    return entry;
  });

  return updated.join(', ');
}

function parseCustomEmoji(emojiString) {
  const match = String(emojiString || '').match(/^<a?:(\w+):(\d+)>$/);
  if (!match) return undefined;
  return { name: match[1], id: match[2] };
}

function scoreTag(homeGoals, awayGoals) {
  const total = Number(homeGoals || 0) + Number(awayGoals || 0);
  const diff = Math.abs(Number(homeGoals || 0) - Number(awayGoals || 0));

  if (total >= 6 && diff <= 1) return `${safeEmoji(E.fire, '🔥')} Goal fest thriller`;
  if (total >= 5) return `${safeEmoji(E.fire, '🔥')} High scoring match`;
  if (diff >= 3) return `${safeEmoji(E.win, '🏆')} Dominant win`;
  if (diff === 0) return `${safeEmoji(E.draw, '🤝')} Balanced draw`;
  return `${safeEmoji(E.played, '🎮')} Regular match`;
}

function getYellowThresholdForPending(competitionKey, matchNo = '') {
  const key = String(competitionKey || '').trim().toLowerCase();
  const text = String(matchNo || '').trim().toUpperCase();

  if (key === 'league') return 3;
  if (key === 'ucl') return text.includes('GS-') ? 2 : 2;
  if (key === 'fa') return 2;
  if (key === 'carabao') return 2;
  return 2;
}

function getTeamUserIds(teamRow) {
  if (!teamRow) return [];

  const ids = [
    String(teamRow[4] || '').trim(),
    ...String(teamRow[5] || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
  ].filter(Boolean);

  return [...new Set(ids)];
}

function isPrivilegedAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasAdminRole = interaction.member?.roles?.cache?.some(role =>
    adminRoleIds.includes(role.id)
  );

  return isOwner || hasAdminRole;
}

function normalizeTeamKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getRankMap(standingsRows) {
  const map = new Map();

  for (let i = 1; i < standingsRows.length; i++) {
    const row = standingsRows[i] || [];
    const values = row.map(v => String(v || '').trim()).filter(Boolean);
    if (!values.length) continue;

    const numericValues = row
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v > 0);

    const rank =
      [row[0], row[9], row[10], row[8]]
        .map(v => Number(v))
        .find(v => Number.isFinite(v) && v > 0) || i;

    // Store rank against all meaningful text cells so both full team name
    // and short name can be matched later.
    for (const value of values) {
      if (/^[-+]?\d+(\.\d+)?$/.test(value)) continue;
      const key = normalizeTeamKey(value);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, rank);
      }
    }

    // Some standings layouts have team in col B and short name in col A/C.
    // The loop above already captures them, but keep rank stable.
    if (!numericValues.length && values.length) {
      const fallbackKey = normalizeTeamKey(values[0]);
      if (fallbackKey && !map.has(fallbackKey)) {
        map.set(fallbackKey, rank);
      }
    }
  }

  return map;
}

function movementLabel(beforeRank, afterRank) {
  if (!beforeRank && !afterRank) return 'N/A';
  if (!beforeRank && afterRank) return `${E.up} Now #${afterRank}`;
  if (beforeRank && !afterRank) return `${E.down} Was #${beforeRank}`;
  if (afterRank < beforeRank) return `${E.up} ${beforeRank} ${E.shortArrow} ${afterRank}`;
  if (afterRank > beforeRank) return `${E.down} ${beforeRank} ${E.shortArrow} ${afterRank}`;
  return `${E.equal} Stayed #${afterRank}`;
}

function isMatchdayComplete(fixtureRows, matchday) {
  const rows = fixtureRows.filter(row => String(row[0] || '').split('.')[0].trim() === String(matchday));
  return rows.length > 0 && rows.every(row => row[4] !== '' && row[4] !== undefined && row[5] !== '' && row[5] !== undefined);
}

function normalizeMatchNo(value) {
  return String(value ?? '').trim();
}

function getCompetitionConfig(matchNo) {
  const code = normalizeMatchNo(matchNo).toUpperCase();

  if (code.startsWith('FA ')) {
    return {
      key: 'fa',
      label: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      fixturesSaveRange: 'FA_Cup_Coop_Fixtures!A2:K',
      resultsRange: 'FA_Cup_Coop_Results!A:S',
      reserveKey: 'FA Cup',
      standingsRange: null,
      weeklySummary: false
    };
  }

  if (code.startsWith('CB ')) {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      fixturesSaveRange: 'Carabao_Coop_Fixtures!A2:K',
      resultsRange: 'Carabao_Coop_Results!A:S',
      reserveKey: 'Carabao Cup',
      standingsRange: null,
      weeklySummary: false
    };
  }

  if (code.startsWith('UCL ')) {
    const isGroupStage = code.includes('GS-');
    return {
      key: 'ucl',
      label: 'UCL',
      fixturesRange: isGroupStage ? 'UCL_Coop_Group_Fixtures!A:J' : 'UCL_Coop_Knockout_Fixtures!A:K',
      fixturesSaveRange: isGroupStage ? 'UCL_Coop_Group_Fixtures!A2:J' : 'UCL_Coop_Knockout_Fixtures!A2:K',
      resultsRange: 'UCL_Coop_Results!A:S',
      reserveKey: 'UCL',
      standingsRange: isGroupStage ? 'UCL_Coop_Group_Standings!A:K' : null,
      weeklySummary: false
    };
  }

  return {
    key: 'league',
    label: 'League',
    fixturesRange: 'Fixtures!A:J',
    fixturesSaveRange: 'Fixtures!A2:J',
    resultsRange: 'Matches_Entry!A:S',
    reserveKey: 'League',
    standingsRange: 'Standings!A:J',
    weeklySummary: true
  };
}

function getFixtureFieldIndexes(config) {
  if (config.key === 'fa' || config.key === 'carabao' || config.key === 'ucl') {
    if (config.fixturesRange.includes('!A:K')) {
      return {
        matchNo: 1,
        homeTeam: 3,
        awayTeam: 4,
        hg: 5,
        ag: 6,
        result: 7,
        homeShort: 8,
        awayShort: 9,
        status: 10,
        round: 0
      };
    }

    return {
      matchNo: 0,
      homeTeam: 2,
      awayTeam: 3,
      hg: 4,
      ag: 5,
      result: 6,
      homeShort: 7,
      awayShort: 8,
      status: 9,
      round: null
    };
  }

  return {
    matchNo: 0,
    homeTeam: 2,
    awayTeam: 3,
    hg: 4,
    ag: 5,
    result: 6,
    homeShort: 7,
    awayShort: 8,
    status: 9,
    round: null
  };
}

function getStandingsDisplayKeys(pending, config) {
  if (config.key === 'ucl') {
    return {
      homeTeam: pending.homeTeam,
      awayTeam: pending.awayTeam,
      homeShort: pending.homeShort,
      awayShort: pending.awayShort
    };
  }

  return {
    homeTeam: pending.homeTeam,
    awayTeam: pending.awayTeam,
    homeShort: pending.homeShort,
    awayShort: pending.awayShort
  };
}

function getMostRecentPlayedMatchday(fixtureRows) {
  const playedMatchdays = fixtureRows
    .filter(row => row[4] !== '' && row[4] !== undefined && row[5] !== '' && row[5] !== undefined)
    .map(row => String(row[0] || '').split('.')[0].trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

  if (!playedMatchdays.length) return null;
  return String(Math.max(...playedMatchdays));
}

function splitPlayerEntries(value) {
  return String(value || '')
    .split(',')
    .map(item => item.replace(/^•\s*/, '').trim())
    .filter(Boolean);
}

function stripTeamPrefix(playerName, shortName) {
  const text = String(playerName || '').trim();
  const prefix = String(shortName || '').trim();
  if (!text || !prefix) return text;

  const upperText = text.toUpperCase();
  const upperPrefix = prefix.toUpperCase();

  if (upperText.startsWith(`${upperPrefix}-`)) {
    return text.slice(prefix.length + 1).trim();
  }

  if (upperText.startsWith(`${upperPrefix} -`)) {
    return text.slice(prefix.length + 2).trim();
  }

  return text;
}

function resolveCardedPlayers(listText, pending) {
  const entries = splitPlayerEntries(listText);

  return entries.map(entry => {
    const upperEntry = entry.toUpperCase();
    const homeShort = String(pending.homeShort || '').trim();
    const awayShort = String(pending.awayShort || '').trim();

    if (homeShort && upperEntry.startsWith(homeShort.toUpperCase())) {
      return {
        playerName: stripTeamPrefix(entry, homeShort),
        teamName: pending.homeTeam,
        teamShort: pending.homeShort
      };
    }

    if (awayShort && upperEntry.startsWith(awayShort.toUpperCase())) {
      return {
        playerName: stripTeamPrefix(entry, awayShort),
        teamName: pending.awayTeam,
        teamShort: pending.awayShort
      };
    }

    return {
      playerName: entry,
      teamName: '',
      teamShort: ''
    };
  }).filter(item => item.playerName);
}

function buildSuspensionFixtureObjects(fixtureRows, fixtureIndexes) {
  return fixtureRows
    .map(row => ({
      matchNo: normalizeMatchNo(row?.[fixtureIndexes.matchNo]),
      homeTeam: clean(row?.[fixtureIndexes.homeTeam]),
      awayTeam: clean(row?.[fixtureIndexes.awayTeam]),
      homeShort: clean(row?.[fixtureIndexes.homeShort]),
      awayShort: clean(row?.[fixtureIndexes.awayShort]),
      hg: row?.[fixtureIndexes.hg],
      ag: row?.[fixtureIndexes.ag]
    }))
    .filter(fixture => fixture.matchNo);
}

async function assignNextBansFromPending(pending, guildId, fixtureRows) {
  const yellowPlayers = resolveCardedPlayers(pending.yellow, pending);
  const redPlayers = resolveCardedPlayers(pending.red, pending);
  const suspensionFixtures = buildSuspensionFixtureObjects(fixtureRows, pending.fixtureIndexes);

  for (const item of yellowPlayers) {
    await assignNextBannedMatch({
      guildId,
      competition: pending.competition.key,
      playerName: item.playerName,
      teamName: item.teamName,
      teamShort: item.teamShort,
      fixtures: suspensionFixtures,
      afterMatchNo: pending.matchNo
    });
  }

  for (const item of redPlayers) {
    await assignNextBannedMatch({
      guildId,
      competition: pending.competition.key,
      playerName: item.playerName,
      teamName: item.teamName,
      teamShort: item.teamShort,
      fixtures: suspensionFixtures,
      afterMatchNo: pending.matchNo
    });
  }
}

async function persistSuspensionsFromPending(pending, guildId) {
  const yellowPlayers = resolveCardedPlayers(pending.yellow, pending);
  const redPlayers = resolveCardedPlayers(pending.red, pending);

  const yellowThreshold = getYellowThresholdForPending(pending.competition.key, pending.matchNo);

  for (const item of yellowPlayers) {
    await addYellowCard({
      guildId,
      competition: pending.competition.key,
      playerName: item.playerName,
      teamName: item.teamName,
      teamShort: item.teamShort,
      matchNo: pending.matchNo,
      threshold: yellowThreshold
    });
  }

  for (const item of redPlayers) {
    await addRedCard({
      guildId,
      competition: pending.competition.key,
      playerName: item.playerName,
      teamName: item.teamName,
      teamShort: item.teamShort,
      matchNo: pending.matchNo
    });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('Submit match result')
    .addStringOption(opt =>
      opt.setName('match').setDescription('Match number').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('homegoals').setDescription('Home goals').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('awaygoals').setDescription('Away goals').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('scorers').setDescription('Scorers separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('assists').setDescription('Assists separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('yellow').setDescription('Yellow cards separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('red').setDescription('Red cards separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('mvp').setDescription('MVP player').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('hometackles').setDescription('Home Tackles players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('awaytackles').setDescription('Away Tackles players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('homeinterceptions').setDescription('Home Interceptions players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('awayinterceptions').setDescription('Away Interceptions players, repeat names for counts').setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('homesaves').setDescription('Home team saves').setRequired(false).setMinValue(0)
    )
    .addIntegerOption(opt =>
      opt.setName('awaysaves').setDescription('Away team saves').setRequired(false).setMinValue(0)
    )
    .addStringOption(opt =>
      opt.setName('homeplayed').setDescription('Home players who played, separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('awayplayed').setDescription('Away players who played, separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('decision')
        .setDescription('ET H / ET A / PENS H / PENS A (for knockout)')
        .setRequired(false)
    ),

  async execute(interaction) {
    cleanPending(pendingResults);
    const matchNo = normalizeMatchNo(interaction.options.getString('match'));
    const competition = getCompetitionConfig(matchNo);
    const fixtureIndexes = getFixtureFieldIndexes(competition);
    const hg = interaction.options.getInteger('homegoals');
    const ag = interaction.options.getInteger('awaygoals');
    const decisionRaw = interaction.options.getString('decision') || '';
    const decision = decisionRaw ? decisionRaw.toUpperCase().trim() : '';

    const scorersRaw = interaction.options.getString('scorers') || '';
    const assistsRaw = interaction.options.getString('assists') || '';
    const yellowRaw = interaction.options.getString('yellow') || '';
    const redRaw = interaction.options.getString('red') || '';
    const mvpRaw = interaction.options.getString('mvp') || '';
    const homePlayedRaw = interaction.options.getString('homeplayed') || '';
    const awayPlayedRaw = interaction.options.getString('awayplayed') || '';

    const fixtures = await getData(competition.fixturesRange);
    const teams = await getData('Teams!A:Z');
    const matchesEntry = await getData(competition.resultsRange);
    const reserveSheet = await getData(RESERVE_SHEET_RANGE).catch(() => []);

    const fixtureRows = fixtures.slice(1);
    const fixtureIndex = fixtureRows.findIndex(r => normalizeMatchNo(r[fixtureIndexes.matchNo]) === matchNo);

    if (fixtureIndex === -1) {
      return { content: `${E.wrong} Match not found` };
    }

    const fixture = fixtureRows[fixtureIndex];
    const reserveRows = Array.isArray(reserveSheet) ? reserveSheet.slice(1) : [];
    const reserveRow = reserveRows.find(row => normalizeMatchNo(row[1]) === matchNo && clean(row[0]).toLowerCase() === competition.reserveKey.toLowerCase());
    const reservedBy = String(reserveRow?.[3] || '').trim();

    const allowedMD = competition.key === 'league' ? getAllowedMatchday(fixtures) : null;
    const fixtureMD = String(fixture[fixtureIndexes.matchNo] || '').split('.')[0].trim();
    const activeMD = String(allowedMD || '').split('.')[0].trim();
    const recentPlayedMD = competition.key === 'league' ? getMostRecentPlayedMatchday(fixtureRows.map(row => {
      const copy = [...row];
      copy[0] = row[fixtureIndexes.matchNo];
      copy[4] = row[fixtureIndexes.hg];
      copy[5] = row[fixtureIndexes.ag];
      return copy;
    })) : null;

    const existingMatchEntry = matchesEntry
      .slice(1)
      .some(row => normalizeMatchNo(row[0]) === matchNo);

    const alreadyPlayedInFixtures = fixture[fixtureIndexes.hg] !== '' && fixture[fixtureIndexes.hg] !== undefined && fixture[fixtureIndexes.ag] !== '' && fixture[fixtureIndexes.ag] !== undefined;

    // Allow resubmitting if the match already exists,
    // or if it belongs to the most recent played matchday (useful after manual deletion/correction).
    const canBypassMatchdayLock =
      existingMatchEntry ||
      alreadyPlayedInFixtures ||
      (recentPlayedMD && fixtureMD === recentPlayedMD);

    if (competition.key === 'league' && allowedMD && fixtureMD !== activeMD && !canBypassMatchdayLock) {
      return {
        content: `${E.lock} Matchday locked.\n\n${E.correct} Current active matchday: **${activeMD}**\n🛠️ Last editable matchday: **${recentPlayedMD || 'None'}**\n${E.wrong} You tried: **${fixtureMD}**`
      };
    }

    const homeShort = fixture[fixtureIndexes.homeShort] || '';
    const awayShort = fixture[fixtureIndexes.awayShort] || '';

    const homeRow = teams.find(t => t[2] === homeShort);
    const awayRow = teams.find(t => t[2] === awayShort);

    const homeTeam = homeRow?.[0] || fixture[fixtureIndexes.homeTeam] || 'Unknown';
    const awayTeam = awayRow?.[0] || fixture[fixtureIndexes.awayTeam] || 'Unknown';

    const allowedUserIds = [
      ...getTeamUserIds(homeRow),
      ...getTeamUserIds(awayRow)
    ];

    const canBypassTeamPermission = isPrivilegedAdmin(interaction);

    if (!canBypassTeamPermission && !allowedUserIds.includes(interaction.user.id)) {
      return {
        content: `${E.lock} Only captains/registered players from **${homeShort || homeTeam}** or **${awayShort || awayTeam}** can submit this result.`
      };
    }

    if (!canBypassTeamPermission && !existingMatchEntry) {
      const dailyLimit = await checkDailyResultLimit({
        competition,
        homeTeam,
        awayTeam,
        matchNo
      });

      if (!dailyLimit.ok) {
        return {
          content:
            `${E.lock} Daily result limit reached.\n\n` +
            `${dailyLimit.reason}\n\n` +
            `Limits: League **${getCompetitionDailyLimit('league')}**, UCL **${getCompetitionDailyLimit('ucl')}**, Cups **${getCompetitionDailyLimit('fa')}**, Total **${getTotalDailyLimit()}** per team per day.\n` +
            `Admins can bypass this limit if needed.`
        };
      }
    }

    const homePlayers = homeRow?.[1] || '';
    const awayPlayers = awayRow?.[1] || '';

    const scorers = preserveExplicitPrefixes(
      scorersRaw,
      buildMixedPrefixList(scorersRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const assists = preserveExplicitPrefixes(
      assistsRaw,
      buildMixedPrefixList(assistsRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const yellow = preserveExplicitPrefixes(
      yellowRaw,
      buildMixedPrefixList(yellowRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const red = preserveExplicitPrefixes(
      redRaw,
      buildMixedPrefixList(redRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const mvp = preserveExplicitPrefixes(
      mvpRaw,
      buildMixedPrefixList(mvpRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const homePlayed = preserveExplicitPrefixes(
      homePlayedRaw,
      buildMixedPrefixList(homePlayedRaw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const awayPlayed = preserveExplicitPrefixes(
      awayPlayedRaw,
      buildMixedPrefixList(awayPlayedRaw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );

    const tackles1Raw = interaction.options.getString('hometackles') || '';
    const tackles2Raw = interaction.options.getString('awaytackles') || '';
    const interceptions1Raw = interaction.options.getString('homeinterceptions') || '';
    const interceptions2Raw = interaction.options.getString('awayinterceptions') || '';
    const saves1 = interaction.options.getInteger('homesaves') || 0;
    const saves2 = interaction.options.getInteger('awaysaves') || 0;

    const tackles1 = preserveExplicitPrefixes(
      tackles1Raw,
      buildMixedPrefixList(tackles1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const tackles2 = preserveExplicitPrefixes(
      tackles2Raw,
      buildMixedPrefixList(tackles2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );
    const interceptions1 = preserveExplicitPrefixes(
      interceptions1Raw,
      buildMixedPrefixList(interceptions1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const interceptions2 = preserveExplicitPrefixes(
      interceptions2Raw,
      buildMixedPrefixList(interceptions2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );

    const resultText = hg > ag ? 'H' : hg < ag ? 'A' : 'D';

    pendingResults.set(interaction.user.id, {
      matchNo,
      competition,
      fixtureIndexes,
      fixtureIndex,
      hg,
      ag,
      homeShort,
      awayShort,
      homeTeam,
      awayTeam,
      scorers,
      assists,
      yellow,
      red,
      mvp,
      homePlayed,
      awayPlayed,
      reservedBy,
      resultText,
      decision,
      tackles1,
      tackles2,
      interceptions1,
      interceptions2,
      saves1,
      saves2,
      submittedAt: new Date().toISOString(),
      createdAt: Date.now()
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`result_confirm_${matchNo}`)
        .setEmoji(parseCustomEmoji(E.confirm))
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('result_cancel_keep')
        .setEmoji(parseCustomEmoji(E.cancel))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.calendar, '📅')} ${competition.label} Result Preview`)
          .setDescription(
            `### ${homeShort || homeTeam} ${safeEmoji(E.vs, '⚔️')} ${awayShort || awayTeam}\n` +
            `# ${hg}-${ag}\n` +
            `**Competition:** ${competition.label} • **Match:** ${matchNo} • **Result:** ${resultText}\n` +
            `**Tag:** ${scoreTag(hg, ag)}`
          )
          .addFields(
            { name: `${safeEmoji(E.goal, '⚽')} Scorers`, value: compactList(scorers), inline: true },
            { name: `${safeEmoji(E.assist, '🎯')} Assists`, value: compactList(assists), inline: true },
            { name: `${safeEmoji(E.mvp, '⭐')} MVP`, value: compactList(mvp), inline: true },
            { name: `${safeEmoji(E.home || E.team, '🏠')} Home Played`, value: compactList(homePlayed), inline: true },
            { name: `${safeEmoji(E.away || E.team, '🚩')} Away Played`, value: compactList(awayPlayed), inline: true },
            { name: `${safeEmoji(E.calendar, '📅')} Reserve`, value: reservedBy ? `Reserved by **${reservedBy}**` : 'No reserve entry', inline: true },
            { name: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`, value: compactList(yellow), inline: true },
            { name: `${safeEmoji(E.redCard, '🟥')} Red Cards`, value: compactList(red), inline: true },
            { name: `${safeEmoji(E.tackle, '🛡️')} Home Tackles / Away Tackles`, value: `**Home Tackles — ${homeShort || homeTeam} (${repeatedCount(tackles1)}):**\n${compactCountList(tackles1)}\n\n**Away Tackles — ${awayShort || awayTeam} (${repeatedCount(tackles2)}):**\n${compactCountList(tackles2)}`, inline: true },
            { name: `${safeEmoji(E.interception, '✂️')} Home Interceptions / Away Interceptions`, value: `**Home Interceptions — ${homeShort || homeTeam} (${repeatedCount(interceptions1)}):**\n${compactCountList(interceptions1)}\n\n**Away Interceptions — ${awayShort || awayTeam} (${repeatedCount(interceptions2)}):**\n${compactCountList(interceptions2)}`, inline: true },
            { name: `${safeEmoji(E.save, '🧤')} Saves`, value: `**${homeShort || homeTeam}:** ${saves1}\n**${awayShort || awayTeam}:** ${saves2}`, inline: true },
            { name: `${safeEmoji(E.lock, '🔒')} Daily Limits`, value: `League: **${getCompetitionDailyLimit('league')}** • UCL: **${getCompetitionDailyLimit('ucl')}** • Cups: **${getCompetitionDailyLimit('fa')}** • Total: **${getTotalDailyLimit()}**`, inline: false },
            { name: `${safeEmoji(E.confirm, '✅')} Confirmation`, value: 'Review everything, then press **Confirm** to save to Sheets.', inline: false }
          )
          .setColor(0xF1C40F)
          .setFooter({ text: 'Preview expires in 5 minutes' })
      ],
      components: [buttons]
    };
  },

  async buttonHandler(interaction, action) {
    cleanPending(pendingResults);
    if (action === 'cancel') {
      pendingResults.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${E.wrong} Result Cancelled`)
            .setDescription('No result was saved.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const pending = pendingResults.get(interaction.user.id);
    if (!pending) {
      return {
        content: `${E.wrong} Result preview expired. Run /result again.`,
        components: []
      };
    }

    const standingsBefore = pending.competition.standingsRange ? await getData(pending.competition.standingsRange) : [];
    const beforeRanks = pending.competition.standingsRange ? getRankMap(standingsBefore) : new Map();

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${E.save} Saving Result...`)
          .setDescription(`Saving **${pending.matchNo}** and updating live standings.`)
          .setColor(0xE67E22)
      ],
      components: []
    });

    const currentEntries = await getData(pending.competition.resultsRange);
    const reserveSheet = await getData(RESERVE_SHEET_RANGE).catch(() => []);
    const existingEntryIndex = currentEntries
      .slice(1)
      .findIndex(row => normalizeMatchNo(row[0]) === pending.matchNo);

    const entryRows = currentEntries.slice(1).map(row => [...row]);
    const nextEntryRow = [
      pending.matchNo,
      pending.homeTeam,
      pending.awayTeam,
      pending.hg,
      pending.ag,
      pending.scorers,
      pending.assists,
      pending.yellow,
      pending.red,
      pending.mvp,
      pending.tackles1,
      pending.tackles2,
      pending.interceptions1,
      pending.interceptions2,
      pending.saves1,
      pending.saves2,
      pending.homePlayed,
      pending.awayPlayed,
      pending.submittedAt || new Date().toISOString(),
      pending.decision || ''
    ];

    if (existingEntryIndex === -1) {
      entryRows.push(nextEntryRow);
    } else {
      entryRows[existingEntryIndex] = nextEntryRow;
    }

    await updateData(`${pending.competition.resultsRange.split('!')[0]}!A2:T`, entryRows);
    const reserveRows = Array.isArray(reserveSheet) ? reserveSheet.slice(1).map(row => [...row]) : [];
    const reserveIndex = reserveRows.findIndex(row => normalizeMatchNo(row[1]) === pending.matchNo && clean(row[0]).toLowerCase() === pending.competition.reserveKey.toLowerCase());

    if (reserveIndex !== -1) {
      reserveRows.splice(reserveIndex, 1);
      await updateData('Reserve!A2:F', reserveRows);
    }

    const fixtures = await getData(pending.competition.fixturesRange);
    const fixtureRows = fixtures.slice(1);

    if (!fixtureRows[pending.fixtureIndex]) {
      pendingResults.delete(interaction.user.id);
      return {
        content: `${E.wrong} Match could not be found while saving.`,
        components: []
      };
    }
    try {
      await persistSuspensionsFromPending(pending, interaction.guild.id);
    } catch (error) {
      console.error('Suspension MongoDB update error:', error);
    }

    fixtureRows[pending.fixtureIndex][pending.fixtureIndexes.hg] = pending.hg;
    fixtureRows[pending.fixtureIndex][pending.fixtureIndexes.ag] = pending.ag;
    fixtureRows[pending.fixtureIndex][pending.fixtureIndexes.result] = pending.resultText;
    if (pending.fixtureIndexes.status !== null && pending.fixtureIndexes.status !== undefined) {
      fixtureRows[pending.fixtureIndex][pending.fixtureIndexes.status] = 'Done';
    }

    await updateData(pending.competition.fixturesSaveRange, fixtureRows);

    try {
      const refreshedFixtures = await getData(pending.competition.fixturesRange);
      const refreshedFixtureRows = refreshedFixtures.slice(1);
      await assignNextBansFromPending(pending, interaction.guild.id, refreshedFixtureRows);
    } catch (error) {
      console.error('Suspension next-ban assignment error:', error);
    }

    invalidateSheetCache([
      pending.competition.fixturesRange.split('!')[0] + '!',
      pending.competition.resultsRange.split('!')[0] + '!',
      'Reserve!',
      'Ranking!',
      'Standings!',
      'Fair_Play!',
      'Suspension!',
      'Team_Stats!',
      'FA_Cup_Coop_Ranking!',
      'Carabao_Coop_Ranking!',
      'UCL_Coop_Ranking!',
      'FA_Cup_Coop_Suspension!',
      'Carabao_Coop_Suspension!',
      'UCL_Coop_Suspension!',
      'UCL_Coop_Group_Standings!'
    ]);

    const liveResult = pending.competition.key === 'league'
      ? await refreshLiveStandings(interaction.client, interaction.guild.id)
      : { ok: true, reason: `${pending.competition.label} result saved` };
    const liveStatus = liveResult.ok ? '✅ Updated' : `⚠️ ${liveResult.reason}`;

    const completedMd = String(pending.matchNo || '').split('.')[0].trim();
    let summaryStatus = pending.competition.weeklySummary ? 'Not posted' : 'Not used for this competition';

    if (pending.competition.weeklySummary && isMatchdayComplete(fixtureRows.map(row => {
      const copy = [...row];
      copy[0] = row[pending.fixtureIndexes.matchNo];
      copy[4] = row[pending.fixtureIndexes.hg];
      copy[5] = row[pending.fixtureIndexes.ag];
      return copy;
    }), completedMd)) {
      const summaryChannelId = String(
        process.env.WEEKLY_SUMMARY_CHANNEL_ID ||
        process.env.WEEKLYSUMMARYCHANNELID ||
        ''
      ).trim();

      if (!summaryChannelId) {
        summaryStatus = '⚠️ Weekly summary channel not configured';
      } else {
        try {
          const channel = await interaction.client.channels.fetch(summaryChannelId);
          const summary = await buildWeeklySummaryPayload(completedMd);

          if (summary?.embed && channel && typeof channel.send === 'function') {
            await channel.send({
              content: `📢 **Matchday ${completedMd} completed — Weekly Summary**`,
              embeds: [summary.embed]
            });
            summaryStatus = `✅ Posted in <#${summaryChannelId}>`;
          } else {
            summaryStatus = '⚠️ Could not build weekly summary';
          }
        } catch (error) {
          summaryStatus = '⚠️ Weekly summary post failed';
        }
      }
    }

    const standingsAfter = pending.competition.standingsRange ? await getData(pending.competition.standingsRange) : [];
    const afterRanks = pending.competition.standingsRange ? getRankMap(standingsAfter) : new Map();

    const displayKeys = getStandingsDisplayKeys(pending, pending.competition);

    const homeBeforeRank =
      beforeRanks.get(normalizeTeamKey(displayKeys.homeTeam)) ??
      beforeRanks.get(normalizeTeamKey(displayKeys.homeShort));
    const homeAfterRank =
      afterRanks.get(normalizeTeamKey(displayKeys.homeTeam)) ??
      afterRanks.get(normalizeTeamKey(displayKeys.homeShort));

    const awayBeforeRank =
      beforeRanks.get(normalizeTeamKey(displayKeys.awayTeam)) ??
      beforeRanks.get(normalizeTeamKey(displayKeys.awayShort));
    const awayAfterRank =
      afterRanks.get(normalizeTeamKey(displayKeys.awayTeam)) ??
      afterRanks.get(normalizeTeamKey(displayKeys.awayShort));

    const homeMovement = movementLabel(homeBeforeRank, homeAfterRank);
    const awayMovement = movementLabel(awayBeforeRank, awayAfterRank);

    pendingResults.delete(interaction.user.id);

    sendAuditLog(interaction, {
      title: `${E.goal} ${pending.competition.label} Result Saved`,
      description: `**${pending.matchNo}** | ${pending.homeShort || pending.homeTeam} ${pending.hg}-${pending.ag} ${pending.awayShort || pending.awayTeam} (${pending.resultText})`,
      color: 0x2ECC71,
      fields: [
        { name: `${E.goal} Scorers`, value: pending.scorers || 'None', inline: false },
        { name: `${E.assist} Assists`, value: pending.assists || 'None', inline: false },
        { name: `${safeEmoji(E.home || E.team, '🏠')} Home Played`, value: pending.homePlayed || 'None', inline: true },
        { name: `${safeEmoji(E.away || E.team, '🚩')} Away Played`, value: pending.awayPlayed || 'None', inline: true },
        { name: `${safeEmoji(E.calendar, '📅')} Reserve`, value: pending.reservedBy ? `Cleared reserve by ${pending.reservedBy} (${pending.competition.label})` : 'No reserve entry', inline: false },
        { name: `${safeEmoji(E.lock, '🔒')} Daily Limit`, value: `Submitted At: ${pending.submittedAt || 'N/A'}`, inline: false },
        {
          name: `${safeEmoji(E.tackle, '🛡️')} Defensive Stats`,
          value:
            `**Home Tackles:** ${pending.tackles1 || 'None'}\n` +
            `**Away Tackles:** ${pending.tackles2 || 'None'}\n` +
            `**Home Interceptions:** ${pending.interceptions1 || 'None'}\n` +
            `**Away Interceptions:** ${pending.interceptions2 || 'None'}\n` +
            `**Home Saves / Away Saves:** ${pending.saves1}-${pending.saves2}`,
          inline: false
        },
        { name: `${E.played} Live Standings`, value: liveStatus, inline: false },
        { name: `${E.calendar} Weekly Summary`, value: summaryStatus, inline: false }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.goal, '⚽')} ${pending.competition.label} Match Report`)
          .setDescription(
            `### ${pending.homeShort || pending.homeTeam} ${safeEmoji(E.vs, '⚔️')} ${pending.awayShort || pending.awayTeam}\n` +
            `# ${pending.hg}-${pending.ag}\n` +
            `**Competition:** ${pending.competition.label} • **Match:** ${pending.matchNo} • **Result:** ${pending.resultText}\n` +
            `**Tag:** ${scoreTag(pending.hg, pending.ag)}`
          )
          .addFields(
            { name: `${safeEmoji(E.goal, '⚽')} Scorers`, value: compactList(pending.scorers), inline: true },
            { name: `${safeEmoji(E.assist, '🎯')} Assists`, value: compactList(pending.assists), inline: true },
            { name: `${safeEmoji(E.mvp, '⭐')} MVP`, value: compactList(pending.mvp), inline: true },
            { name: `${safeEmoji(E.home || E.team, '🏠')} Home Played`, value: compactList(pending.homePlayed), inline: true },
            { name: `${safeEmoji(E.away || E.team, '🚩')} Away Played`, value: compactList(pending.awayPlayed), inline: true },
            { name: `${safeEmoji(E.calendar, '📅')} Reserve`, value: pending.reservedBy ? `Cleared reserve by **${pending.reservedBy}**` : 'No reserve entry', inline: true },
            { name: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`, value: compactList(pending.yellow), inline: true },
            { name: `${safeEmoji(E.redCard, '🟥')} Red Cards`, value: compactList(pending.red), inline: true },
            { name: `${safeEmoji(E.tackle, '🛡️')} Home Tackles / Away Tackles`, value: `**Home Tackles — ${pending.homeShort || pending.homeTeam} (${repeatedCount(pending.tackles1)}):**\n${compactCountList(pending.tackles1)}\n\n**Away Tackles — ${pending.awayShort || pending.awayTeam} (${repeatedCount(pending.tackles2)}):**\n${compactCountList(pending.tackles2)}`, inline: true },
            { name: `${safeEmoji(E.interception, '✂️')} Home Interceptions / Away Interceptions`, value: `**Home Interceptions — ${pending.homeShort || pending.homeTeam} (${repeatedCount(pending.interceptions1)}):**\n${compactCountList(pending.interceptions1)}\n\n**Away Interceptions — ${pending.awayShort || pending.awayTeam} (${repeatedCount(pending.interceptions2)}):**\n${compactCountList(pending.interceptions2)}`, inline: true },
            { name: `${safeEmoji(E.save, '🧤')} Saves`, value: `**${pending.homeShort || pending.homeTeam}:** ${pending.saves1}\n**${pending.awayShort || pending.awayTeam}:** ${pending.saves2}`, inline: true },
            { name: `${safeEmoji(E.lock, '🔒')} Daily Limit`, value: `Saved at **${pending.submittedAt || 'N/A'}**`, inline: false },
            { name: `${safeEmoji(E.up, '📈')} Table Movement`, value: `**${pending.homeShort || pending.homeTeam}:** ${homeMovement}\n**${pending.awayShort || pending.awayTeam}:** ${awayMovement}`, inline: false },
            { name: `${safeEmoji(E.played, '🎮')} Live Standings`, value: liveStatus, inline: true },
            { name: `${safeEmoji(E.calendar, '📅')} Weekly Summary`, value: summaryStatus, inline: true }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: `${pending.competition.label} result saved successfully • Sheets updated` })
      ],
      components: []
    };
  }
};
