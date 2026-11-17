const mongoose = require('mongoose');

const connection = mongoose.createConnection();
let migrationVerified = false;

function getCoopModel(name, schema, collectionName) {
  return connection.models[name] || connection.model(name, schema, collectionName);
}

async function connectCoopMongo() {
  const uri = String(process.env.COOP_MONGO_URI || '').trim();
  if (!uri) {
    throw new Error('COOP_MONGO_URI is required for COOP MongoDB storage.');
  }

  if (connection.readyState === 1) return connection;
  if (connection.readyState === 2) return connection.asPromise();

  return connection.openUri(uri, {
    ...(process.env.COOP_DB_NAME ? { dbName: process.env.COOP_DB_NAME } : {}),
    serverSelectionTimeoutMS: 10000
  });
}

async function isCoopMongoActivated() {
  if (String(process.env.COOP_STORAGE_MODE || '').trim().toLowerCase() !== 'mongo') {
    return false;
  }
  if (!process.env.COOP_MONGO_URI) {
    throw new Error('COOP_MONGO_URI is required when COOP_STORAGE_MODE=mongo.');
  }
  if (migrationVerified) return true;

  await connectCoopMongo();
  const CoopMigrationRun = require('../models/coop/CoopMigrationRun');
  if (!await CoopMigrationRun.exists({ status: 'completed' })) {
    throw new Error('COOP Sheets migration is not complete; keep COOP_STORAGE_MODE set to sheets.');
  }
  migrationVerified = true;
  return true;
}

module.exports = {
  connection,
  connectCoopMongo,
  getCoopModel,
  isCoopMongoActivated
};
