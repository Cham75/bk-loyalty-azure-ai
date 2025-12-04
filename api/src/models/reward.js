module.exports = class Reward {
  constructor({
    id,
    userId,
    name,
    pointsCost,
    qrCodeData,
    redeemed = false,
    createdAt = new Date().toISOString()
  }) {
    this.id = id;
    this.userId = userId;
    this.name = name; // e.g., "Free Sundae"
    this.pointsCost = pointsCost; // e.g. 100 pts
    this.qrCodeData = qrCodeData; // data encoded in QR
    this.redeemed = redeemed;
    this.createdAt = createdAt;
    this.type = "reward";
  }
};
