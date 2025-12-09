// api/src/functions/upload-receipt.js
const { app } = require("@azure/functions");
const { addPoints, createReceipt } = require("./data/db");
const { uploadReceiptImage } = require("./data/blob-storage");
const { analyzeReceipt } = require("./services/document-intelligence");
const { getUserId } = require("./auth/client-principal");

const MAX_RECEIPT_AGE_DAYS = 2;

function computeReceiptAgeDays(receiptDate) {
  if (!(receiptDate instanceof Date) || isNaN(receiptDate.getTime())) {
    return null;
  }

  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const utcReceipt = Date.UTC(
    receiptDate.getUTCFullYear(),
    receiptDate.getUTCMonth(),
    receiptDate.getUTCDate()
  );
  const utcNow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  return (utcNow - utcReceipt) / oneDayMs;
}

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

      // 2) Call Document Intelligence to detect amount, merchant, date, BK presence
      let analysis = null;
      try {
        analysis = await analyzeReceipt(buffer);
      } catch (docErr) {
        context.log("Document Intelligence error:", docErr);
      }

      let amount =
        analysis && typeof analysis.amount === "number" && !isNaN(analysis.amount)
          ? analysis.amount
          : null;

      if (amount === null) {
        // Fallback if AI fails
        amount = 75;
      }

      const merchantName =
        analysis && analysis.merchantName ? analysis.merchantName : null;

      const transactionDate =
        analysis &&
        analysis.transactionDate instanceof Date &&
        !isNaN(analysis.transactionDate.getTime())
          ? analysis.transactionDate
          : null;

      const rawDateText =
        analysis && analysis.rawDateText ? analysis.rawDateText : null;

      const hasBurgerKing =
        analysis && typeof analysis.hasBurgerKing === "boolean"
          ? analysis.hasBurgerKing
          : null;

      const validationIssues = [];

      if (transactionDate) {
        const ageDays = computeReceiptAgeDays(transactionDate);

        if (ageDays !== null) {
          if (ageDays > MAX_RECEIPT_AGE_DAYS) {
            validationIssues.push({
              code: "RECEIPT_TOO_OLD",
              message: "Receipt date is older than the allowed 2 days.",
            });
          } else if (ageDays < -1) {
            validationIssues.push({
              code: "RECEIPT_IN_FUTURE",
              message: "Receipt date appears to be in the future.",
            });
          }
        }
      }

      // If we can confidently say it's NOT Burger King
      if (hasBurgerKing === false) {
        validationIssues.push({
          code: "MERCHANT_NOT_BURGER_KING",
          message: "Could not detect 'Burger King' or 'BK' on the receipt.",
        });
      }

      if (amount <= 0) {
        // Don't reject hard, but mark it and fallback
        validationIssues.push({
          code: "INVALID_AMOUNT",
          message: "Detected amount on receipt is invalid.",
        });
      }

      const transactionDateIso = transactionDate
        ? transactionDate.toISOString()
        : null;

      // Decide which issues are "blocking"
      const hasCriticalIssue = validationIssues.some(
        (issue) =>
          issue.code === "RECEIPT_TOO_OLD" ||
          issue.code === "RECEIPT_IN_FUTURE" ||
          issue.code === "MERCHANT_NOT_BURGER_KING"
      );

      if (hasCriticalIssue) {
        // Reject without awarding points or storing the receipt
        return {
          status: 400,
          jsonBody: {
            error: "RECEIPT_REJECTED",
            reasons: validationIssues,
            amount,
            transactionDate: transactionDateIso,
            rawDateText,
          },
        };
      }

      // Non-critical issue: invalid amount → fallback to default
      if (validationIssues.some((issue) => issue.code === "INVALID_AMOUNT")) {
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
          transactionDate: transactionDateIso,
          rawDateText,
          merchantName,
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
