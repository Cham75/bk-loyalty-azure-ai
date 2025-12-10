module.exports = class Reward {
  constructor({
    id,
    userId,
    name,
    pointsCost,
    qrCodeData,
    redeemed = false,
    createdAt = new Date().toISOString(),
    redeemedAt = null,
    tier = null,
  }) {
    this.id = id;
    this.userId = userId;
    this.name = name; // e.g., "Free Sundae" or "🥤 Free side (≤ 15 MAD)"
    this.pointsCost = pointsCost; // e.g. 10, 25, 40 pts
    this.qrCodeData = qrCodeData; // data encoded in QR
    this.redeemed = redeemed;
    this.createdAt = createdAt;
    this.redeemedAt = redeemedAt;
    this.tier = tier; // e.g. "FREE_SIDE"
    this.type = "reward";
  }
};
