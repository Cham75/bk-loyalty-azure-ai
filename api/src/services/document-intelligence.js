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

// ---------- helpers ----------

function extractAmountFromFields(fields) {
  if (!fields) return null;

  const candidate =
    fields.Total ||
    fields.TransactionTotal ||
    fields.Subtotal ||
    fields.SubTotal ||
    null;

  if (!candidate) return null;

  const raw =
    candidate.value ??
    candidate.valueNumber ??
    candidate.content ??
    null;

  if (typeof raw === "number") {
    return raw;
  }

  if (typeof raw === "string") {
    const normalized = raw.replace(",", ".").replace(/[^\d.]/g, "");
    const parsed = parseFloat(normalized);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractMerchantName(fields, result) {
  if (fields && fields.MerchantName) {
    const f = fields.MerchantName;
    if (typeof f.value === "string" && f.value.trim()) {
      return f.value.trim();
    }
    if (typeof f.content === "string" && f.content.trim()) {
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

function detectBurgerKing(fields, result) {
  const parts = [];

  if (fields && fields.MerchantName) {
    const f = fields.MerchantName;
    if (typeof f.value === "string") {
      parts.push(f.value);
    } else if (typeof f.content === "string") {
      parts.push(f.content);
    }
  }

  if (result && typeof result.content === "string") {
    parts.push(result.content);
  }

  const haystack = parts.join(" ").toLowerCase();

  if (!haystack) {
    return null; // unknown
  }

  if (haystack.includes("burger king") || haystack.includes("burgerking")) {
    return true;
  }

  // very soft "BK" check
  if (/\bbk\b/.test(haystack)) {
    return true;
  }

  return false;
}

// Normalize dd/mm/yyyy or mm/dd/yyyy.
// Rule: try BOTH and pick the one closest to TODAY.
// If no dd/mm pattern → use normal Date().
function normalizeReceiptDate(rawText, now) {
  if (!rawText || typeof rawText !== "string") {
    return { date: null, rawText: null };
  }

  const text = rawText.trim();
  if (!text) {
    return { date: null, rawText: null };
  }

  const pattern = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
  const match = text.match(pattern);

  // No explicit 12/10/2025-style pattern → use native parsing
  if (!match) {
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) {
      return { date: direct, rawText: text };
    }
    return { date: null, rawText: text };
  }

  let part1 = parseInt(match[1], 10);
  let part2 = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  if (!Number.isFinite(part1) || !Number.isFinite(part2) || !Number.isFinite(year)) {
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
    // local time, midnight
    const d = new Date(year, month - 1, day);
    candidates.push(d);
  }

  // Morocco default dd/mm/yyyy
  pushCandidate(part1, part2);

  // Also allow mm/dd/yyyy if plausible
  if (part1 <= 12 && part2 <= 31) {
    pushCandidate(part2, part1);
  }

  if (!candidates.length) {
    return { date: null, rawText: text };
  }

  if (!now) {
    now = new Date();
  }
  const baseMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  let best = candidates[0];
  let bestScore = Math.abs(
    new Date(
      best.getFullYear(),
      best.getMonth(),
      best.getDate()
    ).getTime() - baseMidnight
  );

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const cMidnight = new Date(
      c.getFullYear(),
      c.getMonth(),
      c.getDate()
    ).getTime();
    const score = Math.abs(cMidnight - baseMidnight);
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }

  return { date: best, rawText: text };
}

function extractTransactionDate(fields, result) {
  let rawText = null;
  const dateFields = [];

  if (fields) {
    if (fields.TransactionDate) dateFields.push(fields.TransactionDate);
    if (fields.TransactionDateTime) dateFields.push(fields.TransactionDateTime);
    if (fields.PurchaseDate) dateFields.push(fields.PurchaseDate);
  }

  // Prefer the raw text we see on the receipt (dd/mm or mm/dd)
  for (const f of dateFields) {
    if (f && typeof f.content === "string" && f.content.trim()) {
      rawText = f.content.trim();
      break;
    }
    if (f && typeof f.value === "string" && f.value.trim()) {
      rawText = f.value.trim();
      break;
    }
  }

  // Fallback: scan entire recognized content for a 12/10/2025-like chunk
  if (!rawText && result && typeof result.content === "string") {
    const m = result.content.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
    if (m) {
      rawText = m[1];
    }
  }

  if (rawText) {
    const normalized = normalizeReceiptDate(rawText, new Date());
    return { date: normalized.date, rawText: normalized.rawText };
  }

  // LAST RESORT: if AI gave us a Date directly and we really have nothing else
  for (const f of dateFields) {
    if (f && f.valueDate instanceof Date && !Number.isNaN(f.valueDate.getTime())) {
      return { date: f.valueDate, rawText: null };
    }
  }

  return { date: null, rawText: null };
}

// ---------- main analysis ----------

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

// Backward-compatible helper
async function extractTotalAmountFromReceipt(buffer) {
  const info = await analyzeReceipt(buffer);
  return info.amount;
}

module.exports = {
  analyzeReceipt,
  extractTotalAmountFromReceipt,
};
