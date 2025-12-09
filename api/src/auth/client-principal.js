// api/src/auth/client-principal.js
// Safe helper to read the logged-in user from the x-ms-client-principal header.
// - In production (Static Web Apps): we expect a real client principal from CIAM
// - In local dev (localhost): we fall back to DEV_USER_ID or "demo-user-1"

function getHeader(headers, name) {
  if (!headers) return null;

  // Azure Functions V4 (request.headers.get)
  if (typeof headers.get === "function") {
    const direct = headers.get(name);
    if (direct) return direct;

    const lower = headers.get(name.toLowerCase());
    if (lower) return lower;
  }

  // Fallback: plain object
  return (
    headers[name] ||
    headers[name.toLowerCase()] ||
    null
  );
}

function isLocalRequest(request) {
  try {
    if (!request || !request.url) return false;
    return request.url.includes("localhost");
  } catch {
    return false;
  }
}

function getClientPrincipalFromRequest(request) {
  try {
    const encoded = getHeader(request.headers, "x-ms-client-principal");

    if (!encoded) {
      // No header -> anonymous (or local dev without SWA auth)
      return null;
    }

    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const principal = JSON.parse(decoded);

    // Expect something like: { identityProvider, userId, userDetails, userRoles }
    if (!principal || typeof principal !== "object") {
      return null;
    }

    return principal;
  } catch (err) {
    // Never crash because of a bad header
    return null;
  }
}

// This is what your Functions will call.
function getUserId(request) {
  const principal = getClientPrincipalFromRequest(request);

  // If SWA sent a proper principal, use it
  if (principal && principal.userId) {
    return principal.userId;
  }

  // Local dev fallback (when running func start without SWA)
  if (isLocalRequest(request)) {
    return process.env.DEV_USER_ID || "demo-user-1";
  }

  // In production, no principal => unauthenticated
  return null;
}

module.exports = {
  getClientPrincipalFromRequest,
  getUserId,
};
