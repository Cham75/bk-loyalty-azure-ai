import { useEffect, useRef, useState, type ChangeEvent } from "react";
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

interface ReceiptReason {
  code: string;
  message: string;
}

interface UploadReceiptSuccessResponse {
  userId: string;
  amount: number;
  pointsEarned: number;
  newBalance: number;
  receiptId: string;
  receiptBlobUrl: string;
  transactionDate?: string | null;
  rawDateText?: string | null;
  merchantName?: string | null;
}

interface UploadReceiptErrorResponse {
  error: string;
  reasons?: ReceiptReason[];
  amount?: number;
  transactionDate?: string | null;
  rawDateText?: string | null;
  merchantName?: string | null;
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

interface AuthMeResponse {
  clientPrincipal?: ClientPrincipal | null;
}

function formatReceiptDateFromResponse(
  transactionDate?: string | null,
  rawDateText?: string | null
): string | null {
  if (transactionDate) {
    const d = new Date(transactionDate);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
  }

  if (rawDateText && rawDateText.trim().length > 0) {
    return rawDateText.trim();
  }

  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.split(",")[1] || "";
        resolve(base64);
      } else {
        reject(new Error("Unexpected FileReader result type"));
      }
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Error reading file"));
    };

    reader.readAsDataURL(file);
  });
}

