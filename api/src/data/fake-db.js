// api/src/data/fake-db.js
const { randomUUID } = require("crypto");

// Simple in-memory maps for local dev
const users = new Map();    // userId -> { userId, points }
const receipts = new Map(); // receiptId -> { ... }
const rewards = new Map();  // rewardId -> { ... }

function ensureUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, { userId, points: 0 });
  }
  return users.get(userId);
}

async function getUser(userId) {
  return ensureUser(userId);
}

async function addPoints(userId, delta) {
  const user = ensureUser(userId);
  user.points += delta;
  return { userId, points: user.points };
}

async function createReceipt(userId, blobUrl, amount, pointsEarned, extras = {}) {
  const id = "fake-receipt-" + randomUUID();
  const nowIso = new Date().toISOString();

  const receiptDoc = {
    id,
    userId,
    blobUrl,
    amount,
    pointsEarned,
    createdAt: nowIso,
    ...extras,
  };

  receipts.set(id, receiptDoc);
  return receiptDoc;
}

async function countReceiptsForUserOnDay(userId, day) {
  const d = day instanceof Date ? day : new Date(day);

  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  let count = 0;
  for (const receipt of receipts.values()) {
    if (receipt.userId !== userId) continue;
    const created = new Date(receipt.createdAt);
    if (created >= start && created < end) {
      count += 1;
    }
  }

  return count;
}

async function findReceiptByImageHash(imageHash) {
  for (const receipt of receipts.values()) {
    if (receipt.imageHash === imageHash) {
      return receipt;
    }
  }
  return null;
}

async function createReward(userId, name, pointsCost) {
  const user = ensureUser(userId);

  if (user.points < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  user.points -= pointsCost;

  const id = "fake-reward-" + randomUUID();
  const rewardDoc = {
    id,
    userId,
    name,
    pointsCost,
    qrCodeData: null,
    redeemed: false,
    createdAt: new Date().toISOString(),
  };

  rewards.set(id, rewardDoc);

  return {
    reward: rewardDoc,
    user: { userId, points: user.points },
  };
}

async function redeemReward(rewardId) {
  const reward = rewards.get(rewardId);

  if (!reward) {
    return { found: false };
  }

  if (reward.redeemed) {
    return {
      found: true,
      alreadyRedeemed: true,
      reward,
    };
  }

  reward.redeemed = true;
  reward.redeemedAt = new Date().toISOString();

  return {
    found: true,
    alreadyRedeemed: false,
    reward,
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
