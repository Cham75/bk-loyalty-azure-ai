const { app } = require("@azure/functions");

app.http("health-check", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    context.log("Health-check function processed a request.");

    const name = request.query.get("name") || "anonymous user";

    return {
      jsonBody: {
        status: "ok",
        message: `Hello ${name}, BK Loyalty API is alive.`,
        timestamp: new Date().toISOString(),
      },
    };
  },
});