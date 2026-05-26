require('dotenv').config();
const path = require('path');
const { google } = require('googleapis');

const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), 'credentials.json');
const SPREADSHEET_ID = process.env.SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const CACHE_TTL = Number(process.env.SHEETS_CACHE_TTL || 15000);
const MAX_RETRIES = Number(process.env.SHEETS_MAX_RETRIES || 3);
const cache = new Map();
const cacheInvalidators = new Set();

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSpreadsheetId(options = {}) {
  if (typeof options === 'string') {
    return options || SPREADSHEET_ID;
  }

  return options?.spreadsheetId || SPREADSHEET_ID;
}

function assertSpreadsheetId(spreadsheetId) {
  if (!spreadsheetId) {
    throw new Error('SHEET_ID is missing in .env');
  }
}

function cacheKey(spreadsheetId, range) {
  return `${spreadsheetId}:${range}`;
}

function getRangeFromCacheKey(key) {
  const separatorIndex = key.indexOf(':');
  return separatorIndex === -1 ? key : key.slice(separatorIndex + 1);
}

function cloneSheetValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map(row => {
    if (Array.isArray(row)) return [...row];
    if (row && typeof row === 'object') return { ...row };
    return row;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function notifyCacheInvalidators(payload) {
  for (const invalidator of cacheInvalidators) {
    try {
      invalidator(payload);
    } catch (error) {
      console.warn('⚠️ Cache invalidator failed:', error);
    }
  }
}

function registerCacheInvalidator(invalidator) {
  if (typeof invalidator !== 'function') {
    return () => {};
  }

  cacheInvalidators.add(invalidator);
  return () => {
    cacheInvalidators.delete(invalidator);
  };
}

function normalizeError(error, action, range) {
  const status = error?.response?.status || error?.code || 'UNKNOWN';
  const message = error?.response?.data?.error?.message || error?.message || 'Unknown Google Sheets error';
  const normalized = new Error(`Google Sheets ${action} failed [${status}] for ${range}: ${message}`);
  normalized.cause = error;
  return normalized;
}

function shouldRetry(error) {
  const status = Number(error?.response?.status || error?.code || 0);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function withRetry(action, range, fn) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!shouldRetry(error) || attempt === MAX_RETRIES) {
        throw normalizeError(error, action, range);
      }

      const delay = 500 * attempt;
      console.warn(`⚠️ Sheets ${action} retry ${attempt}/${MAX_RETRIES} for ${range} in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw normalizeError(lastError, action, range);
}

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() - item.createdAt > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return cloneSheetValues(item.values);
}

function setCached(key, values) {
  cache.set(key, {
    values: cloneSheetValues(values),
    createdAt: Date.now(),
  });
}

function clearCache(range) {
  if (!range) {
    cache.clear();
    notifyCacheInvalidators({ type: 'all' });
    return;
  }

  let deleted = false;
  for (const key of cache.keys()) {
    if (key.endsWith(`:${range}`)) {
      cache.delete(key);
      deleted = true;
    }
  }

  if (deleted) {
    notifyCacheInvalidators({ type: 'exact', range });
  }
}

function clearCacheByPrefixes(prefixes = []) {
  const activePrefixes = safeArray(prefixes).filter(Boolean);

  if (!activePrefixes.length) {
    clearCache();
    return;
  }

  let deleted = false;
  for (const key of cache.keys()) {
    const range = getRangeFromCacheKey(key);

    if (activePrefixes.some(prefix => range.startsWith(prefix))) {
      cache.delete(key);
      deleted = true;
    }
  }

  if (deleted) {
    notifyCacheInvalidators({ type: 'prefixes', prefixes: activePrefixes });
  }
}

async function getData(range, options = {}) {
  const spreadsheetId = getSpreadsheetId(options);
  assertSpreadsheetId(spreadsheetId);

  const key = cacheKey(spreadsheetId, range);
  const useCache = options.cache !== false;
  if (useCache) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const res = await withRetry('read', range, () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    })
  );

  const values = cloneSheetValues(res?.data?.values || []);
  if (useCache) setCached(key, values);
  return cloneSheetValues(values);
}

async function appendData(range, values, options = {}) {
  const spreadsheetId = getSpreadsheetId(options);
  assertSpreadsheetId(spreadsheetId);

  const normalizedValues = safeArray(values);
  if (!normalizedValues.length) {
    return { skipped: true, reason: 'No rows to append' };
  }

  const res = await withRetry('append', range, () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: options.valueInputOption || 'USER_ENTERED',
      insertDataOption: options.insertDataOption || 'INSERT_ROWS',
      resource: { values: normalizedValues },
    })
  );

  clearCache();
  return res;
}

async function updateData(range, values, options = {}) {
  const spreadsheetId = getSpreadsheetId(options);
  assertSpreadsheetId(spreadsheetId);

  const normalizedValues = safeArray(values);

  const res = await withRetry('update', range, () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: options.valueInputOption || 'USER_ENTERED',
      resource: { values: normalizedValues },
    })
  );

  clearCache();
  return res;
}

async function addSheetIfMissing(title, options = {}) {
  const spreadsheetId = getSpreadsheetId(options);
  assertSpreadsheetId(spreadsheetId);

  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    throw new Error('Sheet title is required');
  }

  const meta = await withRetry('metadata', cleanTitle, () =>
    sheets.spreadsheets.get({
      spreadsheetId,
    })
  );

  const exists = meta?.data?.sheets?.some(sheet => sheet.properties?.title === cleanTitle);
  if (exists) return false;

  const res = await withRetry('addSheet', cleanTitle, () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: cleanTitle },
            },
          },
        ],
      },
    })
  );

  clearCache();
  return res;
}

module.exports = {
  getData,
  appendData,
  updateData,
  addSheetIfMissing,
  getSpreadsheetId,
  assertSpreadsheetId,
  clearCache,
  clearCacheByPrefixes,
  registerCacheInvalidator,
};
