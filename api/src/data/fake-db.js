const { randomUUID } = require("crypto");

const users = new Map();
const rewards = new Map();

function ensureUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, { userId, points: 0 });
  }
  return users.get(userId);
}

function getUser(userId) {
  return ensureUser(userId);
}

// Used by db.js to sync in-memory user with Cosmos points
function setUserPoints(userId, points) {
  const user = ensureUser(userId);
  user.points = points;
  return user;
}

function addPoints(userId, delta) {
  const user = ensureUser(userId);
  user.points += delta;
  return user;
}

function createReward(userId, name, pointsCost) {
  const user = ensureUser(userId);

  if (user.points < pointsCost) {
    const err = new Error("Not enough points");
    err.code = "NOT_ENOUGH_POINTS";
    throw err;
  }

  // Deduct the points
  user.points -= pointsCost;

  const rewardId = randomUUID();
  const reward = {
    id: rewardId,
    userId,
    name,
    pointsCost,
    redeemed: false,
    createdAt: new Date().toISOString(),
  };

  rewards.set(rewardId, reward);

  return { reward, user };
}

function redeemReward(rewardId) {
  const reward = rewards.get(rewardId);
  if (!reward) {
    return { found: false };
  }

  if (reward.redeemed) {
    return { found: true, alreadyRedeemed: true, reward };
  }

  reward.redeemed = true;
  reward.redeemedAt = new Date().toISOString();

  return { found: true, alreadyRedeemed: false, reward };
}

module.exports = {
  getUser,
  setUserPoints,
  addPoints,
  createReward,
  redeemReward,
};
