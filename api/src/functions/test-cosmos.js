const { app } = require("@azure/functions");

app.http("test-cosmos", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      // Load Cosmos only inside the handler so any error is catchable
      const cosmos = require("@azure/cosmos");
      const { CosmosClient } = cosmos;

      const connStr = process.env.COSMOS_DB_CONNECTION_STRING;
      const dbName = process.env.COSMOS_DB_NAME || "bkloyalty";
      const usersContainerName =
        process.env.COSMOS_DB_USERS_CONTAINER || "Users";

      if (!connStr) {
        return {
          status: 500,
          jsonBody: {
            ok: false,
            error: "COSMOS_DB_CONNECTION_STRING not set",
          },
        };
      }

      const client = new CosmosClient(connStr);
      const db = client.database(dbName);
      const container = db.container(usersContainerName);

      // Small query just to test
      const { resources } = await container.items
        .query("SELECT TOP 5 * FROM c")
        .fetchAll();

      return {
        jsonBody: {
          ok: true,
          dbName,
          usersContainerName,
          sampleCount: resources.length,
        },
      };
    } catch (err) {
      context.log.error("test-cosmos error:", err);

      return {
        status: 500,
        jsonBody: {
          ok: false,
          error: err.message || "Unknown Cosmos error",
          code: err.code || null,
        },
      };
    }
  },
});
