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

// buffer = Buffer of the image (jpeg/png...)
async function extractTotalAmountFromReceipt(buffer) {
  const client = getClient();

  // Use the prebuilt receipt model
  const poller = await client.beginAnalyzeDocument("prebuilt-receipt", buffer);
  const result = await poller.pollUntilDone();

  if (!result.documents || !result.documents.length) {
    return null;
  }

  const receipt = result.documents[0];
  const fields = receipt.fields || {};

  // Different versions/receipts may expose Total / TransactionTotal / Subtotal etc.
  const candidate =
    fields.Total ||
    fields.TransactionTotal ||
    fields.Subtotal ||
    fields.SubTotal ||
    null;

  if (!candidate) {
    return null;
  }

  // valueNumber if available, otherwise try to parse
  const raw =
    candidate.value ??
    candidate.valueNumber ??
    candidate.content ??
    null;

  if (typeof raw === "number") {
    return raw;
  }

  if (typeof raw === "string") {
    const parsed = parseFloat(raw.replace(",", "."));
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

module.exports = {
  extractTotalAmountFromReceipt,
};
