const { app } = require("@azure/functions");
const crypto = require("crypto");
const {
  addPoints,
  createReceipt,
  countReceiptsForUserOnDay,
  findReceiptByImageHash,
} = require("../data/db");
const { uploadReceiptImage } = require("../data/blob-storage");
const { analyzeReceipt } = require("../services/document-intelligence");
const { getUserId } = require("../auth/client-principal");

const MAX_RECEIPT_AGE_DAYS = 2; // <= 2 days old
const DAILY_RECEIPT_LIMIT = 3; // max rewarded receipts per day
const MAX_AMOUNT_FOR_POINTS = 1000; // cap for points (safety)

function computeReceiptAgeDays(receiptDate) {
  if (!(receiptDate instanceof Date) || Number.isNaN(receiptDate.getTime())) {
    return null;
  }

  const now = new Date();

  const startOfReceipt = new Date(
    receiptDate.getFullYear(),
    receiptDate.getMonth(),
    receiptDate.getDate()
  );
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const diffMs = startOfToday.getTime() - startOfReceipt.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
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

      // 1) Convert base64 -> Buffer
      const buffer = Buffer.from(fileBase64, "base64");

      // 2) Anti-fraud: duplicate image via hash
      const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");
      const existing = await findReceiptByImageHash(imageHash);
      if (existing) {
        return {
          status: 400,
          jsonBody: {
            error: "DUPLICATE_RECEIPT",
            message: "This receipt has already been used.",
          },
        };
      }

      // 3) Analyze receipt to get amount + merchant + transaction date
      let analysis = null;
      try {
        analysis = await analyzeReceipt(buffer);
      } catch (docErr) {
        context.log("Document Intelligence error:", docErr);
      }

      let amount =
        analysis && typeof analysis.amount === "number" && !Number.isNaN(analysis.amount)
          ? analysis.amount
          : null;

      const merchantName =
        analysis && analysis.merchantName ? analysis.merchantName : null;

      const transactionDate =
        analysis &&
        analysis.transactionDate instanceof Date &&
        !Number.isNaN(analysis.transactionDate.getTime())
          ? analysis.transactionDate
          : null;

      const rawDateText = analysis && analysis.rawDateText ? analysis.rawDateText : null;
      const hasBurgerKing =
        analysis && typeof analysis.hasBurgerKing === "boolean"
          ? analysis.hasBurgerKing
          : null;

      const reasons = [];

      // BK must be clearly visible if we can tell
      if (hasBurgerKing === false) {
        reasons.push({
          code: "MERCHANT_NOT_BURGER_KING",
          message: "We could not detect 'Burger King' or 'BK' on this receipt.",
        });
      }

      // Date must be readable and <= 2 days old (loose, but still a rule)
      let receiptAgeDays = null;
      if (transactionDate) {
        receiptAgeDays = computeReceiptAgeDays(transactionDate);
        if (receiptAgeDays !== null) {
          if (receiptAgeDays > MAX_RECEIPT_AGE_DAYS + 0.0001) {
            reasons.push({
              code: "RECEIPT_TOO_OLD",
              message: "The receipt is older than 2 days.",
            });
          } else if (receiptAgeDays < -2) {
            // more tolerance for "future" due to parsing and timezone
            reasons.push({
              code: "RECEIPT_IN_FUTURE",
              message: "The receipt date appears to be in the future.",
            });
          }
        }
      } else {
        // No usable date at all → we can't safely apply the 2-day rule.
        reasons.push({
          code: "DATE_NOT_DETECTED",
          message:
            "We couldn't read the date on the receipt. Please upload a photo where the date is clearly visible.",
        });
      }

      // Amount sanity (non-blocking)
      let amountInvalid = false;
      if (amount === null || Number.isNaN(amount) || amount <= 0) {
        amountInvalid = true;
        reasons.push({
          code: "INVALID_AMOUNT",
          message: "The amount detected on the receipt seems invalid.",
        });
      }

      // Decide which reasons are blocking
      const hasBlocking = reasons.some(
        (r) =>
          r.code === "MERCHANT_NOT_BURGER_KING" ||
          r.code === "RECEIPT_TOO_OLD" ||
          r.code === "RECEIPT_IN_FUTURE" ||
          r.code === "DATE_NOT_DETECTED"
      );

      const transactionDateIso = transactionDate ? transactionDate.toISOString() : null;

      if (hasBlocking) {
        return {
          status: 400,
          jsonBody: {
            error: "RECEIPT_REJECTED",
            reasons,
            amount,
            transactionDate: transactionDateIso,
            rawDateText,
            merchantName,
          },
        };
      }

      // For non-blocking amount issues, fallback to a default average amount
      if (amountInvalid) {
        amount = 75;
      }

      // 4) Daily per-user limit (soft but clear)
      const now = new Date();
      const receiptsToday = await countReceiptsForUserOnDay(userId, now);
      if (receiptsToday >= DAILY_RECEIPT_LIMIT) {
        return {
          status: 400,
          jsonBody: {
            error: "DAILY_LIMIT_REACHED",
            message:
              "You’ve reached today’s limit of rewarded receipts. Try again tomorrow.",
            dailyLimit: DAILY_RECEIPT_LIMIT,
          },
        };
      }

      // 5) Cap amount for points (safety)
      const effectiveAmount = Math.min(amount, MAX_AMOUNT_FOR_POINTS);

      // 10 MAD = 1 point
      const pointsEarned = Math.floor(effectiveAmount / 10);

      // 6) Upload image to Blob storage
      const blobUrl = await uploadReceiptImage(
        userId,
        fileName,
        contentType,
        fileBase64
      );

      // 7) Save receipt in DB with extra metadata
      const receipt = await createReceipt(userId, blobUrl, amount, pointsEarned, {
        imageHash,
        merchantName,
        receiptDate: transactionDateIso,
      });

      // 8) Update user points
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
