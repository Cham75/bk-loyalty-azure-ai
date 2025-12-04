const { app } = require("@azure/functions");
const { redeemReward } = require("../data/db");

app.http("validate-reward", {
  methods: ["POST", "GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const urlId = request.query.get("rewardId");
    let bodyId = null;

    try {
      const body = await request.json();
      bodyId = body && body.rewardId;
    } catch {
      bodyId = null;
    }

    const rewardId = bodyId || urlId;

    if (!rewardId) {
      return {
        status: 400,
        jsonBody: { valid: false, reason: "MISSING_ID" },
      };
    }

    const result = await redeemReward(rewardId);

    if (!result.found) {
      return {
        status: 404,
        jsonBody: { valid: false, reason: "NOT_FOUND" },
      };
    }

    if (result.alreadyRedeemed) {
      return {
        status: 409,
        jsonBody: {
          valid: false,
          reason: "ALREADY_REDEEMED",
          rewardName: result.reward.name,
        },
      };
    }

    return {
      jsonBody: {
        valid: true,
        rewardName: result.reward.name,
        userId: result.reward.userId,
      },
    };
  },
});
