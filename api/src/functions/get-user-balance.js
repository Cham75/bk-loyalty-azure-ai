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
        envSample: Object.keys(process.env)
          .filter((k) =>
            ["COSMOS_", "RECEIPTS_", "DOCINT_"].some((p) => k.startsWith(p))
          )
          .reduce((obj, key) => {
            obj[key] = "***"; // don’t leak secrets
            return obj;
          }, {}),
      },
    };
  },
});
