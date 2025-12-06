const { app } = require("@azure/functions");
const { createReward } = require("../data/db");
const { getUserId } = require("../auth/client-principal");

app.http("redeem-reward", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
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

    const rewardName = body.rewardName || "Free Sundae";
    const pointsCost =
      typeof body.pointsCost === "number" ? body.pointsCost : 100;

    try {
      const { reward, user } = await createReward(
        userId,
        rewardName,
        pointsCost
      );

      const qrPayload = `reward:${reward.id}`;

      return {
        jsonBody: {
          rewardId: reward.id,
          rewardName: reward.name,
          pointsCost: reward.pointsCost,
          newBalance: user.points,
          qrPayload,
        },
      };
    } catch (err) {
      if (err.code === "NOT_ENOUGH_POINTS") {
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
        jsonBody: { error: "INTERNAL_ERROR" },
      };
    }
  },
});
