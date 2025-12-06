// Helper to read the logged-in user from the Static Web Apps header
// x-ms-client-principal. If it's not there (local dev), we fall back to DEV_USER_ID
// or "demo-user-1".

function getClientPrincipalFromRequest(request) {
  // In Azure Functions v4 with SWA, headers can be accessed like this:
  const header =
    request.headers.get("x-ms-client-principal") ||
    request.headers["x-ms-client-principal"];

  if (!header) {
    // Local dev fallback: use a fake user
    const devUser = process.env.DEV_USER_ID || "demo-user-1";
    return {
      identityProvider: "dev",
      userId: devUser,
      userDetails: devUser,
      userRoles: ["anonymous", "authenticated"],
    };
  }

  const decoded = Buffer.from(header, "base64").toString("utf8");
  const principal = JSON.parse(decoded);

  return principal;
}

function getUserId(request) {
  const principal = getClientPrincipalFromRequest(request);
  return principal?.userId || null;
}

module.exports = {
  getClientPrincipalFromRequest,
  getUserId,
};
