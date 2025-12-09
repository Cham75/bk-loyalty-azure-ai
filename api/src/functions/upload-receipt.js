const { app } = require("@azure/functions");
const { addPoints, createReceipt } = require("../data/db");
const { uploadReceiptImage } = require("../data/blob-storage");
const { extractTotalAmountFromReceipt } = require("../services/document-intelligence");
const { getUserId } = require("../auth/client-principal");

app.http("upload-receipt", {
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
        body = null;
      }

      if (!body) {
        return {
          status: 400,
          jsonBody: { error: "Missing JSON body" },
        };
      }

      const { fileName, contentType, fileBase64 } = body;

      if (!fileBase64) {
        return {
          status: 400,
          jsonBody: { error: "fileBase64 required for upload-receipt" },
        };
      }

      // 1) Convert base64 -> Buffer for Document Intelligence
      const buffer = Buffer.from(fileBase64, "base64");

      // 2) Call Document Intelligence to detect amount
      let amount = null;
      try {
        amount = await extractTotalAmountFromReceipt(buffer);
      } catch (docErr) {
        context.log("Document Intelligence error:", docErr);
      }

      if (!amount || isNaN(amount)) {
        // Fallback if AI fails
        amount = 75;
      }

      // 3) Upload image to Blob storage
      const blobUrl = await uploadReceiptImage(
        userId,
        fileName,
        contentType,
        fileBase64
      );

      // 4) Compute points
      const pointsEarned = Math.floor(amount);

      // 5) Save receipt in Cosmos
      const receipt = await createReceipt(
        userId,
        blobUrl,
        amount,
        pointsEarned
      );

      // 6) Update user points in Cosmos
      const updatedUser = await addPoints(userId, pointsEarned);

      return {
        jsonBody: {
          userId: updatedUser.userId,
          amount,
          pointsEarned,
          newBalance: updatedUser.points,
          receiptId: receipt.id,
          receiptBlobUrl: receipt.blobUrl,
        },
      };
    } catch (err) {
      context.log("upload-receipt error", err);
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
