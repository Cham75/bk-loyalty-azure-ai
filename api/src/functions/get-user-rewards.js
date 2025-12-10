// api/src/functions/get-user-rewards.js
const { app } = require("@azure/functions");
const { getUserId } = require("../auth/client-principal");
const { listRewardsForUser } = require("../data/db");

app.http("get-user-rewards", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);

      if (!userId) {
        return {
          status: 401,
          jsonBody: { error: "UNAUTHENTICATED" },
        };
      }

      const rewards = await listRewardsForUser(userId);

      const normalized = (rewards || []).map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        pointsCost:
          typeof r.pointsCost === "number" ? r.pointsCost : null,
        redeemed: !!r.redeemed,
        createdAt: r.createdAt || null,
        redeemedAt: r.redeemedAt || null,
        tier: r.tier || null,
      }));

      return {
        jsonBody: {
          rewards: normalized,
        },
      };
    } catch (err) {
      context.log("get-user-rewards error:", err);
      return {
        status: 500,
        jsonBody: {
          error: "INTERNAL_ERROR",
          message: err && err.message ? err.message : "Unknown error",
        },
      };
    }
  },
});
