const { CosmosClient } = require("@azure/cosmos");

const connectionString = process.env.COSMOS_DB_CONNECTION_STRING;

let client = null;

function isCosmosConfigured() {
  return !!connectionString;
}

function getClient() {
  if (!connectionString) {
    throw new Error("COSMOS_DB_CONNECTION_STRING is not set");
  }
  if (!client) {
    client = new CosmosClient(connectionString);
  }
  return client;
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
