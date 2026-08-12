const { PermissionFlagsBits } = require('discord.js');
const {
  getData,
  appendData,
  updateData,
  addSheetIfMissing,
  clearCacheByPrefixes
} = require('./sheets');

function getHFSpreadsheetId() {
  const spreadsheetId = String(process.env.HF_SHEET_ID || '').trim();

  if (!spreadsheetId) {
    throw new Error('HF_SHEET_ID is missing in .env');
  }

  return spreadsheetId;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compactKey(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function cleanId(value) {
  return String(value || '').replace(/[<@!>&]/g, '').trim();
}

function isCaptainValue(value) {
  return ['1', 'yes', 'y', 'true', 'captain', 'c'].includes(normalize(value));
}

function parsePlayers(rows) {
  return rows
    .slice(1)
    .map(row => ({
      team: String(row[0] || '').trim(),
      player: String(row[1] || '').trim(),
      userId: cleanId(row[2]),
      isCaptain: isCaptainValue(row[3])
    }))
    .filter(player => player.team && player.player && player.userId);
}

function parseTeams(rows) {
  return rows
    .slice(1)
    .map(row => ({
      team: String(row[0] || '').trim(),
      roleId: cleanId(row[1]),
      stadium: String(row[2] || '').trim(),
      logoUrl: String(row[3] || '').trim(),
      color: String(row[4] || '').trim()
    }))
    .filter(team => team.team);
}

function toNumber(value) {
  const number = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : 0;
}

function parseFixtures(rows) {
  const header = (rows[0] || []).map(value => compactKey(value));
  const hasMatchNo = ['matchno', 'matchnumber', 'match'].includes(header[0]);

  return rows
    .slice(1)
    .map((row, index) => {
      const matchNo = hasMatchNo ? row[0] : index + 1;
      const matchday = hasMatchNo ? row[1] : row[0];
      const home = hasMatchNo ? row[2] : row[1];
      const away = hasMatchNo ? row[3] : row[2];
      const homeGoals = String((hasMatchNo ? row[4] : row[3]) || '').trim();
      const awayGoals = String((hasMatchNo ? row[5] : row[4]) || '').trim();
      const status = String((hasMatchNo ? row[6] : row[5]) || '').trim();
      const venue = String((hasMatchNo ? row[9] || row[7] : row[6]) || '').trim();
      const hasScore = homeGoals !== '' && awayGoals !== '';

      return {
        index: index + 1,
        matchNo: String(matchNo || index + 1).trim(),
        matchday: String(matchday || '').trim(),
        home: String(home || '').trim(),
        away: String(away || '').trim(),
        homeGoals,
        awayGoals,
        status,
        date: '',
        time: '',
        venue,
        note: String(row[10] || '').trim(),
        played: hasScore || ['played', 'done', 'complete', 'completed'].includes(normalize(status))
      };
    })
    .filter(fixture => fixture.home && fixture.away);
}

async function loadHandFootballData() {
  const spreadsheetId = getHFSpreadsheetId();
  const [playerRows, teamRows, fixtureRows] = await Promise.all([
    getData('Team_Data!A:D', { spreadsheetId }),
    getData('Teams!A:E', { spreadsheetId }),
    getData('Fixtures!A:G', { spreadsheetId }).catch(() => [])
  ]);

  return {
    players: parsePlayers(Array.isArray(playerRows) ? playerRows : []),
    teams: parseTeams(Array.isArray(teamRows) ? teamRows : []),
    fixtures: parseFixtures(Array.isArray(fixtureRows) ? fixtureRows : [])
  };
}

function sameTeam(left, right) {
  return compactKey(left) === compactKey(right);
}

function findPlayerByUserId(players, userId) {
  const target = cleanId(userId);

  return players.find(player => player.userId === target) || null;
}

function findPlayerByName(players, query) {
  const target = compactKey(query);
  if (!target) return null;

  return players.find(player => {
    const playerKey = compactKey(player.player);
    return playerKey === target || playerKey.includes(target) || target.includes(playerKey);
  }) || null;
}

function findTeamByName(data, query) {
  const target = compactKey(query);
  if (!target) return null;

  const teamNames = new Set([
    ...data.teams.map(team => team.team),
    ...data.players.map(player => player.team)
  ].filter(Boolean));

  for (const teamName of teamNames) {
    const teamKey = compactKey(teamName);

    if (teamKey === target || teamKey.includes(target) || target.includes(teamKey)) {
      return {
        team: teamName,
        roleId: data.teams.find(team => sameTeam(team.team, teamName))?.roleId || ''
      };
    }
  }

  return null;
}

function findTeamMeta(teams, teamName) {
  return teams.find(team => sameTeam(team.team, teamName)) || {
    team: teamName,
    roleId: '',
    stadium: '',
    logoUrl: '',
    color: ''
  };
}

function getTeamRoster(players, teamName) {
  return players
    .filter(player => sameTeam(player.team, teamName))
    .sort((left, right) => {
      if (left.isCaptain !== right.isCaptain) return left.isCaptain ? -1 : 1;
      return left.player.localeCompare(right.player);
    });
}

function getTeamFixtures(fixtures, teamName) {
  return fixtures.filter(fixture => (
    sameTeam(fixture.home, teamName) ||
    sameTeam(fixture.away, teamName)
  ));
}

function getTeamRecord(fixtures, teamName) {
  const record = {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  };

  for (const fixture of getTeamFixtures(fixtures, teamName)) {
    if (!fixture.played) continue;

    const isHome = sameTeam(fixture.home, teamName);
    const goalsFor = toNumber(isHome ? fixture.homeGoals : fixture.awayGoals);
    const goalsAgainst = toNumber(isHome ? fixture.awayGoals : fixture.homeGoals);

    record.played += 1;
    record.goalsFor += goalsFor;
    record.goalsAgainst += goalsAgainst;

    if (goalsFor > goalsAgainst) {
      record.wins += 1;
      record.points += 3;
    } else if (goalsFor < goalsAgainst) {
      record.losses += 1;
    } else {
      record.draws += 1;
      record.points += 1;
    }
  }

  return record;
}

function getNextFixture(fixtures, teamName) {
  return getTeamFixtures(fixtures, teamName).find(fixture => !fixture.played) || null;
}

function mentionUser(userId) {
  return userId ? `<@${userId}>` : 'Unknown';
}

function getMentionedUserId(message) {
  return message.mentions?.users?.first()?.id || '';
}




function getOwnerIds() {
  return String(process.env.OWNER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
}

function isBotOwner(message) {
  return getOwnerIds().includes(message.author?.id);
}

function getRoleIdsFromEnv(...names) {
  return names
    .flatMap(name => String(process.env[name] || '').split(','))
    .map(cleanId)
    .filter(Boolean);
}

function memberHasAnyRole(message, roleIds) {
  if (!roleIds.length) return false;

  return roleIds.some(roleId => message.member?.roles?.cache?.has(roleId));
}

function canSubmitHFResult(message) {
  return (
    isBotOwner(message) ||
    memberHasAnyRole(message, getRoleIdsFromEnv('HF_RESULT_ROLE_ID', 'HF_RESULT_ROLE_IDS'))
  );
}

function canUseHFCaptainCommands(message) {
  return (
    isBotOwner(message) ||
    memberHasAnyRole(message, getRoleIdsFromEnv('HF_CAPTAIN_ROLE_ID', 'HF_CAPTAIN_ROLE_IDS'))
  );
}

function getHFCaptainRoleId() {
  return getRoleIdsFromEnv('HF_CAPTAIN_ROLE_ID', 'HF_CAPTAIN_ROLE_IDS')[0] || '';
}

function getFirstIdArg(args = []) {
  const firstArg = cleanId(args[0]);
  return /^\d{5,25}$/.test(firstArg) ? firstArg : '';
}

function getSearchText(args = []) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg))
    .join(' ')
    .trim();
}

