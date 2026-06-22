import { useState, useEffect, useMemo } from "react";
import { Routes, Route, useNavigate, Link } from "react-router-dom";
import { motion } from "motion/react";
import UploadStep from "./components/UploadStep";
import PreviewStep from "./components/PreviewStep";
import { RenderStep } from "./components/RenderSteps";
import InteractiveCard from "./components/InteractiveCard";
import LandingPage from "./pages/LandingPage";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

type AppState = "UPLOAD" | "PREVIEW" | "RENDERING" | "SUCCESS";

/* Floating ambient particles — stable positions via useMemo */
function ParticleField() {
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        x: (i * 5.7 + 3) % 100,
        delay: (i * 0.8) % 9,
        duration: 12 + (i % 7) * 2,
        size: 1 + (i % 3) * 0.8,
        opacity: 0.25 + (i % 4) * 0.1,
      })),
    []
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            bottom: "-6px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.id % 3 === 0 ? "#00e8ff" : p.id % 3 === 1 ? "#ff0088" : "#9b59ff",
            opacity: p.opacity,
            animation: `float-particle ${p.duration}s ${p.delay}s infinite linear`,
          }}
        />
      ))}
    </div>
  );
}

function MainFlow() {
  const [appState, setAppState] = useState<AppState>("UPLOAD");
  const [jobId, setJobId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [playerNumber, setPlayerNumber] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (jobId && appState !== "SUCCESS") {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (res.ok) {
            const data = await res.json();

            if (appState === "UPLOAD" && data.preview_url) {
              setPreviewUrl(data.preview_url);
              setAppState("PREVIEW");
              setIsUploading(false);
            }

            if ((appState === "PREVIEW" || appState === "RENDERING") && (data.status === "DONE" || data.layers_ready)) {
              setAppState("SUCCESS");
              clearInterval(interval);
            } else if (data.status === "FAILED") {
              setError("Render failed. In a real app you would be refunded.");
              setAppState("UPLOAD");
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [appState, jobId]);

  const handleUpload = async (formData: FormData) => {
    setIsUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setJobId(data.jobId);
      if (data.playerNumber) setPlayerNumber(data.playerNumber);

      // Check once immediately — preview might already be ready
      const pollRes = await fetch(`/api/jobs/${data.jobId}`);
      const pollData = await pollRes.json();
      if (pollData.player_number) setPlayerNumber(pollData.player_number);
      if (pollData.preview_url) {
        setPreviewUrl(pollData.preview_url);
        setAppState("PREVIEW");
        setIsUploading(false);
      }
      // If preview not ready yet, keep isUploading=true — the polling
      // interval (which now runs in UPLOAD state) will clear it when preview arrives
    } catch (err: any) {
      setError(err.message);
      setIsUploading(false);
    }
  };

  const handlePayBypass = async (currentJobId: string) => {
    setIsProcessingPayment(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      setAppState("RENDERING");
    } catch (err: any) {
      alert("Payment Error: " + err.message);
      setAppState("UPLOAD");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col pt-12 pb-24 px-4 relative">
      {/* Back to landing */}
      <div className="absolute top-4 left-4 z-20">
        <Link to="/" className="font-mono text-[9px] tracking-widest text-white/20 hover:text-white/50 transition-colors uppercase">
          ← Solara City
        </Link>
      </div>
      <ParticleField />

      {appState === "UPLOAD" && (
        <UploadStep onUpload={handleUpload} isUploading={isUploading} uploadError={error} />
      )}

      {appState === "PREVIEW" && previewUrl && jobId && (
        <PreviewStep
          jobId={jobId}
          previewUrl={previewUrl}
          onPay={() => handlePayBypass(jobId)}
          isProcessingPayment={isProcessingPayment}
          playerNumber={playerNumber}
        />
      )}

      {appState === "RENDERING" && jobId && <RenderStep jobId={jobId} />}

      {appState === "SUCCESS" && jobId && (
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, type: "spring", stiffness: 160 }}
          className="max-w-md w-full mx-auto relative z-10"
        >
          <div className="rgb-border-wrap rounded-[18px]">
            <div className="skeuo-panel rounded-[17px] p-8 text-center">

              {/* Animated success icon */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 220 }}
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                style={{
                  background: "linear-gradient(135deg, #001e10 0%, #00120a 100%)",
                  boxShadow: "inset 0 2px 8px rgba(0,0,0,0.85), 0 0 28px rgba(0,255,127,0.22), 0 0 0 1px rgba(0,255,127,0.15)",
                }}
              >
                <svg className="w-8 h-8" style={{ color: "#00ff7f", filter: "drop-shadow(0 0 8px rgba(0,255,127,0.6))" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>

              <h2
                className="text-2xl font-black tracking-[0.22em] mb-1"
                style={{ color: "#00ff7f", textShadow: "0 0 16px rgba(0,255,127,0.3)" }}
              >
                ACCESS GRANTED
              </h2>
              {playerNumber && (
                <p
                  className="font-mono text-[11px] font-bold tracking-[0.3em] mb-1"
                  style={{ color: "#ff6b1a", textShadow: "0 0 8px rgba(255,107,26,0.4)" }}
                >
                  RESIDENT #{playerNumber.toString().padStart(4, "0")} REGISTERED
                </p>
              )}
              <p className="font-mono text-[10px] text-white/25 tracking-widest mb-7 uppercase">
                Your Solara City Resident ID has been issued &amp; sealed
              </p>

              <div className="space-y-3">
                <motion.button
                  onClick={() => navigate(`/card/${jobId}`)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="skeuo-btn w-full rounded-xl py-4 font-black tracking-[0.2em] text-sm relative overflow-hidden group"
                  style={{ border: "1px solid rgba(0,232,255,0.18)" }}
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(0,232,255,0.08) 0%, rgba(155,89,255,0.06) 100%)" }} />
                  <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-0 group-hover:opacity-100">
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(0,232,255,0.06), transparent)", animation: "shimmer-sweep 2.5s ease-in-out infinite" }} />
                  </div>
                  <span className="relative z-10 flex items-center justify-center space-x-2" style={{ color: "#00e8ff", textShadow: "0 0 10px rgba(0,232,255,0.35)" }}>
                    <span>VIEW HOLOGRAPHIC ID</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </span>
                </motion.button>

                <button
                  onClick={() => {
                    const cardNum = playerNumber ? `#${playerNumber.toString().padStart(4, "0")}` : "";
                    const url = `${window.location.origin}/card/${jobId}`;
                    const caption = cardNum
                      ? `Just got my Solara City Resident ID ${cardNum} 🌆 Get yours: ${url}`
                      : `Just got my Solara City Resident ID 🌆 Get yours: ${url}`;
                    navigator.clipboard.writeText(caption);
                  }}
                  className="skeuo-btn w-full rounded-xl py-3 font-mono text-xs tracking-widest text-white/35"
                >
                  COPY SHARE CAPTION
                </button>
              </div>

            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/create" element={<MainFlow />} />
      <Route path="/card/:id" element={<InteractiveCard />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
    </Routes>
  );
}
