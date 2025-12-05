const { app } = require("@azure/functions");

let dbError = null;
let getUser = null;
let isCosmosConfigured = null;

// Try to import DB layer once, and capture any error
try {
  ({ getUser } = require("../data/db"));
  ({ isCosmosConfigured } = require("../data/cosmos-client"));
} catch (err) {
  dbError = err;
}

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const userId = "demo-user-1";

    // If import failed, return a JSON error instead of crashing with HTML 500
    if (dbError) {
      context.log.error("DB import error in get-user-balance:", dbError);

      return {
        status: 500,
        jsonBody: {
          error: "DB_IMPORT_ERROR",
          message: dbError.message || "Unknown import error",
          code: dbError.code || null,
        },
      };
    }

    try {
      const user = await getUser(userId);

      return {
        jsonBody: {
          userId: user.userId,
          points: user.points,
          cosmosConfigured: isCosmosConfigured
            ? isCosmosConfigured()
            : null,
        },
      };
    } catch (err) {
      context.log.error("Error in get-user-balance handler:", err);

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
