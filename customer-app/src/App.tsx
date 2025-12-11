import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { QRCodeCanvas } from "qrcode.react";

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
  tier?: string | null;
}

interface RewardHistoryItem {
  id: string;
  name: string;
  pointsCost: number | null;
  redeemed: boolean;
  createdAt?: string | null;
  redeemedAt?: string | null;
  tier?: string | null;
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

function formatVerboseDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const day = d.getDate();
  const monthIndex = d.getMonth();
  const year = d.getFullYear();

  const monthNames = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ];

  const monthName = monthNames[monthIndex] ?? "";
  return `${day} ${monthName} ${year}`;
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

type RewardTier =
  | "CROWN_40"
  | "CROWN_80"
  | "CROWN_120"
  | "CROWN_135"
  | "CROWN_150"
  | "CROWN_200"
  | "CROWN_240";

const TIER_COST: Record<RewardTier, number> = {
  CROWN_40: 40,
  CROWN_80: 80,
  CROWN_120: 120,
  CROWN_135: 135,
  CROWN_150: 150,
  CROWN_200: 200,
  CROWN_240: 240,
};

// Bleu BK pour les CTA
const BK_BLUE = "#0066CC";

function App() {
  // utilisateur & solde
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [points, setPoints] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // tickets
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [lastReceiptResult, setLastReceiptResult] = useState<string | null>(
    null
  );
  const [lastReceiptError, setLastReceiptError] = useState<string | null>(null);

  // récompenses
  const [lastReward, setLastReward] = useState<RewardResponse | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  // historique des récompenses
  const [rewardHistory, setRewardHistory] = useState<RewardHistoryItem[]>([]);
  const [isLoadingRewards, setIsLoadingRewards] = useState(false);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // input galerie
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // caméra
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const isSignedIn = !!userLabel;

  // Charge l'utilisateur authentifié
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

  // Récupère le solde de Couronnes
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

  const loadRewardHistory = async () => {
    try {
      setIsLoadingRewards(true);
      setRewardsError(null);

      const res = await fetch("/api/get-user-rewards");
      if (!res.ok) {
        if (res.status === 401) {
          setRewardHistory([]);
          return;
        }
        throw new Error(`get-user-rewards failed with status ${res.status}`);
      }

      const data = (await res.json()) as { rewards?: RewardHistoryItem[] };
      setRewardHistory(data.rewards ?? []);
    } catch (error) {
      console.error(error);
      setRewardsError(
        "Erreur lors du chargement de l'historique de tes récompenses."
      );
    } finally {
      setIsLoadingRewards(false);
    }
  };

  useEffect(() => {
    if (!loadingUser && userLabel) {
      void fetchBalance();
      void loadRewardHistory();
    }
  }, [loadingUser, userLabel]);

  // Sélection d'un fichier depuis la galerie
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

  // Caméra : démarrage / arrêt
  useEffect(() => {
    async function startCamera() {
      if (!isCameraOpen) {
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
          setCameraError(
            "Caméra non supportée sur cet appareil / navigateur."
          );
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
          "Impossible d'accéder à la caméra. Vérifie les autorisations dans ton navigateur."
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
      setCameraError("La caméra n'est pas encore prête.");
      return;
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) {
      setCameraError(
        "La caméra démarre encore. Attends une seconde puis réessaie."
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Impossible de capturer l'image.");
      return;
    }

    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("Impossible de capturer l'image.");
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

  // Gestion ticket refusé (message en français)
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
          `Le ticket daté du ${formattedDate} a plus de 2 jours et n'est pas valide pour gagner des Couronnes.`
        );
      } else {
        messages.push(
          "Ce ticket a plus de 2 jours et n'est pas valide pour gagner des Couronnes."
        );
      }
    }

    if (reasons.some((r) => r.code === "RECEIPT_IN_FUTURE")) {
      messages.push(
        "La date du ticket semble être dans le futur. Vérifie la date imprimée sur ton ticket."
      );
    }

    if (reasons.some((r) => r.code === "MERCHANT_NOT_BURGER_KING")) {
      messages.push(
        "Nous n'avons pas détecté « Burger King » ou « BK » sur le ticket. Utilise un ticket Burger King où le logo et le nom sont bien visibles."
      );
    }

    if (reasons.some((r) => r.code === "DATE_NOT_DETECTED")) {
      messages.push(
        "Nous n'arrivons pas à lire la date sur le ticket. Merci de prendre une photo où la date est clairement visible."
      );
    }

    if (messages.length === 0) {
      messages.push(
        "Ton ticket n'a pas pu être accepté. Essaie avec une photo plus nette du ticket Burger King."
      );
    }

    setLastReceiptError(messages.join(" "));
    setLastReceiptResult(null);
  };

  // Upload d'un vrai ticket
  const uploadRealReceipt = async () => {
    if (!selectedFile) {
      setLastReceiptError("Prends ou choisis d'abord une photo de ton ticket.");
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
          setLastReceiptError(
            "Merci de te connecter avant de déposer un ticket."
          );
          return;
        }

        if (errData.error === "RECEIPT_REJECTED") {
          handleReceiptRejected(errData);
          return;
        }

        if (errData.error === "DUPLICATE_RECEIPT") {
          setLastReceiptError("Ce ticket a déjà été utilisé.");
          return;
        }

        if (errData.error === "DAILY_LIMIT_REACHED") {
          setLastReceiptError(
            "Tu as déjà atteint la limite de tickets récompensés pour aujourd'hui. Réessaie demain."
          );
          return;
        }

        setLastReceiptError("Erreur lors de l'envoi du ticket.");
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
        msg = `Ticket du ${formattedDate} pour un montant de ${amountNum.toFixed(
          2
        )} MAD accepté. Tu gagnes ${pointsEarned} Couronnes.`;
      } else {
        msg = `Ticket accepté. Tu gagnes ${pointsEarned} Couronnes pour un montant de ${amountNum.toFixed(
          2
        )} MAD.`;
      }

      setLastReceiptResult(msg);
    } catch (error) {
      console.error(error);
      setLastReceiptError("Erreur réseau lors de l'envoi du ticket.");
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  // Utilisation des Couronnes (paliers)
  const redeemRewardTier = async (tier: RewardTier) => {
    try {
      setIsRedeeming(true);
      setRedeemError(null);

      const res = await fetch("/api/redeem-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "NOT_ENOUGH_POINTS") {
          const needed = TIER_COST[tier];
          setRedeemError(
            `Pas assez de Couronnes pour cette récompense (${needed} nécessaires).`
          );
        } else if (data.error === "UNAUTHENTICATED") {
          setRedeemError(
            "Merci de te connecter avant d'utiliser tes Couronnes."
          );
        } else {
          setRedeemError("Erreur lors de la création de la récompense.");
        }
        return;
      }

      const reward = data as RewardResponse;

      setPoints(reward.newBalance);
      setLastReward(reward);
      void loadRewardHistory();
    } catch (err) {
      console.error(err);
      setRedeemError("Erreur réseau.");
    } finally {
      setIsRedeeming(false);
    }
  };

  // -------------- RENDERING --------------

  // État de chargement de la session
  if (loadingUser) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5EBDC",
          color: "#502314",
          fontFamily:
            '"Flame", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
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
          <p style={{ fontSize: "1.1rem", color: "#502314" }}>
            Vérification de ta session BK Fidélité…
          </p>
        </main>
      </div>
    );
  }

  // --------- LANDING (non connecté) ---------
  if (!isSignedIn) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5EBDC",
          color: "#502314",
          fontFamily:
            '"Flame", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "2.5rem 1.5rem 3.5rem",
          }}
        >
          {/* Top bar */}
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
                  background: "#502314",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#F5EBDC",
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
                    color: "#502314",
                  }}
                >
                  BK Fidélité Maroc
                </div>
                <div style={{ fontSize: "0.8rem", color: "#7C4A2D" }}>
                  Chaque commande te rapporte des Couronnes
                </div>
              </div>
            </div>

            <a
              href="/.auth/login/ciam"
              style={{
                fontSize: "0.9rem",
                color: "#502314",
                textDecoration: "none",
                padding: "0.45rem 0.9rem",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(80,35,20,0.15)",
                fontWeight: 500,
              }}
            >
              Se connecter / Créer mon compte
            </a>
          </header>

          {/* Hero */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
              gap: "2rem",
              alignItems: "center",
            }}
          >
            {/* Colonne texte */}
            <div>
              <h1
                style={{
                  fontSize: "2.3rem",
                  lineHeight: 1.25,
                  marginBottom: "1rem",
                  color: "#502314",
                  fontWeight: 400, // Flame Regular pour le titre
                }}
              >
                Scanne tes tickets Burger King.
                <br />
                Gagne des Couronnes, débloque des cadeaux.
              </h1>
              <p
                style={{
                  fontSize: "1rem",
                  color: "#7C4A2D",
                  marginBottom: "1.5rem",
                  fontWeight: 400,
                }}
              >
                Crée ton compte <strong>BK Fidélité Maroc</strong> en quelques
                secondes, prends simplement ton ticket en photo et transforme
                tes visites en <strong>Couronnes et récompenses</strong>.
              </p>

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
                    background: BK_BLUE,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: "0.95rem",
                    boxShadow: "0 8px 20px rgba(0, 102, 204, 0.35)",
                  }}
                >
                  Se connecter ou créer mon compte BK Fidélité
                </a>
              </div>

              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#7C4A2D",
                  fontWeight: 400,
                }}
              >
                Pas de carte à garder, pas de formulaire papier. Juste ton
                téléphone et tes tickets Burger King Maroc.
              </p>
            </div>

            {/* Colonne droite : explication */}
            <div
              style={{
                background: "#FFF4D8",
                borderRadius: "1.25rem",
                padding: "1.25rem 1.2rem",
                boxShadow: "0 18px 45px rgba(80,35,20,0.25)",
                border: "1px solid rgba(247,202,118,0.9)",
              }}
            >
              <p
                style={{
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#7C4A2D",
                  marginBottom: "0.75rem",
                  fontWeight: 600,
                }}
              >
                Comment ça marche ?
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
                  color: "#502314",
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
                      background: "#502314",
                      color: "#F5EBDC",
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
                    Connecte-toi ou crée ton compte BK Fidélité avec ton e-mail
                    en quelques secondes.
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
                      background: "#502314",
                      color: "#F5EBDC",
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
                    Après chaque commande Burger King au Maroc, prends ton
                    ticket en photo dans l'appli pour gagner des Couronnes.
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
                      background: "#502314",
                      color: "#F5EBDC",
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
                    Utilise tes Couronnes pour des cadeaux. Génère un QR code de
                    récompense et montre-le en caisse.
                  </span>
                </li>
              </ol>

              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "0.8rem",
                  borderTop: "1px dashed rgba(124,74,45,0.5)",
                  fontSize: "0.8rem",
                  color: "#7C4A2D",
                }}
              >
                Tu verras ton solde de Couronnes, tes tickets et tes récompenses
                dès que tu es connecté.
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // --------- DASHBOARD (connecté) ---------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5EBDC",
        fontFamily:
          '"Flame", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        color: "#502314",
      }}
    >
      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "2rem 1.5rem 3rem",
        }}
      >
        {/* HEADER */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "2rem",
                marginBottom: "0.5rem",
                fontWeight: 400, // Regular pour le titre du dashboard
              }}
            >
              BK Fidélité – Espace client
            </h1>
            <p style={{ color: "#7C4A2D", fontWeight: 400 }}>
              Ajoute ton ticket Burger King Maroc pour gagner des Couronnes et
              les échanger contre des cadeaux.
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
              <span style={{ fontSize: "0.85rem", color: "#7C4A2D" }}>
                Vérification de la session…
              </span>
            ) : isSignedIn ? (
              <span style={{ fontSize: "0.9rem", color: "#502314" }}>
                Connecté en tant que <strong>{userLabel}</strong>
              </span>
            ) : (
              <span style={{ fontSize: "0.9rem", color: "#7C4A2D" }}>
                Non connecté
              </span>
            )}
            <a
              href={isSignedIn ? "/.auth/logout" : "/.auth/login/ciam"}
              style={{
                padding: "0.35rem 0.8rem",
                borderRadius: "999px",
                border: "1px solid #E4C7A1",
                textDecoration: "none",
                fontSize: "0.85rem",
                background: "#F5EBDC",
                color: "#502314",
              }}
            >
              {isSignedIn
                ? "Se déconnecter"
                : "Se connecter / Créer un compte"}
            </a>
          </div>
        </header>

        {/* Section – Couronnes & récompenses */}
        <section
          style={{
            background: "#FFF9ED",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.04)",
            marginBottom: "1.5rem",
            border: "1px solid #F0D5AA",
          }}
        >
          <h2
            style={{
              fontSize: "1.25rem",
              marginBottom: "0.75rem",
              fontWeight: 400,
            }}
          >
            Mes Couronnes & récompenses
          </h2>

          {/* Solde */}
          <div style={{ marginBottom: "1rem" }}>
            <p style={{ marginBottom: "0.5rem", color: "#7C4A2D" }}>
              Couronnes disponibles :
            </p>
            <span style={{ fontSize: "1.2rem", color: "#502314" }}>
              {isLoadingBalance
                ? "Chargement..."
                : points === null
                ? isSignedIn
                  ? "—"
                  : "Connecte-toi pour voir ton solde."
                : `${points} Couronnes`}
            </span>
          </div>

          {/* Explication programme */}
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 0.9rem",
              borderRadius: "0.75rem",
              background: "#FDF2D9",
              border: "1px dashed #F0D5AA",
              fontSize: "0.9rem",
              color: "#502314",
            }}
          >
            <p
              style={{
                marginBottom: "0.35rem",
                fontWeight: 600,
              }}
            >
              Ton programme BK Fidélité Maroc :
            </p>
            <p style={{ marginBottom: "0.25rem" }}>
              <strong>10 MAD dépensés = 1 Couronne</strong> (calculé sur le
              montant du ticket).
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>40 Couronnes</strong> → Petits Plaisirs
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>80 Couronnes</strong> → Snacks & Desserts
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>120 Couronnes</strong> → Burgers classiques
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>135 Couronnes</strong> → Burgers premium
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>150 Couronnes</strong> → Menus classiques
            </p>
            <p style={{ marginBottom: "0.15rem" }}>
              👑 <strong>200 Couronnes</strong> → Menus premium
            </p>
            <p>
              👑 <strong>240 Couronnes</strong> → Festin du King
            </p>
          </div>

          {/* Paliers utilisables */}
          <div>
            <p style={{ marginBottom: "0.5rem", color: "#7C4A2D" }}>
              Utilise tes Couronnes pour ces récompenses* :
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {/* 40 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 40 Couronnes – Petits Plaisirs
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Petits plaisirs salés ou sucrés (voir la sélection en
                  restaurant).
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>40 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 40 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 40
                        ? "Disponible"
                        : `Encore ${40 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_40")}
                  disabled={isRedeeming || points === null || points < 40}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 40
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 40
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 40 Couronnes"}
                </button>
              </div>

              {/* 80 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 80 Couronnes – Snacks & Desserts
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Snacks salés et desserts gourmands au choix.
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>80 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 80 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 80
                        ? "Disponible"
                        : `Encore ${80 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_80")}
                  disabled={isRedeeming || points === null || points < 80}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 80
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 80
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 80 Couronnes"}
                </button>
              </div>

              {/* 120 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 120 Couronnes – Burgers classiques
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Choix parmi les burgers classiques Burger King.
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>120 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 120 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 120
                        ? "Disponible"
                        : `Encore ${120 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_120")}
                  disabled={isRedeeming || points === null || points < 120}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 120
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 120
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 120 Couronnes"}
                </button>
              </div>

              {/* 135 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 135 Couronnes – Burgers premium
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Accède aux burgers premium de la carte.
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>135 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 135 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 135
                        ? "Disponible"
                        : `Encore ${135 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_135")}
                  disabled={isRedeeming || points === null || points < 135}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 135
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 135
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 135 Couronnes"}
                </button>
              </div>

              {/* 150 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 150 Couronnes – Menus classiques
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Menu classique complet (burger + boisson + accompagnement).
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>150 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 150 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 150
                        ? "Disponible"
                        : `Encore ${150 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_150")}
                  disabled={isRedeeming || points === null || points < 150}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 150
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 150
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 150 Couronnes"}
                </button>
              </div>

              {/* 200 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 200 Couronnes – Menus premium
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Menus premium avec plus de choix généreux.
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>200 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 200 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 200
                        ? "Disponible"
                        : `Encore ${200 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_200")}
                  disabled={isRedeeming || points === null || points < 200}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 200
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 200
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 200 Couronnes"}
                </button>
              </div>

              {/* 240 */}
              <div
                style={{
                  background: "#FFF4D8",
                  borderRadius: "0.75rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #F0D5AA",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.25rem",
                  }}
                >
                  👑 240 Couronnes – Festin du King
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                    marginBottom: "0.5rem",
                  }}
                >
                  Le niveau le plus généreux pour un vrai Festin du King.
                </p>
                <p
                  style={{
                    fontSize: "0.85rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Coût : <strong>240 Couronnes</strong>
                  {points !== null && (
                    <span
                      style={{
                        marginLeft: "0.25rem",
                        color: points >= 240 ? "#15803D" : "#9CA3AF",
                      }}
                    >
                      (
                      {points >= 240
                        ? "Disponible"
                        : `Encore ${240 - points} Couronnes`}
                      )
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => redeemRewardTier("CROWN_240")}
                  disabled={isRedeeming || points === null || points < 240}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    cursor:
                      isRedeeming || points === null || points < 240
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    background:
                      isRedeeming || points === null || points < 240
                        ? "#9CA3AF"
                        : "#D62300",
                    color: "#F5EBDC",
                    fontSize: "0.9rem",
                  }}
                >
                  {isRedeeming ? "Création…" : "Utiliser 240 Couronnes"}
                </button>
              </div>
            </div>

            {redeemError && (
              <p style={{ marginTop: "0.5rem", color: "#B91C1C" }}>
                {redeemError}
              </p>
            )}

            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.8rem",
                color: "#7C4A2D",
              }}
            >
              *Les produits exacts disponibles à chaque palier peuvent varier
              selon le restaurant Burger King Maroc.
            </p>
          </div>

          {/* Dernière récompense créée */}
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
                  Mon dernier QR de récompense :
                </p>
                <QRCodeCanvas value={lastReward.qrPayload} size={160} />
              </div>
              <div style={{ fontSize: "0.9rem", color: "#502314" }}>
                <p>
                  Récompense : <strong>{lastReward.rewardName}</strong>
                </p>
                <p>
                  Coût : <strong>{lastReward.pointsCost} Couronnes</strong>
                </p>
                <p>
                  Code : <strong>{lastReward.rewardId}</strong>
                </p>
                <p style={{ marginTop: "0.5rem" }}>
                  Présente ce QR (ou ce code) à l'équipe Burger King. Ils le
                  scanneront / saisiront pour valider la récompense.
                </p>
              </div>
            </div>
          )}

          {/* Historique des récompenses (repliable) */}
          <div
            style={{
              marginTop: "1.5rem",
              paddingTop: "1rem",
              borderTop: "1px dashed #F0D5AA",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: "1rem",
                    marginBottom: "0.25rem",
                    fontWeight: 400,
                  }}
                >
                  Historique de mes récompenses
                </h3>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#7C4A2D",
                  }}
                >
                  Retrouve toutes les récompenses générées et si elles ont été
                  utilisées ou non.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen((prev) => !prev)}
                style={{
                  padding: "0.4rem 0.9rem",
                  borderRadius: "999px",
                  border: "1px solid #E4C7A1",
                  background: "#F5EBDC",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {isHistoryOpen ? "Masquer l'historique" : "Afficher l'historique"}
              </button>
            </div>

            {isHistoryOpen && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "0.75rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void loadRewardHistory()}
                    disabled={isLoadingRewards}
                    style={{
                      padding: "0.35rem 0.8rem",
                      borderRadius: "999px",
                      border: "1px solid #E4C7A1",
                      background: "#F5EBDC",
                      fontSize: "0.8rem",
                      cursor: isLoadingRewards ? "wait" : "pointer",
                    }}
                  >
                    {isLoadingRewards ? "Actualisation…" : "Rafraîchir l'historique"}
                  </button>
                </div>

                {rewardsError && (
                  <p style={{ color: "#B91C1C", fontSize: "0.85rem" }}>
                    {rewardsError}
                  </p>
                )}

                {!isLoadingRewards &&
                  rewardHistory.length === 0 &&
                  !rewardsError && (
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "#7C4A2D",
                      }}
                    >
                      Tu n'as pas encore de récompense. Scanne des tickets pour
                      gagner des Couronnes puis utilise-les avec les paliers
                      ci-dessus.
                    </p>
                  )}

                {rewardHistory.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    {rewardHistory.map((reward) => {
                      const createdLabel = formatVerboseDate(
                        reward.createdAt ?? null
                      );
                      const redeemedLabel = formatVerboseDate(
                        reward.redeemedAt ?? null
                      );
                      const qrValue = `reward:${reward.id}`;

                      return (
                        <div
                          key={reward.id}
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "flex-start",
                            padding: "0.75rem 0.9rem",
                            borderRadius: "0.75rem",
                            background: "#FFF4D8",
                            border: "1px solid #F0D5AA",
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <QRCodeCanvas value={qrValue} size={80} />
                          </div>
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "#502314",
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            <p>
                              <strong>{reward.name}</strong>
                              {reward.pointsCost !== null && (
                                <>
                                  {" "}
                                  – {reward.pointsCost} Couronnes
                                </>
                              )}
                            </p>
                            {reward.tier && (
                              <p
                                style={{
                                  marginTop: "0.15rem",
                                  color: "#7C4A2D",
                                  fontSize: "0.8rem",
                                }}
                              >
                                Palier : {reward.tier}
                              </p>
                            )}
                            <p style={{ marginTop: "0.25rem" }}>
                              Créée le :{" "}
                              {createdLabel ?? "Date de création inconnue"}
                            </p>
                            <p style={{ marginTop: "0.25rem" }}>
                              Statut :{" "}
                              {reward.redeemed
                                ? redeemedLabel
                                  ? `Utilisée le ${redeemedLabel}`
                                  : "Utilisée"
                                : "Pas encore utilisée"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Section – Upload ticket */}
        <section
          style={{
            background: "#FFF9ED",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.04)",
            border: "1px solid #F0D5AA",
          }}
        >
          <h2
            style={{
              fontSize: "1.25rem",
              marginBottom: "0.75rem",
              fontWeight: 400,
            }}
          >
            Ajouter un ticket Burger King
          </h2>
          <p style={{ marginBottom: "0.75rem", color: "#7C4A2D" }}>
            Prends en photo ton ticket Burger King Maroc. L'image est envoyée au
            backend pour vérifier qu'il s'agit bien d'un ticket Burger King,
            lire le montant et calculer tes Couronnes.
          </p>

          {/* Boutons caméra + galerie */}
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
                border: `1px dashed ${BK_BLUE}`,
                background: "#F5EBDC",
                cursor: "pointer",
                color: BK_BLUE,
                fontWeight: 500,
              }}
            >
              Prendre une photo avec la caméra
            </button>

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px dashed #E4C7A1",
                background: "#F5EBDC",
                cursor: "pointer",
              }}
            >
              Choisir une photo dans la galerie
            </button>

            {/* input caché */}
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
              color: "#7C4A2D",
            }}
          >
            Assure-toi que les mots &quot;Burger King&quot; ou &quot;BK&quot;,
            le montant total et la date sont bien visibles sur la photo.
          </p>

          {/* Vue caméra */}
          {isCameraOpen && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "#111827",
                color: "#E5E7EB",
              }}
            >
              <p
                style={{
                  marginBottom: "0.5rem",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Vue caméra
              </p>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  maxHeight: "60vh",
                  overflow: "hidden",
                  borderRadius: "0.75rem",
                  background: "#020617",
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
                    color: "#FECACA",
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
                    background: "#22C55E",
                    color: "#022C22",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Prendre la photo
                </button>
                <button
                  type="button"
                  onClick={closeCamera}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "999px",
                    border: "1px solid #6B7280",
                    background: "#020617",
                    color: "#E5E7EB",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Fermer la caméra
                </button>
              </div>
            </div>
          )}

          {/* Aperçu */}
          {previewUrl && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "#FDF2D9",
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
                  Aperçu :
                </p>
                <img
                  src={previewUrl}
                  alt="Ticket sélectionné"
                  style={{
                    maxWidth: "200px",
                    maxHeight: "200px",
                    objectFit: "contain",
                    borderRadius: "0.5rem",
                    border: "1px solid #E5E7EB",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.85rem", color: "#7C4A2D", flex: 1 }}>
                <p>
                  <strong>Fichier :</strong> {selectedFileName}
                </p>
                <p style={{ marginTop: "0.25rem" }}>
                  Si la photo n'est pas claire, tu peux en refaire une avec la
                  caméra ou choisir une autre image dans ta galerie.
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
                      border: "1px solid #D1D5DB",
                      background: "#F5EBDC",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Refaire une photo
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    style={{
                      padding: "0.35rem 0.8rem",
                      borderRadius: "999px",
                      border: "1px solid #D1D5DB",
                      background: "#F5EBDC",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Choisir une autre photo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bouton upload + messages */}
          <button
            onClick={uploadRealReceipt}
            disabled={isUploadingReceipt || !selectedFile}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: selectedFile ? "pointer" : "not-allowed",
              fontWeight: 600,
              background: selectedFile ? BK_BLUE : "#9CA3AF",
              color: "#FFFFFF",
              boxShadow: selectedFile
                ? "0 8px 20px rgba(0, 102, 204, 0.35)"
                : "none",
            }}
          >
            {isUploadingReceipt ? "Envoi en cours…" : "Envoyer ce ticket"}
          </button>

          {lastReceiptError && (
            <p style={{ marginTop: "0.5rem", color: "#B91C1C" }}>
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
