import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const CONFIRM_LOGS = [
  "Connecting to Gumroad secure gateway…",
  "Verifying transaction signature…",
  "Cross-referencing payment ledger…",
  "Stamping registry seal…",
  "Locking resident number…",
  "Sealing holographic layers…",
  "Awaiting confirmation signal…",
  "Encoding citizen biometric data…",
];

type Phase = 'confirming' | 'granted' | 'timeout';

export default function PaymentConfirmingOverlay({ onClear }: { onClear: () => void }) {
  const [phase, setPhase] = useState<Phase>('confirming');
  const [logIndex, setLogIndex] = useState(0);
  const [scanY, setScanY] = useState(0);

  useEffect(() => {
    const raw = localStorage.getItem('solarPendingJob');
    if (!raw) { onClear(); return; }
    let jobId: string;
    try { jobId = JSON.parse(raw).jobId; } catch { localStorage.removeItem('solarPendingJob'); onClear(); return; }
    if (!jobId) { onClear(); return; }

    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (stopped) return;
        if (data.status === 'DONE' && data.public_id) {
          stopped = true;
          localStorage.removeItem('solarPendingJob');
          setPhase('granted');
          setTimeout(() => { window.location.href = `/id/${data.public_id}`; }, 1800);
        }
      } catch { /* network error, retry next interval */ }
    };

    check();
    const interval = setInterval(() => { if (!stopped) check(); }, 5000);
    const giveUp = setTimeout(() => {
      if (!stopped) { stopped = true; clearInterval(interval); setPhase('timeout'); }
    }, 5 * 60 * 1000);

    return () => { stopped = true; clearInterval(interval); clearTimeout(giveUp); };
  }, [onClear]);

  // Cycle log lines
  useEffect(() => {
    if (phase !== 'confirming') return;
    const t = setInterval(() => setLogIndex(i => (i + 1) % CONFIRM_LOGS.length), 2600);
    return () => clearInterval(t);
  }, [phase]);

  // Scan line sweep
  useEffect(() => {
    if (phase !== 'confirming') return;
    let frame: number;
    const tick = () => { setScanY(v => (v + 0.25) % 100); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden select-none"
      style={{ background: "#05050d" }}
    >
      {/* Grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(0,232,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,232,255,0.025) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Scan line */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute left-0 right-0 h-px"
          style={{
            top: `${scanY}%`,
            background: "linear-gradient(90deg, transparent 0%, rgba(0,232,255,0.35) 50%, transparent 100%)",
          }}
        />
      </div>

      {/* Ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-1000"
        style={{
          background: phase === 'granted'
            ? "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,255,127,0.1) 0%, transparent 70%)"
            : "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,232,255,0.06) 0%, transparent 70%)",
        }}
      />

      <AnimatePresence mode="wait">
        {phase === 'confirming' && (
          <motion.div
            key="confirming"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center px-6 max-w-sm w-full"
          >
            {/* Concentric rings */}
            <div className="relative w-36 h-36 flex items-center justify-center mb-10">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border"
                  style={{
                    width: `${100 - i * 24}%`,
                    height: `${100 - i * 24}%`,
                    borderColor: `rgba(0,232,255,${0.28 - i * 0.07})`,
                    boxShadow: `0 0 ${14 - i * 3}px rgba(0,232,255,${0.18 - i * 0.04})`,
                  }}
                  animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
                  transition={{ duration: 8 + i * 5, repeat: Infinity, ease: "linear" }}
                />
              ))}
              <motion.span
                animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                className="font-mono text-5xl relative z-10"
                style={{ color: "#00e8ff", textShadow: "0 0 24px rgba(0,232,255,0.7)", lineHeight: 1 }}
              >
                ◈
              </motion.span>
            </div>

            <h2
              className="font-black tracking-[0.22em] text-center mb-1"
              style={{ fontSize: "clamp(1.1rem, 5vw, 1.35rem)", color: "#00e8ff", textShadow: "0 0 22px rgba(0,232,255,0.45)" }}
            >
              AWAITING PAYMENT
            </h2>
            <p className="font-mono text-[10px] tracking-[0.3em] text-white/28 mb-8 text-center uppercase">
              Confirming with Gumroad
            </p>

            {/* Terminal log */}
            <div
              className="w-full rounded-xl p-4 mb-6"
              style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(0,232,255,0.09)" }}
            >
              <div className="flex items-center space-x-1.5 mb-3">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#00e8ff", animation: "blink 1.2s step-end infinite" }} />
                <span className="font-mono text-[8px] text-white/18 tracking-widest uppercase">Solara City Registry Log</span>
              </div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={logIndex}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="font-mono text-[10px] tracking-wide"
                  style={{ color: "rgba(0,232,255,0.5)" }}
                >
                  <span style={{ color: "rgba(0,232,255,0.3)" }}>▶</span> {CONFIRM_LOGS[logIndex]}
                </motion.p>
              </AnimatePresence>
            </div>

            <p className="font-mono text-[9px] text-white/18 text-center tracking-wide leading-relaxed">
              You can safely close this page —<br />your card will be here when you return
            </p>
          </motion.div>
        )}

        {phase === 'granted' && (
          <motion.div
            key="granted"
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, type: "spring", stiffness: 180 }}
            className="flex flex-col items-center px-6"
          >
            {/* Check circle */}
            <div className="relative w-28 h-28 flex items-center justify-center mb-8">
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(0,255,127,0.12)", border: "2px solid rgba(0,255,127,0.55)", boxShadow: "0 0 50px rgba(0,255,127,0.35)" }}
                animate={{ scale: [1, 1.18, 1], opacity: [1, 0.55, 1] }}
                transition={{ duration: 0.9, repeat: 2 }}
              />
              <svg
                className="w-12 h-12 relative z-10"
                style={{ color: "#00ff7f", filter: "drop-shadow(0 0 14px rgba(0,255,127,0.85))" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <motion.h2
              className="font-black tracking-[0.25em] text-center mb-3"
              style={{ fontSize: "clamp(1.5rem, 6vw, 2.2rem)", color: "#00ff7f", textShadow: "0 0 35px rgba(0,255,127,0.55)" }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              ACCESS GRANTED
            </motion.h2>
            <motion.p
              className="font-mono text-[10px] text-white/28 tracking-[0.3em] uppercase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
            >
              Redirecting to your card…
            </motion.p>
          </motion.div>
        )}

        {phase === 'timeout' && (
          <motion.div
            key="timeout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center px-6 max-w-sm w-full text-center"
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-6 text-2xl"
              style={{ background: "rgba(255,196,74,0.08)", border: "1px solid rgba(255,196,74,0.25)" }}
            >
              ⏳
            </div>

            <h2 className="font-black tracking-widest mb-3 text-[1.1rem]" style={{ color: "#ffc94a" }}>
              TAKING LONGER THAN EXPECTED
            </h2>
            <p className="font-mono text-[10px] text-white/35 mb-6 leading-relaxed">
              Your payment was received by Gumroad. We're still waiting on confirmation from our system — this can happen if the payment verification is delayed.
            </p>

            <div
              className="rounded-xl p-4 w-full mb-5 text-left"
              style={{ background: "rgba(255,196,74,0.04)", border: "1px solid rgba(255,196,74,0.13)" }}
            >
              <p className="font-mono text-[9px] text-white/35 mb-1.5 uppercase tracking-widest">Contact us with your Gumroad Order ID:</p>
              <p className="font-mono text-[11px] font-bold" style={{ color: "#ffc94a" }}>kishanbro8@gmail.com</p>
            </div>

            <p className="font-mono text-[9px] text-white/20 mb-6 leading-relaxed">
              Or simply return to this page later — your card will appear automatically once confirmed.
            </p>

            <button
              onClick={onClear}
              className="font-mono text-[9px] tracking-widest text-white/20 hover:text-white/40 uppercase transition-colors underline"
            >
              ← Return to homepage
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
