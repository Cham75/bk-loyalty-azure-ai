// api/src/models/user.js

module.exports = class User {
  constructor({
    id,
    email,
    points = 0,
    createdAt = new Date().toISOString(),
  }) {
    this.id = id;           // Cosmos "id"
    this.userId = id;       // IMPORTANT: matches partition key /userId
    this.email = email;
    this.points = points;
    this.createdAt = createdAt;
    this.type = "user";
  }
};
