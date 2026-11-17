const mongoose = require('mongoose');

// SCL is intentionally independent from both the legacy HF data and the Co-op
// models. Select the database with SCL_MONGO_TARGET=general|coop. The general
// database is the safe default because it reuses the bot's primary connection.
const coopConnection = mongoose.createConnection();

function target() {
  const value = String(process.env.SCL_MONGO_TARGET || 'general').trim().toLowerCase();
  if (!['general', 'coop'].includes(value)) {
    throw new Error('SCL_MONGO_TARGET must be "general" or "coop".');
  }
  return value;
}

async function getSclConnection() {
  if (target() === 'general') {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('The general MongoDB connection is not ready. Please try again shortly.');
    }
    return mongoose.connection;
  }

  const uri = String(process.env.COOP_MONGO_URI || '').trim();
  if (!uri) throw new Error('COOP_MONGO_URI is required when SCL_MONGO_TARGET=coop.');
  if (coopConnection.readyState === 1) return coopConnection;
  if (coopConnection.readyState === 2) return coopConnection.asPromise();
  return coopConnection.openUri(uri, {
    ...(process.env.COOP_DB_NAME ? { dbName: process.env.COOP_DB_NAME } : {}),
    serverSelectionTimeoutMS: 10000
  });
}

async function getSclModel(name, schema, collectionName) {
  const connection = await getSclConnection();
  return connection.models[name] || connection.model(name, schema, collectionName);
}

module.exports = { getSclConnection, getSclModel, target };
