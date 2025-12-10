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
        userId: resource.userId || resource.id,
        points: safeNumber(resource.points, 0),
      };
    }
  } catch (err) {
    if (err.code !== 404) {
      throw err;
    }
  }

  // If not found → create with 0 points
  const nowIso = new Date().toISOString();
  const doc = {
    id: userId,
    userId,
    points: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const { resource: created } = await container.items.create(doc);

  return {
    userId: created.userId || created.id,
    points: safeNumber(created.points, 0),
  };
}

async function addPoints(userId, delta) {
  if (!isCosmosConfigured()) {
    return fake.addPoints(userId, delta);
  }

  const container = getUsersContainer();
  const current = await getUser(userId);
  const newPoints = safeNumber(current.points, 0) + delta;

  const nowIso = new Date().toISOString();
  const doc = {
    id: userId,
    userId,
    points: newPoints,
    updatedAt: nowIso,
  };

  const { resource } = await container.items.upsert(doc);

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

async function countReceiptsForUserOnDay(userId, day) {
  if (!isCosmosConfigured()) {
    return fake.countReceiptsForUserOnDay(userId, day);
  }

  const container = getReceiptsContainer();
  const d = day instanceof Date ? day : new Date(day);

  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

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
  const currentPoints = safeNumber(current.points, 0);

  if (currentPoints < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  const newPoints = currentPoints - pointsCost;
  const nowIso = new Date().toISOString();

  // Update user points
  const userDoc = {
    id: userId,
    userId,
    points: newPoints,
    updatedAt: nowIso,
  };
  const { resource: userResource } = await usersContainer.items.upsert(userDoc);
  const user = {
    userId,
    points: safeNumber(userResource && userResource.points, newPoints),
  };

  // Create reward
  const rewardDoc = {
    id: randomUUID(),
    userId,
    name,
    pointsCost,
    qrCodeData: null,
    redeemed: false,
    createdAt: nowIso,
  };

  const { resource: rewardResource } = await rewardsContainer.items.create(rewardDoc);

  return {
    reward: rewardResource || rewardDoc,
    user,
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

  const partitionKey = reward.userId || reward.user_id || reward.user;

  const { resource } = await container.item(reward.id, partitionKey).replace(reward);

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
