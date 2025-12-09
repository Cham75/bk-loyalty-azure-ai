import React, { useEffect, useRef, useState } from "react";

type UploadResponse = {
  userId: string;
  amount: number;
  pointsEarned: number;
  newBalance: number;
  receiptId: string;
  receiptBlobUrl: string;
  receiptDate?: string;
  merchantName?: string;
};

type ErrorResponse = {
  error?: string;
  message?: string;
  [key: string]: unknown;
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const App: React.FC = () => {
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadBalance = async () => {
      try {
        setLoadingBalance(true);
        const res = await fetch("/api/get-user-balance");
        if (!res.ok) {
          setBalance(null);
          return;
        }
        const data = await res.json();
        setBalance(typeof data.points === "number" ? data.points : null);
      } catch {
        setBalance(null);
      } finally {
        setLoadingBalance(false);
      }
    };

    loadBalance();
  }, []);

  const resetSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  const handleCameraClick = () => {
    resetSelection();
    cameraInputRef.current?.click();
  };

  const handleGalleryClick = () => {
    resetSelection();
    galleryInputRef.current?.click();
  };

  const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const fileBase64 = await fileToBase64(selectedFile);

      const res = await fetch("/api/upload-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType: selectedFile.type || "image/jpeg",
          fileBase64,
        }),
      });

      const data: UploadResponse | ErrorResponse = await res.json();

      if (!res.ok) {
        const errMsg =
          (data as ErrorResponse).message ||
          "The receipt could not be processed. Please try again.";
        setErrorMessage(errMsg);
        return;
      }

      const ok = data as UploadResponse;

      setBalance(ok.newBalance);

      const dateStr = formatDate(ok.receiptDate);
      const amountStr = ok.amount.toFixed(2);

      const msg = dateStr
        ? `Your receipt of ${amountStr} € dated ${dateStr} has been scanned. You earned ${ok.pointsEarned} points.`
        : `Your receipt of ${amountStr} € has been scanned. You earned ${ok.pointsEarned} points.`;

      setSuccessMessage(msg);
      resetSelection();
    } catch (e) {
      console.error(e);
      setErrorMessage("Unexpected error, please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetake = () => {
    resetSelection();
  };

  return (
    <div
      style={{
        maxWidth: "480px",
        margin: "0 auto",
        padding: "1.5rem",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.5rem" }}>BK Loyalty</h1>

      <p style={{ marginBottom: "1.5rem", color: "#555" }}>
        {loadingBalance
          ? "Loading your points..."
          : balance !== null
          ? `You have ${balance} points.`
          : "Sign in to see your points."}
      </p>

      <section
        style={{
          border: "1px solid #eee",
          borderRadius: "0.75rem",
          padding: "1rem",
          marginBottom: "1rem",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
          Upload your receipt
        </h2>

        {/* Hidden inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={onFileSelected}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onFileSelected}
        />

        {/* Buttons */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <button
            type="button"
            onClick={handleCameraClick}
            style={{
              flex: 1,
              padding: "0.6rem 0.8rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              background: "#f97316",
              color: "white",
            }}
          >
            Take a photo
          </button>
          <button
            type="button"
            onClick={handleGalleryClick}
            style={{
              flex: 1,
              padding: "0.6rem 0.8rem",
              borderRadius: "999px",
              border: "1px solid #ddd",
              cursor: "pointer",
              fontWeight: 500,
              background: "#fff",
            }}
          >
            Choose from gallery
          </button>
        </div>

        {/* Note below the buttons */}
        <p
          style={{
            fontStyle: "italic",
            fontSize: "0.9rem",
            color: "#666",
            marginBottom: "0.75rem",
          }}
        >
          Please make sure that the words “Burger King”, the amount and the date of
          the receipt are clearly visible in the photo.
        </p>

        {/* Preview + confirm / retake */}
        {previewUrl && (
          <div
            style={{
              marginTop: "0.5rem",
              borderRadius: "0.75rem",
              border: "1px solid #eee",
              padding: "0.5rem",
            }}
          >
            <img
              src={previewUrl}
              alt="Receipt preview"
              style={{
                maxWidth: "100%",
                borderRadius: "0.5rem",
                marginBottom: "0.5rem",
              }}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "999px",
                  border: "none",
                  cursor: "pointer",
                  background: isUploading ? "#fbbf24" : "#22c55e",
                  color: "white",
                  fontWeight: 600,
                }}
              >
                {isUploading ? "Uploading..." : "Confirm upload"}
              </button>
              <button
                type="button"
                onClick={handleRetake}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "999px",
                  border: "1px solid #ddd",
                  cursor: "pointer",
                  background: "#fff",
                }}
              >
                Retake
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        {successMessage && (
          <p
            style={{
              marginTop: "0.75rem",
              color: "#16a34a",
              fontSize: "0.95rem",
            }}
          >
            {successMessage}
          </p>
        )}

        {errorMessage && (
          <p
            style={{
              marginTop: "0.75rem",
              color: "#dc2626",
              fontSize: "0.95rem",
            }}
          >
            {errorMessage}
          </p>
        )}
      </section>
    </div>
  );
};

export default App;