function truncateField(value, limit = 1024) {
  const text = String(value || '').trim();

  if (text.length <= limit) {
    return text || 'N/A';
  }

  return `${text.slice(0, limit - 18).trim()}\n...and more`;
}

function canManageHandFootball(message) {
  return (
    isBotOwner(message) ||
    Boolean(message.member?.permissions?.has(PermissionFlagsBits.ManageGuild))
  );
}

function ensureHeader(rows, header) {
  if (Array.isArray(rows) && rows.length) {
    return rows;
  }

  return [header];
}

async function upsertHFPlayer({ team, player, userId, isCaptain }) {
  const spreadsheetId = getHFSpreadsheetId();
  const rows = ensureHeader(
    await getData('Team_Data!A:D', { spreadsheetId, cache: false }),
    ['TEAM', 'PLAYER', 'USER ID', 'Captain']
  );
  const cleanUserId = cleanId(userId);
  const nextRows = rows.map(row => [...row]);
  const rowIndex = nextRows
    .slice(1)
    .findIndex(row => cleanId(row[2]) === cleanUserId);
  const nextRow = [
    String(team || '').trim(),
    String(player || '').trim(),
    cleanUserId,
    isCaptain ? 'Yes' : ''
  ];

  if (rowIndex === -1) {
    await appendData('Team_Data!A:D', [nextRow], { spreadsheetId });
  } else {
    nextRows[rowIndex + 1] = nextRow;
    await updateData('Team_Data!A:D', nextRows, { spreadsheetId });
  }

  clearCacheByPrefixes(['Team_Data']);
}

