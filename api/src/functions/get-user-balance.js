const { app } = require("@azure/functions");
const { getUser } = require("../data/db");

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const userId = "demo-user-1"; // later: from B2C token

    const user = await getUser(userId);

    return {
      jsonBody: {
        userId: user.userId,
        points: user.points,
      },
    };
  },
});
