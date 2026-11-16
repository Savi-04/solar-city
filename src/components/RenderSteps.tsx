import React, { useEffect, useState } from "react";
import { Download, Copy, Link, CheckCircle2, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const RENDER_LOGS = [
  "Awaiting payment confirmation…",
  "Verifying transaction with Gumroad…",
  "Stamping registry seal…",
  "Assigning case number…",
  "Sealing holographic layers…",
  "Engraving player number…",
  "Finalizing holographic output…",
];

export function RenderStep({ jobId: _jobId }: { jobId: string }) {
  const [progress, setProgress] = useState(0);
  const [logIndex, setLogIndex] = useState(0);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 4.5, 85));
    }, 2000);
    const logInterval = setInterval(() => {
      setLogIndex((i) => (i + 1) % RENDER_LOGS.length);
    }, 2800);
    return () => {
      clearInterval(progressInterval);
      clearInterval(logInterval);
    };
  }, []);

  const progressGradient =
    progress < 35
      ? "linear-gradient(90deg, #ff2060, #9b59ff)"
      : progress < 70
      ? "linear-gradient(90deg, #9b59ff, #ffb83c)"
      : "linear-gradient(90deg, #ffb83c, #00ff7f)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="max-w-md w-full mx-auto relative z-10"
    >
      <div className="rgb-border-wrap rounded-[18px]">
        <div className="skeuo-panel rounded-[17px] p-8">

          {/* Spinning CPU icon */}
          <div className="flex justify-center mb-7">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #1a0c14 0%, #100710 100%)",
                boxShadow: "inset 0 2px 8px rgba(0,0,0,0.85), 0 0 24px rgba(255,32,96,0.18), 0 0 0 1px rgba(255,32,96,0.12)",
              }}
            >
              <Cpu className="w-7 h-7 text-[#ff2060]" style={{ filter: "drop-shadow(0 0 6px rgba(255,32,96,0.7))" }} />
            </motion.div>
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h2
              className="text-xl font-black tracking-[0.22em] text-transparent bg-clip-text glitch-text"
              style={{ backgroundImage: "linear-gradient(90deg, #ff2060, #ffb83c)" }}
            >
              CONFIRMING PAYMENT
            </h2>

            <AnimatePresence mode="wait">
              <motion.p
                key={logIndex}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.3 }}
                className="font-mono text-[10px] text-white/28 mt-2.5 tracking-widest"
              >
                <span className="text-[#ff2060]/60">▶</span> {RENDER_LOGS[logIndex]}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Progress bar */}
          <div
            className="relative h-3 rounded-full overflow-hidden mb-3"
            style={{ background: "#060810", boxShadow: "inset 0 2px 6px rgba(0,0,0,0.85)" }}
          >
            <motion.div
              className="absolute top-0 left-0 h-full rounded-full relative overflow-hidden"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={{ background: progressGradient }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 50%, transparent 100%)",
                  animation: "shimmer-sweep 1.8s ease-in-out infinite",
                }}
              />
            </motion.div>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-white/22 tracking-widest">{Math.floor(progress)}% COMPILED</span>
            <span className="font-mono text-[10px] text-white/20 tracking-widest">ETA ~1–2 MIN</span>
          </div>

          {/* Terminal log mini panel */}
          <div
            className="mt-5 rounded-lg p-3"
            style={{
              background: "#060810",
              boxShadow: "inset 0 2px 6px rgba(0,0,0,0.75)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div className="flex items-center space-x-1.5 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff2060]" style={{ animation: "blink 1.2s step-end infinite" }} />
              <span className="font-mono text-[8px] text-white/18 tracking-widest uppercase">Sunfall City Registry Log</span>
            </div>
            {RENDER_LOGS.slice(0, logIndex + 1)
              .slice(-3)
              .map((log, i) => (
                <p key={i} className={`font-mono text-[9px] tracking-wide ${i === Math.min(logIndex, 2) ? "text-[#ff2060]/70" : "text-white/18"}`}>
                  {">"} {log}
                </p>
              ))}
          </div>

        </div>
      </div>
    </motion.div>
  );
}

