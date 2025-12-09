// api/src/data/db.js

const { randomUUID } = require("crypto");
const fake = require("./fake-db");
const {
  isCosmosConfigured,
  getUsersContainer,
  getReceiptsContainer,
  getRewardsContainer,
} = require("./cosmos-client");

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- USERS / POINTS ----------

async function getUser(userId) {
  if (!isCosmosConfigured()) {
    return fake.getUser(userId);
  }

  const container = getUsersContainer();

  try {
    const { resource } = await container.item(userId, userId).read();

    // If Cosmos returns no resource but no error, create a new user doc
    if (!resource) {
      const userDoc = {
        id: userId,
        userId,
        email: null,
        points: 0,
        createdAt: new Date().toISOString(),
      };

      const { resource: created } = await container.items.create(userDoc);

      return {
        userId,
        points: safeNumber(created && created.points, 0),
      };
    }

    return {
      userId,
      points: safeNumber(resource.points, 0),
    };
  } catch (err) {
    // If user not found, create it
    if (err.code === 404) {
      const userDoc = {
        id: userId,
        userId,
        email: null,
        points: 0,
        createdAt: new Date().toISOString(),
      };
      const { resource: created } = await container.items.create(userDoc);

      return {
        userId,
        points: safeNumber(created && created.points, 0),
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

  // Ensure the user exists
  const current = await getUser(userId);
  const newPoints = safeNumber(current && current.points, 0) + delta;

  const updatedDoc = {
    id: userId,
    userId,
    points: newPoints,
    updatedAt: new Date().toISOString(),
  };

  try {
    const { resource } = await container.item(userId, userId).replace(updatedDoc);

    return {
      userId,
      points: safeNumber(resource && resource.points, newPoints),
    };
  } catch (err) {
    // If user doc somehow doesn't exist yet, create it instead of replace
    if (err.code === 404) {
      const { resource: created } = await container.items.create(updatedDoc);

      return {
        userId,
        points: safeNumber(created && created.points, newPoints),
      };
    }

    throw err;
  }
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
  const receiptDoc = {
    id: randomUUID(),
    userId,
    blobUrl,
    amount,
    pointsEarned,
    createdAt: new Date().toISOString(),
  };

  const { resource } = await container.items.create(receiptDoc);
  // If for some reason Cosmos returns no resource, fall back to our local doc
  return resource || receiptDoc;
}

// ---------- REWARDS ----------

async function createReward(userId, name, pointsCost) {
  if (!isCosmosConfigured()) {
    return fake.createReward(userId, name, pointsCost);
  }

  // 1) Check current balance
  const current = await getUser(userId);
  const currentPoints = safeNumber(current && current.points, 0);

  if (currentPoints < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  // 2) Debit user points
  const updatedUser = await addPoints(userId, -pointsCost);

  // 3) Create reward document
  const container = getRewardsContainer();
  const rewardDoc = {
    id: randomUUID(),
    userId,
    name,
    pointsCost,
    redeemed: false,
    createdAt: new Date().toISOString(),
  };

  const { resource } = await container.items.create(rewardDoc);

  return {
    reward: resource || rewardDoc,
    user: updatedUser,
  };
}

async function redeemReward(rewardId) {
  if (!isCosmosConfigured()) {
    return fake.redeemReward(rewardId);
  }

  const container = getRewardsContainer();

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

  // Partition key is /userId
  const partitionKey = reward.userId || reward.user_id || reward.user;

  const { resource } = await container
    .item(reward.id, partitionKey)
    .replace(reward);

  return {
    found: true,
    alreadyRedeemed: false,
    reward: resource || reward,
  };
}

module.exports = {
  getUser,
  addPoints,
  createReceipt,
  createReward,
  redeemReward,
};
