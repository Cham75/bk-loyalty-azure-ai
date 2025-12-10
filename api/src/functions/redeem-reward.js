const { app } = require("@azure/functions");
const { createReward } = require("../data/db");
const { getUserId } = require("../auth/client-principal");

const REWARD_TIERS = {
  FREE_SIDE: {
    name: "🥤 Free side (≤ 15 MAD)",
    pointsCost: 10,
  },
  FREE_SANDWICH: {
    name: "🍔 Free sandwich (≤ 35 MAD)",
    pointsCost: 25,
  },
  FREE_MENU: {
    name: "🍔+🥤 Free menu (≤ 60 MAD)",
    pointsCost: 40,
  },
};

app.http("redeem-reward", {
  methods: ["POST"],
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

      let body;
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      let rewardName;
      let pointsCost;
      let tier = null;

      if (body && typeof body.tier === "string" && REWARD_TIERS[body.tier]) {
        const config = REWARD_TIERS[body.tier];
        rewardName = config.name;
        pointsCost = config.pointsCost;
        tier = body.tier;
      } else {
        // Fallback: legacy / custom reward mode
        rewardName = body.rewardName || "Free Sundae";
        pointsCost =
          typeof body.pointsCost === "number" ? body.pointsCost : 100;
      }

      const { reward, user } = await createReward(
        userId,
        rewardName,
        pointsCost,
        tier
      );

      const qrPayload = `reward:${reward.id}`;

      return {
        jsonBody: {
          rewardId: reward.id,
          rewardName: reward.name,
          pointsCost: reward.pointsCost,
          newBalance: user.points,
          qrPayload,
          tier: reward.tier || tier || null,
        },
      };
    } catch (err) {
      if (err && err.code === "NOT_ENOUGH_POINTS") {
        return {
          status: 400,
          jsonBody: {
            error: "NOT_ENOUGH_POINTS",
            message: "Not enough points to redeem this reward.",
          },
        };
      }

      context.log("redeem-reward error:", err);
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
