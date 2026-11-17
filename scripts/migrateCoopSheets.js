require('dotenv').config();

const { connectCoopMongo, connection } = require('../utils/coopMongo');
const { getData, getSheetNames } = require('../utils/sheets');
const { buildMigrationPayload } = require('../utils/coopMigration');
const { applyCoopMigration } = require('../utils/coopImport');

function readMode(args) {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) {
    throw new Error('Choose exactly one mode: --dry-run or --apply.');
  }
  if (apply && !args.includes('--confirm')) {
    throw new Error('Applying the migration requires both --apply and --confirm.');
  }
  return apply ? 'apply' : 'dry-run';
}

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function mapWithLimit(items, limit, mapper) {
  const results = Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readSourceTables() {
  const names = await getSheetNames();
  if (!names.length) throw new Error('No source Sheets tabs were found.');

  return mapWithLimit(names, 5, async name => {
    const values = await getData(`${quoteSheetName(name)}!A:ZZ`, { source: 'sheets', cache: false });
    return {
      name,
      headers: values[0] || [],
      rows: values.slice(1)
    };
  });
}

function summarize(payload) {
  const dataRows = payload.tables.reduce((total, table) => total + table.rows.length, 0);
  return {
    sourceTables: payload.tables.length,
    sourceRows: dataRows,
    seasons: payload.seasons.length,
    competitions: payload.competitions.length,
    teamSeasonRecords: payload.teamSeasons.length,
    playerSeasonRecords: payload.playerSeasons.length,
    awards: payload.awards.length,
    trophies: payload.trophies.length,
    blockingErrors: payload.blockingErrors,
    warnings: payload.warnings
  };
}

async function main() {
  const mode = readMode(process.argv.slice(2));
  const tables = await readSourceTables();
  const payload = buildMigrationPayload(tables);
  const preview = summarize(payload);

  console.log(`${mode === 'dry-run' ? 'Dry run' : 'Import'} summary:`);
  console.log(JSON.stringify({
    ...preview,
    sourceFingerprint: payload.sourceFingerprint.slice(0, 16)
  }, null, 2));

  if (mode === 'dry-run') {
    console.log('No MongoDB records were written.');
    return;
  }

  await connectCoopMongo();
  const result = await applyCoopMigration(payload);
  console.log(result.skipped
    ? `Migration already completed (${result.migrationId}); no data was changed.`
    : `Migration completed (${result.migrationId}).`);
  console.log(JSON.stringify(result.counts, null, 2));
}

main()
  .catch(error => {
    const messages = [
      process.env.COOP_MONGO_URI,
      process.env.MONGODB_URI,
      process.env.GOOGLE_CREDENTIALS,
      process.env.TOKEN
    ].filter(Boolean);
    let message = error?.message || 'Unknown error';
    for (const secret of messages) message = message.split(secret).join('[redacted]');
    console.error(`COOP migration failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (connection.readyState !== 0) {
      await connection.close().catch(() => {});
    }
  });
