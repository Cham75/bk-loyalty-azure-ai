const { app } = require("@azure/functions");

app.http("get-user-balance", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    return {
      jsonBody: {
        status: "ok",
        source: "minimal get-user-balance",
        timestamp: new Date().toISOString(),
      },
    };
  },
});