export function SuccessStep({ outputUrl, playerNumber, jobId }: { outputUrl: string; playerNumber?: number | null; jobId?: string }) {
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const isCardImage = outputUrl.includes("/card");
  const downloadUrl = isCardImage ? outputUrl : `${outputUrl}&download=true`;
  const downloadName = isCardImage ? "Neon_ID_Card.png" : "Neon_ID.mp4";
  const cardNum = playerNumber ? `#${playerNumber.toString().padStart(4, "0")}` : "";
  const shareUrl = jobId ? `${window.location.origin}/card/${jobId}` : window.location.origin;

  const handleCopyCaption = () => {
    const caption = cardNum
      ? `I'm WANTED in Sunfall City ${cardNum} 🌴 Get your bounty: ${shareUrl}`
      : `I'm WANTED in Sunfall City 🌴 Get your bounty: ${shareUrl}`;
    navigator.clipboard.writeText(caption);
    setCopiedCaption(true);
    setTimeout(() => setCopiedCaption(false), 2200);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.55, type: "spring", stiffness: 160 }}
      className="max-w-md w-full mx-auto relative z-10"
    >
      <div className="rgb-border-wrap rounded-[18px]">
        <div className="skeuo-panel rounded-[17px] p-6 flex flex-col items-center">

          {/* Success badge */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 220 }}
            className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
            style={{
              background: "linear-gradient(135deg, #001e10 0%, #001408 100%)",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.85), 0 0 28px rgba(0,255,127,0.2), 0 0 0 1px rgba(0,255,127,0.14)",
            }}
          >
            <CheckCircle2 className="w-8 h-8 text-[#00ff7f]" style={{ filter: "drop-shadow(0 0 8px rgba(0,255,127,0.6))" }} />
          </motion.div>

          <h2
            className="text-xl font-black tracking-[0.22em] mb-1"
            style={{ color: "#00ff7f", textShadow: "0 0 14px rgba(0,255,127,0.35)" }}
          >
            ACCESS GRANTED
          </h2>
          {playerNumber && (
            <p
              className="font-mono text-[11px] font-bold tracking-[0.3em] mb-1"
              style={{ color: "#ff2060", textShadow: "0 0 8px rgba(255,32,96,0.4)" }}
            >
              PLAYER {cardNum} REGISTERED
            </p>
          )}
          <p className="font-mono text-[9px] text-white/22 tracking-widest mb-6 uppercase">
            Holographic ID forged &amp; sealed
          </p>

          {/* Media preview */}
          <div
            className="relative w-3/4 aspect-[2/3] rounded-xl overflow-hidden mb-2 scanlines"
            style={{
              boxShadow: "0 0 30px rgba(0,255,127,0.1), 0 0 0 1px rgba(0,255,127,0.1)",
              border: "1px solid rgba(0,255,127,0.12)",
            }}
          >
            {isCardImage ? (
              <img src={outputUrl} alt="Your Neon ID Card" className="w-full h-full object-cover" />
            ) : (
              <video src={outputUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline controls />
            )}
          </div>

          <p className="font-mono text-[8px] text-white/18 mb-5 tracking-widest uppercase">
            {isCardImage ? "⚠ HD Card Image (Veo unavailable)" : "✦ AI-Generated Holographic Video"}
          </p>

          {/* Action buttons */}
          <div className="space-y-3 w-full">
            {/* Download */}
            <a
              href={downloadUrl}
              download={downloadName}
              className="w-full flex items-center justify-center space-x-2 rounded-xl py-3 font-black tracking-[0.16em] text-sm relative overflow-hidden group transition-shadow"
              style={{
                background: "linear-gradient(180deg, #142218 0%, #0a150e 100%)",
                border: "1px solid rgba(0,255,127,0.2)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 16px rgba(0,255,127,0.06), 0 4px 12px rgba(0,0,0,0.5)",
              }}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,255,127,0.05)" }} />
              <div className="absolute inset-0 overflow-hidden opacity-0 group-hover:opacity-100">
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(0,255,127,0.06), transparent)", animation: "shimmer-sweep 2s ease-in-out infinite" }} />
              </div>
              <Download className="w-4 h-4 relative z-10" style={{ color: "#00ff7f" }} />
              <span className="relative z-10" style={{ color: "#00ff7f" }}>
                {isCardImage ? "DOWNLOAD CARD" : "DOWNLOAD MP4"}
              </span>
            </a>

            {/* Copy TikTok caption */}
            <button
              onClick={handleCopyCaption}
              className="skeuo-btn w-full flex items-center justify-center space-x-2 rounded-xl py-3 font-mono text-xs tracking-widest text-white/40 relative overflow-hidden group"
            >
              <AnimatePresence mode="wait">
                {copiedCaption ? (
                  <motion.span key="copied" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-[#00ff7f]" />
                    <span className="text-[#00ff7f]">CAPTION COPIED!</span>
                  </motion.span>
                ) : (
                  <motion.span key="copy" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center space-x-2">
                    <Copy className="w-4 h-4" />
                    <span>COPY IG / TIKTOK CAPTION</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            {/* Copy card link */}
            <button
              onClick={handleCopyLink}
              className="skeuo-btn w-full flex items-center justify-center space-x-2 rounded-xl py-3 font-mono text-xs tracking-widest text-white/40 relative overflow-hidden group"
            >
              <AnimatePresence mode="wait">
                {copiedLink ? (
                  <motion.span key="linked" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-[#00e8ff]" />
                    <span className="text-[#00e8ff]">LINK COPIED!</span>
                  </motion.span>
                ) : (
                  <motion.span key="link" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center space-x-2">
                    <Link className="w-4 h-4" />
                    <span>COPY CARD LINK</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
