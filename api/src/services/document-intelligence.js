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

// ---- helpers ----

// Extract amount from receipt.fields (same logic as previous version)
function extractAmountFromFields(fields) {
  if (!fields) return null;

  const candidate =
    fields.Total ||
    fields.TransactionTotal ||
    fields.Subtotal ||
    fields.SubTotal ||
    null;

  if (!candidate) {
    return null;
  }

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

function extractMerchantName(fields, result) {
  if (fields && fields.MerchantName) {
    const f = fields.MerchantName;
    if (f.value && typeof f.value === "string" && f.value.trim()) {
      return f.value.trim();
    }
    if (f.content && typeof f.content === "string" && f.content.trim()) {
      return f.content.trim();
    }
  }

  if (result && typeof result.content === "string") {
    const lines = result.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) {
      return lines[0];
    }
  }

  return null;
}

// Detect if receipt text clearly mentions Burger King / BK
function detectBurgerKing(fields, result) {
  const parts = [];

  if (fields && fields.MerchantName) {
    const f = fields.MerchantName;
    if (f.value && typeof f.value === "string") {
      parts.push(f.value);
    } else if (f.content && typeof f.content === "string") {
      parts.push(f.content);
    }
  }

  if (result && typeof result.content === "string") {
    parts.push(result.content);
  }

  const haystack = parts.join(" ").toLowerCase();

  if (!haystack) {
    // Unknown (no text)
    return null;
  }

  if (haystack.indexOf("burger king") !== -1 || haystack.indexOf("burgerking") !== -1) {
    return true;
  }

  // Very light BK check – whole word "bk"
  if (/\bbk\b/.test(haystack)) {
    return true;
  }

  return false;
}

// Normalize a date string, accepting dd/mm/yyyy or mm/dd/yyyy.
// We pick the interpretation that is closest to "now" to avoid churn.
function normalizeReceiptDate(rawText, now) {
  if (!rawText || typeof rawText !== "string") {
    return { date: null, rawText: null };
  }

  const text = rawText.trim();
  if (!text) {
    return { date: null, rawText: null };
  }

  // First try a direct Date parse for ISO-like strings
  const direct = new Date(text);
  if (!isNaN(direct.getTime())) {
    return { date: direct, rawText: text };
  }

  const match = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!match) {
    return { date: null, rawText: text };
  }

  let part1 = parseInt(match[1], 10);
  let part2 = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  if (!isFinite(part1) || !isFinite(part2) || !isFinite(year)) {
    return { date: null, rawText: text };
  }

  // Handle 2-digit year
  if (year < 100) {
    year = year >= 70 ? 1900 + year : 2000 + year;
  }

  const candidates = [];

  function pushCandidate(day, month) {
    if (day < 1 || day > 31) return;
    if (month < 1 || month > 12) return;

    // Use UTC to avoid timezone day shifts
    const d = new Date(Date.UTC(year, month - 1, day));
    candidates.push(d);
  }

  // Morocco default: dd/mm/yyyy
  pushCandidate(part1, part2);

  // Also try mm/dd/yyyy if plausible (both parts <= 12)
  if (part1 <= 12 && part2 <= 31) {
    pushCandidate(part2, part1);
  }

  if (candidates.length === 0) {
    return { date: null, rawText: text };
  }

  if (!now) {
    now = new Date();
  }

  const nowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  let best = candidates[0];
  let bestScore = Math.abs(
    Date.UTC(best.getUTCFullYear(), best.getUTCMonth(), best.getUTCDate()) -
      nowUtc
  );

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const score = Math.abs(
      Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()) - nowUtc
    );
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }

  return { date: best, rawText: text };
}

function extractTransactionDate(fields, result) {
  let candidateField =
    (fields && fields.TransactionDate) ||
    (fields && fields.TransactionDateTime) ||
    (fields && fields.PurchaseDate) ||
    null;

  let rawText = null;
  let dateFromField = null;

  if (candidateField) {
    if (candidateField.valueDate) {
      const v = candidateField.valueDate;
      if (v instanceof Date) {
        dateFromField = v;
      } else if (typeof v === "string") {
        const parsed = new Date(v);
        if (!isNaN(parsed.getTime())) {
          dateFromField = parsed;
        }
      }
    }

    if (!dateFromField && candidateField.value) {
      const v = candidateField.value;
      if (v instanceof Date) {
        dateFromField = v;
      } else if (typeof v === "string") {
        rawText = v;
      }
    }

    if (!rawText && candidateField.content && typeof candidateField.content === "string") {
      rawText = candidateField.content;
    }
  }

  if (!rawText && result && typeof result.content === "string") {
    const match = result.content.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
    if (match) {
      rawText = match[1];
    }
  }

  if (dateFromField) {
    return { date: dateFromField, rawText: rawText || null };
  }

  if (rawText) {
    const normalized = normalizeReceiptDate(rawText, new Date());
    return { date: normalized.date, rawText: normalized.rawText };
  }

  return { date: null, rawText: null };
}

// ---- main analysis function ----

// buffer = Buffer of the image (jpeg/png...)
async function analyzeReceipt(buffer) {
  const client = getClient();

  const poller = await client.beginAnalyzeDocument("prebuilt-receipt", buffer);
  const result = await poller.pollUntilDone();

  if (!result.documents || !result.documents.length) {
    return {
      amount: null,
      merchantName: null,
      transactionDate: null,
      rawDateText: null,
      hasBurgerKing: null,
    };
  }

  const receipt = result.documents[0];
  const fields = receipt.fields || {};

  const amount = extractAmountFromFields(fields);
  const merchantName = extractMerchantName(fields, result);
  const { date: transactionDate, rawText: rawDateText } = extractTransactionDate(
    fields,
    result
  );
  const hasBurgerKing = detectBurgerKing(fields, result);

  return {
    amount,
    merchantName,
    transactionDate,
    rawDateText,
    hasBurgerKing,
  };
}

// Backward-compatible function: still returns only amount
async function extractTotalAmountFromReceipt(buffer) {
  const analysis = await analyzeReceipt(buffer);
  return analysis.amount;
}

module.exports = {
  extractTotalAmountFromReceipt,
  analyzeReceipt,
};
