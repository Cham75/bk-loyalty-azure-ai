const { app } = require("@azure/functions");
const { getUser } = require("../data/db");
const { getUserId } = require("../auth/client-principal");

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous", // SWA auth is in front, we still check user ourselves
  handler: async (request, context) => {
    const userId = getUserId(request);

    if (!userId) {
      return {
        status: 401,
        jsonBody: { error: "UNAUTHENTICATED" },
      };
    }

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