function App() {
  // health-check
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [isCallingApi, setIsCallingApi] = useState(false);

  // user & balance
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [points, setPoints] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // receipts
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [lastReceiptResult, setLastReceiptResult] = useState<string | null>(null);
  const [lastReceiptError, setLastReceiptError] = useState<string | null>(null);

  // rewards
  const [lastReward, setLastReward] = useState<RewardResponse | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // gallery input
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const isSignedIn = !!userLabel;

  // Load authenticated user info
  const loadUser = async () => {
    try {
      setLoadingUser(true);

      const res = await fetch("/.auth/me");
      if (!res.ok) {
        setUserLabel(null);
        return;
      }

      const payload = (await res.json()) as AuthMeResponse;
      const principal = payload?.clientPrincipal;

      if (!principal) {
        setUserLabel(null);
        return;
      }

      const claims = principal.claims || [];
      const findClaim = (types: string[]) =>
        claims.find((c) => types.includes(c.typ)) || null;

      const emailClaim =
        findClaim(["emails"]) ||
        findClaim(["email"]) ||
        findClaim([
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        ]) ||
        findClaim(["preferred_username"]);

      let label: string | null = null;

      if (emailClaim && emailClaim.val) {
        label = emailClaim.val;
      } else if (principal.userDetails) {
        const details = principal.userDetails.toLowerCase();
        if (details !== "unknown" && details !== "n/a") {
          label = principal.userDetails;
        }
      } else if (principal.userId) {
        label = principal.userId;
      }

      setUserLabel(label);
    } catch (error) {
      console.error("Error loading /.auth/me", error);
      setUserLabel(null);
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    void loadUser();
  }, []);

  // Fetch balance automatically once user is known
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

  useEffect(() => {
    if (!loadingUser && userLabel) {
      void fetchBalance();
    }
  }, [loadingUser, userLabel]);

  // Health-check
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

  // File selection from gallery
  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      setSelectedFileName(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    setSelectedFile(file);
    setSelectedFileName(file.name);

    setLastReceiptError(null);
    setLastReceiptResult(null);

    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  };

  // Camera: start / stop stream when toggling isCameraOpen
  useEffect(() => {
    async function startCamera() {
      if (!isCameraOpen) {
        // stop any existing stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        if (videoRef.current) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          videoRef.current.srcObject = null;
        }
        return;
      }

      try {
        setCameraError(null);

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCameraError("Camera not supported on this device/browser.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        mediaStreamRef.current = stream;
        if (videoRef.current) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error("Error accessing camera", err);
        setCameraError(
          "Unable to access camera. Please allow camera access in your browser settings."
        );
      }
    }

    void startCamera();

    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (videoRef.current) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        videoRef.current.srcObject = null;
      }
    };
  }, [isCameraOpen]);

  const closeCamera = () => {
    setIsCameraOpen(false);
  };

  const takePhotoFromCamera = () => {
    const video = videoRef.current;
    if (!video) {
      setCameraError("Camera is not ready yet.");
      return;
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) {
      setCameraError(
        "Camera is still starting. Please wait a second and try again."
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Unable to capture image.");
      return;
    }

    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("Unable to capture image.");
          return;
        }

        const file = new File([blob], "receipt-camera.jpg", {
          type: blob.type || "image/jpeg",
        });

        setSelectedFile(file);
        setSelectedFileName(file.name);
        setLastReceiptError(null);
        setLastReceiptResult(null);

        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });

        setIsCameraOpen(false);
      },
      "image/jpeg",
      0.9
    );
  };

  // Handle receipt rejected
  const handleReceiptRejected = (data: UploadReceiptErrorResponse) => {
    const reasons = data.reasons || [];
    const formattedDate = formatReceiptDateFromResponse(
      data.transactionDate ?? null,
      data.rawDateText ?? null
    );

    const messages: string[] = [];

    if (reasons.some((r) => r.code === "RECEIPT_TOO_OLD")) {
      if (formattedDate) {
        messages.push(
          `The ticket dated ${formattedDate} is older than 2 days, so it is not valid.`
        );
      } else {
        messages.push("This ticket is older than 2 days, so it is not valid.");
      }
    }

    if (reasons.some((r) => r.code === "RECEIPT_IN_FUTURE")) {
      messages.push(
        "The ticket date appears to be in the future. Please check the date on your receipt."
      );
    }

    if (reasons.some((r) => r.code === "MERCHANT_NOT_BURGER_KING")) {
      messages.push(
        'We could not detect "Burger King" or "BK" on the receipt. Please use a Burger King receipt and ensure the logo/name is clearly visible.'
      );
    }

    if (reasons.some((r) => r.code === "DATE_NOT_DETECTED")) {
      messages.push(
        "We could not read the date on the receipt. Please upload a clearer photo where the date is visible."
      );
    }

    if (messages.length === 0) {
      messages.push(
        "Your receipt could not be accepted. Please try again with a clearer photo."
      );
    }

    setLastReceiptError(messages.join(" "));
    setLastReceiptResult(null);
  };

  // Upload receipt
  const uploadRealReceipt = async () => {
    if (!selectedFile) {
      setLastReceiptError("Please take or choose a receipt photo first.");
      return;
    }

    try {
      setIsUploadingReceipt(true);
      setLastReceiptError(null);
      setLastReceiptResult(null);

      const base64 = await fileToBase64(selectedFile);

      const res = await fetch("/api/upload-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType: selectedFile.type,
          fileBase64: base64,
        }),
      });

      const data = (await res.json()) as
        | UploadReceiptSuccessResponse
        | UploadReceiptErrorResponse;

      if (!res.ok) {
        const errData = data as UploadReceiptErrorResponse;

        if (res.status === 401 || errData.error === "UNAUTHENTICATED") {
          setLastReceiptError("Please sign in before uploading a receipt.");
          return;
        }

        if (errData.error === "RECEIPT_REJECTED") {
          handleReceiptRejected(errData);
          return;
        }

        if (errData.error === "DUPLICATE_RECEIPT") {
          setLastReceiptError("This receipt has already been used.");
          return;
        }

        if (errData.error === "DAILY_LIMIT_REACHED") {
          setLastReceiptError(
            "You’ve reached today’s limit of rewarded receipts. Try again tomorrow."
          );
          return;
        }

        setLastReceiptError("Error while uploading the receipt.");
        return;
      }

      const success = data as UploadReceiptSuccessResponse;
      setPoints(success.newBalance);

      const formattedDate = formatReceiptDateFromResponse(
        success.transactionDate ?? null,
        success.rawDateText ?? null
      );

      const amountNum = success.amount;
      const pointsEarned = success.pointsEarned;

      let msg: string;
      if (formattedDate) {
        msg = `Receipt dated ${formattedDate} with total ${amountNum.toFixed(
          2
        )} accepted. You earned ${pointsEarned} points.`;
      } else {
        msg = `Receipt accepted. You earned ${pointsEarned} points on an amount of ${amountNum.toFixed(
          2
        )}.`;
      }

      setLastReceiptResult(msg);
    } catch (error) {
      console.error(error);
      setLastReceiptError("Network error while uploading the receipt.");
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  // Redeem reward
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

  // -------------- RENDERING --------------

  // While we don't yet know if the user is signed in, show a neutral loader
  if (loadingUser) {
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
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minHeight: "100vh",
          }}
        >
          <p style={{ fontSize: "1.1rem", color: "#4b5563" }}>
            Checking your BK Loyalty session…
          </p>
        </main>
      </div>
    );
  }

  // --------- MARKETING LANDING PAGE (NOT SIGNED IN) ---------
  if (!isSignedIn) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, #fee2e2, #f97316 0, #f97316 35%, #111827 100%)",
          color: "#111827",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "2.5rem 1.5rem 3.5rem",
          }}
        >
          {/* Top bar with small sign-in link */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "3rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "999px",
                  background: "#111827",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#f97316",
                  fontWeight: 800,
                  fontSize: "1rem",
                }}
              >
                BK
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: "#111827",
                  }}
                >
                  BK Loyalty
                </div>
                <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
                  Turn every burger into rewards
                </div>
              </div>
            </div>

            <a
              href="/.auth/login/ciam"
              style={{
                fontSize: "0.9rem",
                color: "#111827",
                textDecoration: "none",
                padding: "0.45rem 0.9rem",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.85)",
                border: "1px solid rgba(31,41,55,0.1)",
                fontWeight: 500,
              }}
            >
              Log in
            </a>
          </header>

          {/* Hero section */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
              gap: "2rem",
              alignItems: "center",
            }}
          >
            {/* Text column */}
            <div>
              <h1
                style={{
                  fontSize: "2.3rem",
                  lineHeight: 1.1,
                  marginBottom: "1rem",
                  color: "#111827",
                }}
              >
                Scan your Burger King receipts.
                <br />
                Earn points, unlock free treats.
              </h1>
              <p
                style={{
                  fontSize: "1rem",
                  color: "#111827",
                  opacity: 0.9,
                  marginBottom: "1.5rem",
                }}
              >
                Create your BK Loyalty account in a few seconds, scan your
                Burger King receipts and turn every visit into{" "}
                <strong>points and rewards</strong>.
              </p>

              {/* Main CTAs */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  marginBottom: "1rem",
                }}
              >
                <a
                  href="/.auth/login/ciam"
                  style={{
                    padding: "0.75rem 1.4rem",
                    borderRadius: "999px",
                    background: "#111827",
                    color: "#f9fafb",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: "0.95rem",
                  }}
                >
                  Create my BK Loyalty account
                </a>
                <a
                  href="/.auth/login/ciam"
                  style={{
                    padding: "0.75rem 1.4rem",
                    borderRadius: "999px",
                    background: "rgba(249,250,251,0.9)",
                    color: "#111827",
                    textDecoration: "none",
                    fontWeight: 500,
                    fontSize: "0.95rem",
                    border: "1px solid rgba(17,24,39,0.1)",
                  }}
                >
                  I already have an account
                </a>
              </div>

              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#111827",
                  opacity: 0.8,
                }}
              >
                No card to carry, no code to remember. Just your phone and your
                Burger King receipts.
              </p>
            </div>

            {/* Steps / mini mockup column */}
            <div
              style={{
                background: "rgba(249,250,251,0.95)",
                borderRadius: "1.25rem",
                padding: "1.25rem 1.2rem",
                boxShadow: "0 18px 45px rgba(15,23,42,0.25)",
                border: "1px solid rgba(148,163,184,0.3)",
              }}
            >
              <p
                style={{
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#6b7280",
                  marginBottom: "0.75rem",
                  fontWeight: 600,
                }}
              >
                How it works
              </p>
              <ol
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  fontSize: "0.9rem",
                  color: "#111827",
                }}
              >
                <li
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "999px",
                      background: "#111827",
                      color: "#f9fafb",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    1
                  </span>
                  <span>
                    Create your BK Loyalty account with your email in a few
                    seconds.
                  </span>
                </li>
                <li
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "999px",
                      background: "#111827",
                      color: "#f9fafb",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    2
                  </span>
                  <span>
                    After each Burger King order, scan your receipt from the
                    app to earn points automatically.
                  </span>
                </li>
                <li
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "999px",
                      background: "#111827",
                      color: "#f9fafb",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    3
                  </span>
                  <span>
                    Redeem your points for free items. Show your QR reward code
                    at the counter and enjoy.
                  </span>
                </li>
              </ol>

              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "0.8rem",
                  borderTop: "1px dashed rgba(148,163,184,0.6)",
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                You&apos;ll see your balance, upload receipts, and generate QR
                rewards right after you log in.
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // --------- SIGNED-IN DASHBOARD (EXISTING APP) ---------
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
            ) : isSignedIn ? (
              <span style={{ fontSize: "0.9rem", color: "#4b5563" }}>
                Signed in as <strong>{userLabel}</strong>
              </span>
            ) : (
              <span style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                Not signed in
              </span>
            )}
            <a
              href={isSignedIn ? "/.auth/logout" : "/.auth/login/ciam"}
              style={{
                padding: "0.35rem 0.8rem",
                borderRadius: "999px",
                border: "1px solid #e5e7eb",
                textDecoration: "none",
                fontSize: "0.85rem",
                background: "#ffffff",
              }}
            >
              {isSignedIn ? "Sign out" : "Sign in"}
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
            {isCallingApi ? "Checking…" : "Call health-check"}
          </button>
          {apiMessage && (
            <p style={{ marginTop: "0.75rem", color: "#111827" }}>
              {apiMessage}
            </p>
          )}
        </section>

        {/* Section 2 – Points & Rewards */}
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
            Your points & rewards
          </h2>

          {/* Balance */}
          <div style={{ marginBottom: "1rem" }}>
            <p style={{ marginBottom: "0.5rem", color: "#555" }}>
              Current points:
            </p>
            <span style={{ fontSize: "1.1rem", color: "#111827" }}>
              {isLoadingBalance
                ? "Loading..."
                : points === null
                ? isSignedIn
                  ? "—"
                  : "Please sign in to see your balance."
                : `${points} pts`}
            </span>
          </div>

          {/* Redeem reward */}
          <div>
            <p style={{ marginBottom: "0.5rem", color: "#555" }}>
              Redeem 100 points for a free Sundae.
            </p>
            <button
              onClick={redeemForReward}
              disabled={isRedeeming}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                background: "#f97316",
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
            to detect the total amount and the date.
          </p>

          {/* Camera + gallery buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <button
              type="button"
              onClick={() => setIsCameraOpen(true)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px dashed #9ca3af",
                background: "#f9fafb",
                cursor: "pointer",
              }}
            >
              Take photo with camera
            </button>

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px dashed #9ca3af",
                background: "#f9fafb",
                cursor: "pointer",
              }}
            >
              Choose from gallery
            </button>

            {/* hidden input for gallery */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelected}
              style={{ display: "none" }}
            />
          </div>

          <p
            style={{
              marginTop: "0.25rem",
              marginBottom: "0.75rem",
              fontSize: "0.85rem",
              fontStyle: "italic",
              color: "#6b7280",
            }}
          >
            Make sure the words &quot;Burger King&quot; or &quot;BK&quot;, the
            total amount and the date are clearly visible on the picture of the
            receipt.
          </p>

          {/* Camera overlay */}
          {isCameraOpen && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "#000",
                color: "#e5e7eb",
              }}
            >
              <p
                style={{
                  marginBottom: "0.5rem",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Camera view
              </p>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  maxHeight: "60vh",
                  overflow: "hidden",
                  borderRadius: "0.75rem",
                  background: "#111827",
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
              {cameraError && (
                <p
                  style={{
                    marginTop: "0.5rem",
                    color: "#fecaca",
                    fontSize: "0.85rem",
                  }}
                >
                  {cameraError}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={takePhotoFromCamera}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "999px",
                    border: "none",
                    background: "#22c55e",
                    color: "#022c22",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Capture photo
                </button>
                <button
                  type="button"
                  onClick={closeCamera}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "999px",
                    border: "1px solid #6b7280",
                    background: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Close camera
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {previewUrl && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "#f9fafb",
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div>
                <p
                  style={{
                    marginBottom: "0.25rem",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                  }}
                >
                  Preview:
                </p>
                <img
                  src={previewUrl}
                  alt="Selected receipt"
                  style={{
                    maxWidth: "200px",
                    maxHeight: "200px",
                    objectFit: "contain",
                    borderRadius: "0.5rem",
                    border: "1px solid #e5e7eb",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.85rem", color: "#4b5563", flex: 1 }}>
                <p>
                  <strong>File:</strong> {selectedFileName}
                </p>
                <p style={{ marginTop: "0.25rem" }}>
                  If the photo is not clear, you can take another one with the
                  camera or choose a different picture from your gallery.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setIsCameraOpen(true)}
                    style={{
                      padding: "0.35rem 0.8rem",
                      borderRadius: "999px",
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Retake with camera
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    style={{
                      padding: "0.35rem 0.8rem",
                      borderRadius: "999px",
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Choose another photo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Upload button + messages */}
          <button
            onClick={uploadRealReceipt}
            disabled={isUploadingReceipt || !selectedFile}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: selectedFile ? "pointer" : "not-allowed",
              fontWeight: 600,
              background: selectedFile ? "#16a34a" : "#9ca3af",
              color: "#fff",
            }}
          >
            {isUploadingReceipt ? "Uploading…" : "Upload this receipt"}
          </button>

          {lastReceiptError && (
            <p style={{ marginTop: "0.5rem", color: "#b91c1c" }}>
              {lastReceiptError}
            </p>
          )}

          {lastReceiptResult && (
            <p style={{ marginTop: "0.5rem", color: "#166534" }}>
              {lastReceiptResult}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
