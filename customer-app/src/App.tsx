import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

import { QRCodeCanvas } from "qrcode.react";

interface HealthCheckResponse {
  status: string;
  message: string;
  timestamp: string;
}

interface BalanceResponse {
  userId: string;
  points: number;
}

interface RewardResponse {
  rewardId: string;
  rewardName: string;
  qrPayload: string;
  newBalance: number;
  pointsCost: number;
}

type ClientClaim = {
  typ: string;
  val: string;
};

type ClientPrincipal = {
  userId: string;
  userDetails?: string | null;
  identityProvider: string;
  userRoles: string[];
  claims?: ClientClaim[];
};

// Helper: convert File → base64 (without data: prefix)
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const commaIndex = result.indexOf(",");
        const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
        resolve(base64);
      } else {
        reject(new Error("Unexpected FileReader result type"));
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

function App() {
  // Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState<boolean>(true);

  // API / points / receipts / rewards
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [isCallingApi, setIsCallingApi] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [lastReceiptResult, setLastReceiptResult] = useState<string | null>(
    null
  );
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  const [lastReward, setLastReward] = useState<RewardResponse | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // ------- AUTH: load current user from /.auth/me -------
  const loadUser = async () => {
    try {
      const res = await fetch("/.auth/me", {
        credentials: "include",
      });

      if (!res.ok) {
        setUserEmail(null);
        return;
      }

      const payload = await res.json();
      const principal = payload?.clientPrincipal as
        | ClientPrincipal
        | undefined;

      if (!principal) {
        setUserEmail(null);
        return;
      }

      // 1) Try userDetails directly
      let email: string | null = principal.userDetails ?? null;

      // 2) Fallback: look into claims array (emails/email/emailaddress)
      if (!email && Array.isArray(principal.claims)) {
        const emailClaim =
          principal.claims.find(
            (c) =>
              c.typ === "emails" ||
              c.typ === "email" ||
              c.typ ===
                "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
          ) ?? null;

        if (emailClaim) {
          email = emailClaim.val;
        }
      }

      setUserEmail(email);
    } catch (error) {
      console.error("Error loading /.auth/me", error);
      setUserEmail(null);
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const callHealthCheck = async () => {
    try {
      setIsCallingApi(true);
      setApiMessage(null);

      const res = await fetch("/api/health-check?name=Customer");
      if (!res.ok) {
        throw new Error(`Health-check failed with status ${res.status}`);
      }

      const data = (await res.json()) as HealthCheckResponse;
      setApiMessage(`${data.status} – ${data.message}`);
    } catch (error) {
      console.error(error);
      setApiMessage("Error calling health-check API");
    } finally {
      setIsCallingApi(false);
    }
  };

  const fetchBalance = async () => {
    try {
      setIsLoadingBalance(true);

      const res = await fetch("/api/get-user-balance");
      if (!res.ok) {
        if (res.status === 401) {
          setPoints(null);
          return;
        }
        throw new Error(`get-user-balance failed with status ${res.status}`);
      }

      const data = (await res.json()) as BalanceResponse;
      setPoints(data.points);
    } catch (error) {
      console.error(error);
      setPoints(null);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setSelectedFileName(null);
      return;
    }
    setSelectedFile(file);
    setSelectedFileName(file.name);
  };

  const uploadRealReceipt = async () => {
    if (!selectedFile) {
      setLastReceiptResult("Please select a receipt image first.");
      return;
    }

    try {
      setIsUploadingReceipt(true);
      setLastReceiptResult(null);

      const base64 = await fileToBase64(selectedFile);

      const res = await fetch("/api/upload-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType: selectedFile.type || "image/jpeg",
          fileBase64: base64,
          // For now amount is fake (75); Document Intelligence overrides this if it succeeds.
          amount: 75,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("upload-receipt error", data);
        if (data?.error === "UNAUTHENTICATED") {
          setLastReceiptResult("Please sign in before uploading a receipt.");
        } else {
          setLastReceiptResult("Error uploading receipt.");
        }
        return;
      }

      setPoints(data.newBalance);
      setLastReceiptResult(
        `Receipt stored. Amount detected: ${data.amount} – +${data.pointsEarned} points (new balance: ${data.newBalance}).`
      );
    } catch (error) {
      console.error(error);
      setLastReceiptResult("Network error while uploading receipt.");
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const redeemForReward = async () => {
    try {
      setIsRedeeming(true);
      setRedeemError(null);

      const res = await fetch("/api/redeem-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardName: "Free Sundae",
          pointsCost: 100,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "NOT_ENOUGH_POINTS") {
          setRedeemError("Not enough points (need 100).");
        } else if (data.error === "UNAUTHENTICATED") {
          setRedeemError("Please sign in first.");
        } else {
          setRedeemError("Error while creating reward.");
        }
        return;
      }

      setPoints(data.newBalance);
      setLastReward(data as RewardResponse);
    } catch (err) {
      console.error(err);
      setRedeemError("Network error.");
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "2rem 1.5rem 3rem",
        }}
      >
        {/* HEADER WITH SIGN-IN / SIGN-OUT */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2rem",
          }}
        >
          <div>
            <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
              BK Loyalty – Customer Portal
            </h1>
            <p style={{ color: "#555" }}>
              Upload your Burger King receipt to earn points and unlock rewards.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "0.25rem",
            }}
          >
            {loadingUser ? (
              <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                Checking session…
              </span>
            ) : userEmail ? (
              <span style={{ fontSize: "0.9rem", color: "#4b5563" }}>
                Signed in as <strong>{userEmail}</strong>
              </span>
            ) : (
              <span style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                Not signed in
              </span>
            )}
            <a
              href={userEmail ? "/.auth/logout" : "/.auth/login/ciam"}
              style={{
                padding: "0.35rem 0.8rem",
                borderRadius: "999px",
                border: "1px solid #e5e7eb",
                textDecoration: "none",
                fontSize: "0.85rem",
                background: "#ffffff",
              }}
            >
              {userEmail ? "Sign out" : "Sign in"}
            </a>
          </div>
        </header>

        {/* Section 1 – API connectivity test */}
        <section
          style={{
            background: "#fff",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.04)",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
            Backend status
          </h2>
          <p style={{ marginBottom: "0.75rem", color: "#555" }}>
            Check that the API (Azure Functions) is reachable from this app.
          </p>
          <button
            onClick={callHealthCheck}
            disabled={isCallingApi}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              background: "#5a2dfc",
              color: "#fff",
            }}
          >
            {isCallingApi ? "Calling API…" : "Call health-check"}
          </button>
          {apiMessage && (
            <p style={{ marginTop: "0.75rem", color: "#333" }}>{apiMessage}</p>
          )}
        </section>

        {/* Section 2 – Points / balance + redeem reward */}
        <section
          style={{
            background: "#fff",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.04)",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
            Your loyalty points
          </h2>
          <p style={{ marginBottom: "0.75rem", color: "#555" }}>
            This calls the <code>/get-user-balance</code> API endpoint.
          </p>
          <button
            onClick={fetchBalance}
            disabled={isLoadingBalance}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              background: "#111827",
              color: "#fff",
            }}
          >
            {isLoadingBalance ? "Loading balance…" : "Load my points"}
          </button>
          <p style={{ marginTop: "0.75rem", color: "#333" }}>
            Current balance:{" "}
            <strong>
              {points !== null ? `${points} points` : "No data loaded yet"}
            </strong>
          </p>

          <div style={{ marginTop: "0.75rem" }}>
            <button
              onClick={redeemForReward}
              disabled={isRedeeming}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                background: "#dc2626",
                color: "#fff",
              }}
            >
              {isRedeeming
                ? "Creating reward..."
                : "Redeem 100 points for Free Sundae"}
            </button>
            {redeemError && (
              <p style={{ marginTop: "0.5rem", color: "#b91c1c" }}>
                {redeemError}
              </p>
            )}
          </div>

          {lastReward && (
            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <p
                  style={{
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                  }}
                >
                  Your reward QR:
                </p>
                <QRCodeCanvas value={lastReward.qrPayload} size={160} />
              </div>
              <div style={{ fontSize: "0.9rem", color: "#374151" }}>
                <p>
                  Reward: <strong>{lastReward.rewardName}</strong>
                </p>
                <p>
                  Code: <strong>{lastReward.rewardId}</strong>
                </p>
                <p style={{ marginTop: "0.5rem" }}>
                  Show this QR (or code) to BK staff. Their app will scan / type
                  it and validate the reward.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Section 3 – Receipt upload */}
        <section
          style={{
            background: "#fff",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.04)",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
            Upload your receipt
          </h2>
          <p style={{ marginBottom: "0.75rem", color: "#555" }}>
            This sends the image to the backend, stores it in Blob Storage,
            saves a receipt document in Cosmos DB, and uses Document Intelligence
            to detect the real total amount.
          </p>

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "inline-block",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px dashed #9ca3af",
                cursor: "pointer",
                background: "#f9fafb",
              }}
            >
              <span>Select receipt image</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </label>

            <button
              onClick={uploadRealReceipt}
              disabled={isUploadingReceipt}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                background: "#16a34a",
                color: "#fff",
              }}
            >
              {isUploadingReceipt ? "Uploading..." : "Upload & earn"}
            </button>
          </div>

          {selectedFileName && (
            <p style={{ marginTop: "0.75rem", color: "#333" }}>
              Selected file: <strong>{selectedFileName}</strong>
            </p>
          )}

          {lastReceiptResult && (
            <p style={{ marginTop: "0.75rem", color: "#333" }}>
              {lastReceiptResult}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
