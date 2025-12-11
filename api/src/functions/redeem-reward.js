const { app } = require("@azure/functions");
const { createReward } = require("../data/db");
const { getUserId } = require("../auth/client-principal");

// Programme BK Maroc – paliers en Couronnes
const REWARD_TIERS = {
  CROWN_40: {
    name: "👑 40 Couronnes – Petits Plaisirs",
    pointsCost: 40,
  },
  CROWN_80: {
    name: "👑 80 Couronnes – Snacks & Desserts",
    pointsCost: 80,
  },
  CROWN_120: {
    name: "👑 120 Couronnes – Burgers classiques",
    pointsCost: 120,
  },
  CROWN_135: {
    name: "👑 135 Couronnes – Burgers premium",
    pointsCost: 135,
  },
  CROWN_150: {
    name: "👑 150 Couronnes – Menus classiques",
    pointsCost: 150,
  },
  CROWN_200: {
    name: "👑 200 Couronnes – Menus premium",
    pointsCost: 200,
  },
  CROWN_240: {
    name: "👑 240 Couronnes – Festin du King",
    pointsCost: 240,
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

      // Nouveau mode : on passe un "tier" comme CROWN_40, CROWN_80, etc.
      if (body && typeof body.tier === "string" && REWARD_TIERS[body.tier]) {
        const config = REWARD_TIERS[body.tier];
        rewardName = config.name;
        pointsCost = config.pointsCost;
        tier = body.tier;
      } else {
        // Mode legacy / custom (au cas où)
        rewardName = body.rewardName || "Cadeau BK";
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
