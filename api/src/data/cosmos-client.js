// api/src/data/cosmos-client.js

// 🔧 Cosmos / SWA crypto polyfill
const nodeCrypto = require("crypto");
global.crypto = global.crypto || nodeCrypto;
const crypto = nodeCrypto; // keep reference so bundler doesn't strip it

const { CosmosClient } = require("@azure/cosmos");

function isCosmosConfigured() {
  return !!process.env.COSMOS_DB_CONNECTION_STRING;
}

function getClient() {
  const connStr = process.env.COSMOS_DB_CONNECTION_STRING;
  if (!connStr) {
    throw new Error("COSMOS_DB_CONNECTION_STRING is not set");
  }
  return new CosmosClient(connStr);
}

function getDatabase() {
  const dbName = process.env.COSMOS_DB_NAME || "bkloyalty";
  return getClient().database(dbName);
}

function getUsersContainer() {
  const name = process.env.COSMOS_DB_USERS_CONTAINER || "Users";
  return getDatabase().container(name);
}

function getReceiptsContainer() {
  const name = process.env.COSMOS_DB_RECEIPTS_CONTAINER || "Receipts";
  return getDatabase().container(name);
}

function getRewardsContainer() {
  const name = process.env.COSMOS_DB_REWARDS_CONTAINER || "Rewards";
  return getDatabase().container(name);
}

module.exports = {
  isCosmosConfigured,
  getUsersContainer,
  getReceiptsContainer,
  getRewardsContainer,
};
