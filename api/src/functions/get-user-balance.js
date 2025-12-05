// api/src/functions/get-user-balance.js

const { app } = require("@azure/functions");
const { getUser } = require("../data/db");

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const userId = "demo-user-1"; // later: from auth token

    try {
      const user = await getUser(userId);

      return {
        jsonBody: {
          userId: user.userId,
          points: user.points,
        },
      };
    } catch (err) {
      context.log("Error in get-user-balance:", err);

      return {
        status: 500,
        jsonBody: {
          error: "INTERNAL_ERROR",
          message: err.message || "Unknown error",
        },
      };
    }
  },
});
