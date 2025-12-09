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

// ---------- USERS ----------

async function getUser(userId) {
  if (!isCosmosConfigured()) {
    return fake.getUser(userId);
  }

  const container = getUsersContainer();

  try {
    const { resource } = await container.item(userId, userId).read();

    if (resource) {
      return {
        userId: resource.userId,
        points: safeNumber(resource.points, 0),
      };
    }

    // If no resource, create a new user with 0 points
    const userDoc = {
      id: userId,
      userId,
      points: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { resource: created } = await container.items.create(userDoc);

    return {
      userId,
      points: safeNumber(created && created.points, 0),
    };
  } catch (err) {
    if (err.code === 404) {
      const userDoc = {
        id: userId,
        userId,
        points: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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

  const { resource } = await container
    .item(userId, userId)
    .upsert(updatedDoc);

  return {
    userId,
    points: safeNumber(resource && resource.points, newPoints),
  };
}

// ---------- RECEIPTS ----------

async function createReceipt(userId, blobUrl, amount, pointsEarned, extras = {}) {
  if (!isCosmosConfigured()) {
    return fake.createReceipt(userId, blobUrl, amount, pointsEarned, extras);
  }

  const container = getReceiptsContainer();
  const nowIso = new Date().toISOString();

  const receiptDoc = {
    id: randomUUID(),
    userId,
    blobUrl,
    amount,
    pointsEarned,
    createdAt: nowIso,
    ...extras,
  };

  const { resource } = await container.items.create(receiptDoc);
  return resource || receiptDoc;
}

/**
 * Count how many receipts the user has created on a given day (Date or ISO).
 * Used for daily limit (e.g. 3 receipts/day).
 */
async function countReceiptsForUserOnDay(userId, day) {
  if (!isCosmosConfigured()) {
    return fake.countReceiptsForUserOnDay(userId, day);
  }

  const container = getReceiptsContainer();
  const d = day instanceof Date ? day : new Date(day);

  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const querySpec = {
    query:
      "SELECT VALUE COUNT(1) FROM c WHERE c.userId = @userId AND c.createdAt >= @start AND c.createdAt < @end",
    parameters: [
      { name: "@userId", value: userId },
      { name: "@start", value: start.toISOString() },
      { name: "@end", value: end.toISOString() },
    ],
  };

  const { resources } = await container.items
    .query(querySpec, { partitionKey: userId })
    .fetchAll();

  const count = resources && resources.length ? resources[0] : 0;
  return safeNumber(count, 0);
}

/**
 * Used for anti-fraud: detect if an image has already been used anywhere.
 */
async function findReceiptByImageHash(imageHash) {
  if (!isCosmosConfigured()) {
    return fake.findReceiptByImageHash(imageHash);
  }

  const container = getReceiptsContainer();

  const querySpec = {
    query: "SELECT TOP 1 * FROM c WHERE c.imageHash = @imageHash",
    parameters: [{ name: "@imageHash", value: imageHash }],
  };

  const { resources } = await container.items.query(querySpec).fetchAll();

  return resources && resources.length ? resources[0] : null;
}

// ---------- REWARDS ----------

async function createReward(userId, name, pointsCost) {
  if (!isCosmosConfigured()) {
    return fake.createReward(userId, name, pointsCost);
  }

  const usersContainer = getUsersContainer();
  const rewardsContainer = getRewardsContainer();

  const current = await getUser(userId);
  const currentPoints = safeNumber(current && current.points, 0);

  if (currentPoints < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  const newPoints = currentPoints - pointsCost;
  const nowIso = new Date().toISOString();

  const userDoc = {
    id: userId,
    userId,
    points: newPoints,
    updatedAt: nowIso,
  };

  await usersContainer.item(userId, userId).upsert(userDoc);

  const rewardDoc = {
    id: randomUUID(),
    userId,
    name,
    pointsCost,
    qrCodeData: null,
    redeemed: false,
    createdAt: nowIso,
  };

  const { resource } = await rewardsContainer.items.create(rewardDoc);

  return {
    reward: resource || rewardDoc,
    user: {
      userId,
      points: newPoints,
    },
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

  if (!resources || !resources.length) {
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
    reward: resource || reward,
  };
}

module.exports = {
  getUser,
  addPoints,
  createReceipt,
  createReward,
  redeemReward,
  countReceiptsForUserOnDay,
  findReceiptByImageHash,
};
