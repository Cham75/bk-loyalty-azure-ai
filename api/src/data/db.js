// db.js: data abstraction over either Cosmos DB or the in-memory fake-db.

const fake = require("./fake-db");
const User = require("../models/user");
const Receipt = require("../models/receipt");
const Reward = require("../models/reward");
const { randomUUID } = require("crypto");
const {
  isCosmosConfigured,
  getUsersContainer,
  getReceiptsContainer,
  getRewardsContainer,
} = require("./cosmos-client");

// ---------- USERS / POINTS ----------

async function getUser(userId) {
  if (!isCosmosConfigured()) {
    return fake.getUser(userId);
  }

  const container = getUsersContainer();

  try {
    const { resource } = await container.item(userId, userId).read();
    return {
      userId: resource.userId,
      points: resource.points || 0,
    };
  } catch (err) {
    if (err.code === 404) {
      const user = new User({
        id: userId,
        email: null,
        points: 0,
      });
      const { resource } = await container.items.create(user);
      return {
        userId: resource.userId,
        points: resource.points || 0,
      };
    }
    throw err;
  }
}

async function addPoints(userId, delta) {
  if (!isCosmosConfigured()) {
    return fake.addPoints(userId, delta);
  }

  const container = getUsersContainer();
  const current = await getUser(userId);
  const newPoints = current.points + delta;

  const updatedDoc = {
    id: userId,
    userId,
    points: newPoints,
  };

  const { resource } = await container.item(userId, userId).replace(updatedDoc);
  return {
    userId: resource.userId,
    points: resource.points || 0,
  };
}

// ---------- RECEIPTS ----------

async function createReceipt(userId, blobUrl, amount, pointsEarned) {
  if (!isCosmosConfigured()) {
    return {
      id: "fake-receipt-" + Date.now(),
      userId,
      blobUrl,
      amount,
      pointsEarned,
    };
  }

  const container = getReceiptsContainer();
  const receipt = new Receipt({
    id: randomUUID(),
    userId,
    blobUrl,
    amount,
    pointsEarned,
  });

  const { resource } = await container.items.create(receipt);
  return resource;
}

// ---------- REWARDS ----------

async function createReward(userId, name, pointsCost) {
  if (!isCosmosConfigured()) {
    return fake.createReward(userId, name, pointsCost);
  }

  // 1) Check current balance
  const current = await getUser(userId);
  if (current.points < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  // 2) Debit user points (reuse addPoints with negative delta)
  const updatedUser = await addPoints(userId, -pointsCost);

  // 3) Create reward document
  const container = getRewardsContainer();
  const reward = new Reward({
    id: randomUUID(),
    userId,
    name,
    pointsCost,
    redeemed: false,
  });

  const { resource } = await container.items.create(reward);

  return {
    reward: resource,
    user: updatedUser,
  };
}

async function redeemReward(rewardId) {
  if (!isCosmosConfigured()) {
    return fake.redeemReward(rewardId);
  }

  const container = getRewardsContainer();

  // Search by id (cross-partition query since partition key is /userId)
  const querySpec = {
    query: "SELECT * FROM c WHERE c.id = @id",
    parameters: [{ name: "@id", value: rewardId }],
  };

  const { resources } = await container.items.query(querySpec).fetchAll();

  if (!resources || resources.length === 0) {
    return { found: false };
  }

  const reward = resources[0];

  if (reward.redeemed) {
    return {
      found: true,
      alreadyRedeemed: true,
      reward,
    };
  }

  reward.redeemed = true;
  reward.redeemedAt = new Date().toISOString();

  const { resource } = await container
    .item(reward.id, reward.userId)
    .replace(reward);

  return {
    found: true,
    alreadyRedeemed: false,
    reward: resource,
  };
}

module.exports = {
  getUser,
  addPoints,
  createReceipt,
  createReward,
  redeemReward,
};
