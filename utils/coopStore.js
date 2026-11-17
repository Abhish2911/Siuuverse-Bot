const CoopTable = require('../models/coop/CoopTable');
const { connectCoopMongo } = require('./coopMongo');

function parseColumn(value) {
  return String(value || '').toUpperCase().split('').reduce((total, letter) =>
    total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseA1Range(range) {
  const separator = String(range || '').lastIndexOf('!');
  if (separator < 0) throw new Error(`Invalid COOP data range: ${range}`);

  const table = range.slice(0, separator).replace(/^'|'$/g, '').replace(/''/g, "'");
  const cells = range.slice(separator + 1);
  const match = cells.match(/^\$?([A-Z]+)(\d+)?:\$?([A-Z]+)?(\d+)?$/i);
  if (!table || !match) throw new Error(`Unsupported COOP data range: ${range}`);

  return {
    table,
    startColumn: parseColumn(match[1]),
    startRow: Number(match[2] || 1),
    endColumn: match[3] ? parseColumn(match[3]) : parseColumn(match[1]),
    endRow: match[4] ? Number(match[4]) : null
  };
}

function cleanRow(row) {
  return Array.isArray(row) ? row : [];
}

function columnCount(range) {
  return range.endColumn - range.startColumn + 1;
}

async function getTable(tableName) {
  await connectCoopMongo();
  return CoopTable.findOne({ name: tableName }).lean();
}

async function getData(range) {
  const parsed = parseA1Range(range);
  const table = await getTable(parsed.table);
  if (!table) return [];
  if (!(table.headers || []).length && !(table.rows || []).length) return [];

  const rows = [cleanRow(table.headers), ...(table.rows || []).map(cleanRow)];
  const first = Math.max(0, parsed.startRow - 1);
  const last = parsed.endRow === null ? rows.length : Math.min(rows.length, parsed.endRow);

  return rows.slice(first, last).map(row =>
    Array.from({ length: columnCount(parsed) }, (_, index) =>
      row[parsed.startColumn + index] ?? '')
  );
}

async function updateData(range, values) {
  const parsed = parseA1Range(range);
  const incomingRows = Array.isArray(values) ? values : [];
  await connectCoopMongo();

  let table = await CoopTable.findOne({ name: parsed.table });
  if (!table) {
    table = new CoopTable({ name: parsed.table, headers: [], rows: [] });
  }

  const allRows = [cleanRow(table.headers), ...(table.rows || []).map(cleanRow)];
  const width = columnCount(parsed);

  incomingRows.forEach((incoming, rowIndex) => {
    const rowNumber = parsed.startRow + rowIndex;
    if (parsed.endRow !== null && rowNumber > parsed.endRow) return;

    const targetIndex = rowNumber - 1;
    while (allRows.length <= targetIndex) allRows.push([]);
    const target = [...allRows[targetIndex]];
    const cells = cleanRow(incoming);

    for (let columnIndex = 0; columnIndex < Math.min(cells.length, width); columnIndex += 1) {
      target[parsed.startColumn + columnIndex] = cells[columnIndex] ?? '';
    }
    allRows[targetIndex] = target;
  });

  table.headers = allRows[0] || [];
  table.rows = allRows.slice(1);
  await table.save();
  return { updatedRows: incomingRows.length };
}

async function appendData(range, values) {
  const parsed = parseA1Range(range);
  const incomingRows = Array.isArray(values) ? values : [];
  if (!incomingRows.length) return { skipped: true, reason: 'No rows to append' };

  await connectCoopMongo();
  let table = await CoopTable.findOne({ name: parsed.table });
  if (!table) table = new CoopTable({ name: parsed.table, headers: [], rows: [] });

  const width = columnCount(parsed);
  const rows = (table.rows || []).map(row => cleanRow(row));
  for (const incoming of incomingRows) {
    const cells = cleanRow(incoming).slice(0, width);
    const row = Array(parsed.startColumn).fill('').concat(cells);
    rows.push(row);
  }

  table.rows = rows;
  await table.save();
  return { appendedRows: incomingRows.length };
}

async function addTableIfMissing(tableName) {
  await connectCoopMongo();
  await CoopTable.updateOne(
    { name: tableName },
    { $setOnInsert: { name: tableName, headers: [], rows: [] } },
    { upsert: true }
  );
}

async function importTables(tables) {
  await connectCoopMongo();
  const operations = tables.map(table => ({
    updateOne: {
      filter: { name: table.name },
      update: {
        $setOnInsert: {
          name: table.name,
          headers: table.headers,
          rows: table.rows,
          sourceUpdatedAt: table.sourceUpdatedAt || null,
          migratedAt: new Date()
        }
      },
      upsert: true
    }
  }));

  if (!operations.length) return { upsertedCount: 0 };
  return CoopTable.bulkWrite(operations, { ordered: false });
}

module.exports = {
  addTableIfMissing,
  appendData,
  getData,
  importTables,
  parseA1Range,
  updateData
};