async function removeHFPlayer(userId) {
  const spreadsheetId = getHFSpreadsheetId();
  const rows = ensureHeader(
    await getData('Team_Data!A:D', { spreadsheetId, cache: false }),
    ['TEAM', 'PLAYER', 'USER ID', 'Captain']
  );
  const cleanUserId = cleanId(userId);
  const rowIndex = rows.slice(1).findIndex(row => cleanId(row[2]) === cleanUserId);

  if (rowIndex === -1) return null;

  const nextRows = rows
    .filter((_, index) => index !== rowIndex + 1)
    .map(row => [...row]);

  // Keep the old range length so the removed final row is cleared in Sheets.
  nextRows.push(['', '', '', '']);

  await updateData('Team_Data!A:D', nextRows, { spreadsheetId });
  clearCacheByPrefixes(['Team_Data']);
  return true;
}

async function upsertHFTeamMeta(teamName, patch = {}) {
  const spreadsheetId = getHFSpreadsheetId();
  const rows = ensureHeader(
    await getData('Teams!A:E', { spreadsheetId, cache: false }),
    ['TEAM', 'Role ID', 'Stadium', 'Logo URL', 'Color']
  );
  const nextRows = rows.map(row => [...row]);
  const cleanTeamName = String(teamName || '').trim();
  const rowIndex = nextRows
    .slice(1)
    .findIndex(row => sameTeam(row[0], cleanTeamName));

  if (!cleanTeamName) {
    return false;
  }

  const targetRow = rowIndex === -1
    ? [cleanTeamName, '', '', '', '']
    : [
        nextRows[rowIndex + 1][0] || cleanTeamName,
        nextRows[rowIndex + 1][1] || '',
        nextRows[rowIndex + 1][2] || '',
        nextRows[rowIndex + 1][3] || '',
        nextRows[rowIndex + 1][4] || ''
      ];

  if (Object.prototype.hasOwnProperty.call(patch, 'roleId')) {
    targetRow[1] = cleanId(patch.roleId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'stadium')) {
    targetRow[2] = String(patch.stadium || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'logoUrl')) {
    targetRow[3] = String(patch.logoUrl || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
    targetRow[4] = String(patch.color || '').trim();
  }

  if (rowIndex === -1) {
    await appendData('Teams!A:E', [targetRow], { spreadsheetId });
  } else {
    nextRows[rowIndex + 1] = targetRow;
    await updateData('Teams!A:E', nextRows, { spreadsheetId });
  }

  clearCacheByPrefixes(['Teams']);
  return true;
}

async function setHFCaptain(teamName, userId) {
  const spreadsheetId = getHFSpreadsheetId();
  const rows = ensureHeader(
    await getData('Team_Data!A:D', { spreadsheetId, cache: false }),
    ['TEAM', 'PLAYER', 'USER ID', 'Captain']
  );
  const nextRows = rows.map(row => [...row]);
  const cleanUserId = cleanId(userId);
  const targetRow = nextRows
    .slice(1)
    .find(row => cleanId(row[2]) === cleanUserId);
  const targetTeam = String(teamName || targetRow?.[0] || '').trim();

  if (!targetTeam || !targetRow) {
    return false;
  }

  for (const row of nextRows.slice(1)) {
    if (sameTeam(row[0], targetTeam)) {
      row[3] = cleanId(row[2]) === cleanUserId ? 'Yes' : '';
    }
  }

  await updateData('Team_Data!A:D', nextRows, { spreadsheetId });
  clearCacheByPrefixes(['Team_Data']);
  return true;
}

async function getHFConfigRows() {
  const spreadsheetId = getHFSpreadsheetId();
  await addSheetIfMissing('Config', { spreadsheetId }).catch(() => null);

  const rows = ensureHeader(
    await getData('Config!A:B', { spreadsheetId, cache: false }).catch(() => []),
    ['KEY', 'VALUE']
  );

  if (rows.length === 1) {
    await updateData('Config!A:B', rows, { spreadsheetId });
  }

  return rows;
}

async function setHFConfigValue(key, value) {
  const spreadsheetId = getHFSpreadsheetId();
  const rows = await getHFConfigRows();
  const nextRows = rows.map(row => [...row]);
  const rowIndex = nextRows
    .slice(1)
    .findIndex(row => compactKey(row[0]) === compactKey(key));

  if (rowIndex === -1) {
    nextRows.push([key, value]);
  } else {
    nextRows[rowIndex + 1] = [key, value];
  }

  await updateData('Config!A:B', nextRows, { spreadsheetId });
  clearCacheByPrefixes(['Config']);
}

async function getHFConfigValue(key, fallback = '') {
  const rows = await getHFConfigRows();
  const row = rows
    .slice(1)
    .find(item => compactKey(item[0]) === compactKey(key));

  return String(row?.[1] ?? fallback).trim();
}

async function getHFTournamentRoleId() {
  return cleanId(await getHFConfigValue('Tournament Role ID'));
}

async function setHFRegistrationOpen(isOpen) {
  await setHFConfigValue('REGISTRATION_OPEN', isOpen ? 'TRUE' : 'FALSE');
}

async function isHFRegistrationOpen() {
  const value = await getHFConfigValue('REGISTRATION_OPEN', 'FALSE');
  return ['true', 'yes', 'open', 'on', 'start', 'started', '1'].includes(normalize(value));
}

module.exports = {
  getHFSpreadsheetId,
  loadHandFootballData,
  normalize,
  compactKey,
  cleanId,
  sameTeam,
  toNumber,
  findPlayerByUserId,
  findPlayerByName,
  findTeamByName,
  findTeamMeta,
  getTeamRoster,
  getTeamFixtures,
  getTeamRecord,
  getNextFixture,
  mentionUser,
  getMentionedUserId,
  getOwnerIds,
  getFirstIdArg,
  getSearchText,
  truncateField,
  isBotOwner,
  canSubmitHFResult,
  canUseHFCaptainCommands,
  getHFCaptainRoleId,
  canManageHandFootball,
  upsertHFPlayer,
  removeHFPlayer,
  upsertHFTeamMeta,
  getHFTournamentRoleId,
  isHFRegistrationOpen,
  setHFRegistrationOpen,
  setHFCaptain
};
