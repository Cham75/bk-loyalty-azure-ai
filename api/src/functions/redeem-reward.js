const { app } = require("@azure/functions");
const { createReward } = require("../data/db");

app.http("redeem-reward", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const userId = "demo-user-1"; // later: from B2C token

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

      context.log(err);
      return {
        status: 500,
        jsonBody: { error: "INTERNAL_ERROR" },
      };
    }
  },
});
