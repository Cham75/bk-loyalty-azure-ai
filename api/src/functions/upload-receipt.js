// api/src/functions/upload-receipt.js
const { app } = require("@azure/functions");
const crypto = require("crypto");
const {
  addPoints,
  createReceipt,
  countReceiptsForUserOnDay,
  findReceiptByImageHash,
} = require("../data/db");
const { uploadReceiptImage } = require("../data/blob-storage");
const { extractReceiptInfo } = require("../services/document-intelligence");
const { getUserId } = require("../auth/client-principal");

const DAILY_RECEIPT_LIMIT = 3;
const MAX_AMOUNT_FOR_POINTS = 80; // >80€ still accepted but points capped

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
      let info = null;
      try {
        info = await extractReceiptInfo(buffer);
      } catch (docErr) {
        context.log("Document Intelligence error:", docErr);
      }

      if (!info || !info.amount || isNaN(info.amount)) {
        return {
          status: 400,
          jsonBody: {
            error: "AMOUNT_NOT_DETECTED",
            message:
              "We couldn't read the total amount. Please upload a clearer photo of the receipt.",
          },
        };
      }

      const { amount, merchantName, transactionDate } = info;

      // 4) Merchant must clearly look like Burger King
      const merchant = (merchantName || "").toUpperCase();
      if (!merchant || (!merchant.includes("BURGER") && !merchant.includes("BK"))) {
        return {
          status: 400,
          jsonBody: {
            error: "MERCHANT_NOT_BURGER_KING",
            message:
              "We couldn't detect 'Burger King' on this receipt. Please upload a photo where the Burger King name is clearly visible.",
          },
        };
      }

      // 5) Date must be readable and <= 2 days old
      if (!transactionDate) {
        return {
          status: 400,
          jsonBody: {
            error: "DATE_NOT_DETECTED",
            message:
              "We couldn't read the date of the receipt. Please upload a photo where the date is clearly visible.",
          },
        };
      }

      const receiptDate = new Date(transactionDate);
      if (Number.isNaN(receiptDate.getTime())) {
        return {
          status: 400,
          jsonBody: {
            error: "DATE_INVALID",
            message:
              "We couldn't interpret the date on the receipt. Please upload a clearer photo.",
          },
        };
      }

      const now = new Date();
      const diffMs = now.getTime() - receiptDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays > 2) {
        const formatted = receiptDate.toISOString().slice(0, 10);
        return {
          status: 400,
          jsonBody: {
            error: "RECEIPT_TOO_OLD",
            message: `The receipt dated ${formatted} is older than 2 days and is not eligible for points.`,
            receiptDate: receiptDate.toISOString(),
          },
        };
      }

      // 6) Amount sanity + cap
      if (amount <= 0) {
        return {
          status: 400,
          jsonBody: {
            error: "AMOUNT_INVALID",
            message: "The amount on the receipt must be greater than 0.",
          },
        };
      }

      const pointsBase = Math.min(amount, MAX_AMOUNT_FOR_POINTS);
      const pointsEarned = Math.floor(pointsBase);

      // 7) Daily per-user limit (soft but clear)
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

      // 8) Upload image to Blob storage
      const blobUrl = await uploadReceiptImage(
        userId,
        fileName,
        contentType,
        fileBase64
      );

      // 9) Save receipt in DB with extra fields
      const receipt = await createReceipt(
        userId,
        blobUrl,
        amount,
        pointsEarned,
        {
          imageHash,
          merchantName,
          receiptDate: receiptDate.toISOString(),
        }
      );

      // 10) Update user points
      const updatedUser = await addPoints(userId, pointsEarned);

      return {
        jsonBody: {
          userId: updatedUser.userId,
          amount,
          pointsEarned,
          newBalance: updatedUser.points,
          receiptId: receipt.id,
          receiptBlobUrl: receipt.blobUrl,
          receiptDate: receipt.receiptDate || receiptDate.toISOString(),
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
