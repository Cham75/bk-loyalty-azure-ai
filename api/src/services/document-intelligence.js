// api/src/services/document-intelligence.js
const { AzureKeyCredential, DocumentAnalysisClient } = require("@azure/ai-form-recognizer");

const endpoint = process.env.DOCINT_ENDPOINT;
const key = process.env.DOCINT_KEY;

let client = null;

function getClient() {
  if (!endpoint || !key) {
    throw new Error("Document Intelligence not configured (DOCINT_ENDPOINT / DOCINT_KEY).");
  }
  if (!client) {
    const credential = new AzureKeyCredential(key);
    client = new DocumentAnalysisClient(endpoint, credential);
  }
  return client;
}

/**
 * Analyze a receipt image (Buffer) and return:
 * - amount (number | null)
 * - merchantName (string | null)
 * - transactionDate (ISO string | null)
 */
async function extractReceiptInfo(buffer) {
  const client = getClient();

  const poller = await client.beginAnalyzeDocument("prebuilt-receipt", buffer);
  const result = await poller.pollUntilDone();

  if (!result.documents || !result.documents.length) {
    return null;
  }

  const receipt = result.documents[0];
  const fields = receipt.fields || {};

  // ----- TOTAL AMOUNT -----
  const candidate =
    fields.Total ||
    fields.TransactionTotal ||
    fields.Subtotal ||
    fields.SubTotal ||
    null;

  let amount = null;

  if (candidate) {
    const raw =
      candidate.value ??
      candidate.valueNumber ??
      candidate.content ??
      null;

    if (typeof raw === "number") {
      amount = raw;
    } else if (typeof raw === "string") {
      // Try to parse from string, keep it simple
      const normalized = raw
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
      const parsed = parseFloat(normalized);
      if (!Number.isNaN(parsed)) {
        amount = parsed;
      }
    }
  }

  // ----- MERCHANT NAME -----
  let merchantName = null;
  if (fields.MerchantName) {
    merchantName =
      (fields.MerchantName.value ||
        fields.MerchantName.content ||
        null);
    if (typeof merchantName === "string") {
      merchantName = merchantName.trim();
    }
  }

  // ----- TRANSACTION DATE -----
  let transactionDate = null;
  if (fields.TransactionDate) {
    const rawDate =
      fields.TransactionDate.value ||
      fields.TransactionDate.content ||
      null;

    if (rawDate instanceof Date) {
      transactionDate = rawDate.toISOString();
    } else if (typeof rawDate === "string") {
      const parsed = new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) {
        transactionDate = parsed.toISOString();
      }
    }
  }

  return {
    amount: typeof amount === "number" && Number.isFinite(amount) ? amount : null,
    merchantName: merchantName || null,
    transactionDate,
  };
}

/**
 * Backward-compatible helper if somewhere you still only need the amount.
 */
async function extractTotalAmountFromReceipt(buffer) {
  const info = await extractReceiptInfo(buffer);
  return info ? info.amount : null;
}

module.exports = {
  extractReceiptInfo,
  extractTotalAmountFromReceipt,
};
