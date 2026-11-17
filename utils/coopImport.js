const CoopTable = require('../models/coop/CoopTable');
const CoopSeason = require('../models/coop/CoopSeason');
const CoopCompetition = require('../models/coop/CoopCompetition');
const CoopTeamSeason = require('../models/coop/CoopTeamSeason');
const CoopPlayerSeason = require('../models/coop/CoopPlayerSeason');
const CoopAward = require('../models/coop/CoopAward');
const CoopTrophy = require('../models/coop/CoopTrophy');
const CoopMigrationRun = require('../models/coop/CoopMigrationRun');
const { connectCoopMongo } = require('./coopMongo');
const { importTables } = require('./coopStore');

async function bulkInsertIfMissing(model, documents, idField) {
  if (!documents.length) return 0;
  let inserted = 0;

  for (let offset = 0; offset < documents.length; offset += 500) {
    const chunk = documents.slice(offset, offset + 500);
    const result = await model.bulkWrite(
      chunk.map(document => ({
        updateOne: {
          filter: { [idField]: document[idField] },
          update: { $setOnInsert: document },
          upsert: true
        }
      })),
      { ordered: false }
    );
    inserted += result.upsertedCount || 0;
  }

  return inserted;
}

async function insertCoopHistory(payload) {
  await connectCoopMongo();
  const models = [
    CoopSeason,
    CoopCompetition,
    CoopTeamSeason,
    CoopPlayerSeason,
    CoopAward,
    CoopTrophy
  ];
  await Promise.all(models.map(model => model.createIndexes()));
  return {
    seasons: await bulkInsertIfMissing(CoopSeason, payload.seasons, 'seasonKey'),
    competitions: await bulkInsertIfMissing(CoopCompetition, payload.competitions, 'competitionId'),
    teamSeasons: await bulkInsertIfMissing(CoopTeamSeason, payload.teamSeasons, 'recordId'),
    playerSeasons: await bulkInsertIfMissing(CoopPlayerSeason, payload.playerSeasons, 'recordId'),
    awards: await bulkInsertIfMissing(CoopAward, payload.awards, 'awardId'),
    trophies: await bulkInsertIfMissing(CoopTrophy, payload.trophies, 'trophyId')
  };
}

async function applyCoopMigration(payload) {
  if (payload.blockingErrors?.length) {
    throw new Error(`Migration blocked: ${payload.blockingErrors.join(' ')}`);
  }

  await connectCoopMongo();
  const models = [
    CoopTable,
    CoopSeason,
    CoopCompetition,
    CoopTeamSeason,
    CoopPlayerSeason,
    CoopAward,
    CoopTrophy,
    CoopMigrationRun
  ];
  await Promise.all(models.map(model => model.createIndexes()));

  const migrationId = `coop-sheets-v1-${payload.sourceFingerprint.slice(0, 24)}`;
  const completedMigration = await CoopMigrationRun.findOne({ status: 'completed' }).lean();
  if (completedMigration && completedMigration.migrationId !== migrationId) {
    throw new Error(
      'A COOP Sheets migration already completed with a different source snapshot. Refusing to overwrite one-time migration data.'
    );
  }

  const existingRun = await CoopMigrationRun.findOne({ migrationId }).lean();
  if (existingRun?.status === 'completed') {
    return { skipped: true, migrationId, counts: existingRun.counts || {} };
  }

  await CoopMigrationRun.updateOne(
    { migrationId },
    {
      $set: {
        status: 'running',
        sourceFingerprint: payload.sourceFingerprint,
        warnings: payload.warnings
      },
      $setOnInsert: { startedAt: new Date() }
    },
    { upsert: true }
  );

  try {
    const tableResult = await importTables(payload.tables);
    const historyCounts = await insertCoopHistory(payload);
    const counts = { tables: tableResult.upsertedCount || 0, ...historyCounts };

    await CoopMigrationRun.updateOne(
      { migrationId },
      { $set: { status: 'completed', counts, completedAt: new Date() } }
    );

    return { skipped: false, migrationId, counts };
  } catch (error) {
    await CoopMigrationRun.updateOne(
      { migrationId },
      { $set: { status: 'failed' } }
    );
    throw error;
  }
}

module.exports = { applyCoopMigration, insertCoopHistory };
