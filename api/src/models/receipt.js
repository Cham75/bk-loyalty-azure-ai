module.exports = class Receipt {
  constructor({
    id,
    userId,
    blobUrl,
    amount,
    pointsEarned,
    createdAt = new Date().toISOString()
  }) {
    this.id = id;
    this.userId = userId;
    this.blobUrl = blobUrl; // link to Blob Storage file
    this.amount = amount; // parsed by Document Intelligence
    this.pointsEarned = pointsEarned; // e.g. 1€ = 10 points
    this.createdAt = createdAt;
    this.type = "receipt";
  }
};
