const { app } = require("@azure/functions");
const { getUser } = require("../data/db");
const { isCosmosConfigured } = require("../data/cosmos-client");

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const userId = "demo-user-1";

    try {
      const user = await getUser(userId);

      return {
        jsonBody: {
          userId: user.userId,
          points: user.points,
          cosmosConfigured: isCosmosConfigured(),
        },
      };
    } catch (err) {
      context.log.error("Error in get-user-balance:", err);

      // IMPORTANT: don't leak secrets, only basic info
      return {
        status: 500,
        jsonBody: {
          error: "INTERNAL_ERROR",
          message: err.message || "Unknown error",
          code: err.code || null,
          cosmosConfigured: isCosmosConfigured(),
        },
      };
    }
  },
});
