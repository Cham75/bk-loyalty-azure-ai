import { useState } from "react";

interface ValidateResponse {
  valid: boolean;
  rewardName?: string;
  userId?: string;
  reason?: string;
}

function App() {
  const [rewardCode, setRewardCode] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const validateReward = async () => {
    const trimmed = rewardCode.trim();
    if (!trimmed) {
      setResult("Please enter a reward code.");
      return;
    }

    try {
      setIsChecking(true);
      setResult(null);

      const res = await fetch("/api/validate-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: trimmed }),
      });

      const data = (await res.json()) as ValidateResponse;

      if (res.ok && data.valid) {
        setResult(
          `✅ VALID – Reward: ${data.rewardName}. Apply the benefit and mark as used.`
        );
      } else {
        const reason = data.reason || "INVALID";
        setResult(`❌ Not valid (${reason}).`);
      }
    } catch (err) {
      console.error(err);
      setResult("Error contacting API.");
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <main
        style={{
          maxWidth: 600,
          margin: "0 auto",
          padding: "2rem 1.5rem 3rem",
        }}
      >
        <h1 style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>
          BK Loyalty – Staff
        </h1>
        <p style={{ marginBottom: "1.5rem", color: "#9ca3af" }}>
          Type or scan the reward code from the customer&apos;s QR and validate
          it. The reward will be marked as used in the backend.
        </p>

        <section
          style={{
            background: "#020617",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
            }}
          >
            Reward code
          </label>
          <input
            value={rewardCode}
            onChange={(e) => setRewardCode(e.target.value)}
            placeholder="Scan or paste reward ID"
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid #4b5563",
              marginBottom: "0.75rem",
              background: "#020617",
              color: "#e5e7eb",
            }}
          />

          <button
            onClick={validateReward}
            disabled={isChecking}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              background: "#22c55e",
              color: "#022c22",
            }}
          >
            {isChecking ? "Checking..." : "Validate reward"}
          </button>

          {result && (
            <p style={{ marginTop: "1rem", fontSize: "0.95rem" }}>{result}</p>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
