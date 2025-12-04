const { BlobServiceClient } = require("@azure/storage-blob");
const { randomUUID } = require("crypto");

const connStr = process.env.RECEIPTS_STORAGE_CONNECTION_STRING;
const containerName = process.env.RECEIPTS_STORAGE_CONTAINER || "receipts";

if (!connStr) {
  console.warn(
    "⚠️ RECEIPTS_STORAGE_CONNECTION_STRING is not set – Blob upload will fail."
  );
}

let containerClient = null;

function getContainerClient() {
  if (!connStr) {
    throw new Error("No RECEIPTS_STORAGE_CONNECTION_STRING configured.");
  }
  if (!containerClient) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
    containerClient = blobServiceClient.getContainerClient(containerName);
  }
  return containerClient;
}

async function ensureContainer() {
  const client = getContainerClient();
  await client.createIfNotExists();
  return client;
}

async function uploadReceiptImage(userId, fileName, contentType, base64Data) {
  const buffer = Buffer.from(base64Data, "base64");

  const container = await ensureContainer();

  const safeName = fileName || "receipt.jpg";
  const blobName = `${userId}/${Date.now()}-${randomUUID()}-${safeName}`;

  const blockBlobClient = container.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || "image/jpeg",
    },
  });

  return blockBlobClient.url;
}

module.exports = {
  uploadReceiptImage,
};
