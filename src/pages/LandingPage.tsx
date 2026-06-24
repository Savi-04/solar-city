import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Zap, ArrowRight, Upload, Cpu, Download, ExternalLink } from "lucide-react";
import InteractiveCard from "../components/InteractiveCard";
import { useCurrencyPrice } from "../hooks/useCurrencyPrice";

/* ── Floating particles (shared with MainFlow) ── */
function ParticleField() {
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        x: (i * 4.6 + 2) % 100,
        delay: (i * 0.7) % 10,
        duration: 14 + (i % 6) * 2,
        size: 1 + (i % 3) * 0.7,
        opacity: 0.2 + (i % 4) * 0.1,
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

/* ── Live registry counter ── */
function RegistryCounter({ onSoldOut }: { onSoldOut?: (v: boolean) => void }) {
  const [data, setData] = useState<{ issued: number; remaining: number } | null>(null);

  useEffect(() => {
    fetch("/api/registry/count")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.remaining <= 0) onSoldOut?.(true);
      })
      .catch(() => {});
  }, [onSoldOut]);

  return (
    <AnimatePresence mode="wait">
      {data !== null && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center space-x-2 rounded-full px-4 py-1.5"
          style={{
            background: data.remaining <= 0 ? "rgba(255,80,80,0.08)" : "rgba(255,32,96,0.06)",
            border: `1px solid ${data.remaining <= 0 ? "rgba(255,80,80,0.3)" : "rgba(255,32,96,0.18)"}`,
            boxShadow: "0 0 14px rgba(255,32,96,0.07)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: data.remaining <= 0 ? "#ff4444" : "#ff2060",
              animation: "pulse-pink 1.5s ease-in-out infinite",
            }}
          />
          {data.remaining <= 0 ? (
            <span className="font-mono text-[10px] tracking-widest" style={{ color: "rgba(255,100,100,0.9)" }}>
              🔴 <strong className="text-white/75">SOLD OUT</strong> · All 2,000 cards issued
            </span>
          ) : (
            <span className="font-mono text-[10px] tracking-widest" style={{ color: "rgba(255,130,150,0.9)" }}>
              🔥 <strong className="text-white/75">{data.issued.toLocaleString()}</strong> of 2,000 cards claimed
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── How it works step ── */
function Step({
  num,
  icon,
  title,
  desc,
  delay,
}: {
  num: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className="flex flex-col items-center text-center space-y-3"
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center relative"
        style={{
          background: "linear-gradient(135deg, #0f1220 0%, #080a14 100%)",
          boxShadow: "inset 0 2px 8px rgba(0,0,0,0.8), 0 0 18px rgba(0,232,255,0.08)",
          border: "1px solid rgba(0,232,255,0.12)",
        }}
      >
        {icon}
        <span
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center font-mono text-[9px] font-bold"
          style={{ background: "#ff2060", color: "white" }}
        >
          {num}
        </span>
      </div>
      <h3 className="font-bold text-sm text-white/85 tracking-wide">{title}</h3>
      <p className="font-mono text-[11px] text-white/35 leading-relaxed">{desc}</p>
    </motion.div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [demoReady, setDemoReady] = useState(false);
  const [soldOut, setSoldOut] = useState(false);
  const localPrice = useCurrencyPrice();

  // Check if demo card layers are ready
  useEffect(() => {
    let tries = 0;
    const check = async () => {
      try {
        const res = await fetch("/api/jobs/demo-card-v7/layers");
        if (res.ok) { setDemoReady(true); return; }
      } catch { /* */ }
      if (++tries < 10) setTimeout(check, 1500);
    };
    check();
  }, []);

  return (
    <div className="min-h-screen relative" style={{ background: "#05050d" }}>
      <ParticleField />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 flex flex-col items-center justify-start pt-16 pb-8 px-4">

        {/* Wordmark */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <div className="flex items-center space-x-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#ff6b1a]" style={{ boxShadow: "0 0 5px #ff6b1a" }} />
            <span className="font-mono text-[9px] tracking-[0.4em] text-white/30 uppercase">Solara City Bureau of Residents</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#00c6d4]" style={{ boxShadow: "0 0 5px #00c6d4" }} />
          </div>
        </motion.div>

        {/* Main headline + demo card — side by side on desktop, stacked on mobile */}
        <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center lg:items-start gap-10 lg:gap-16">

          {/* Left: copy */}
          <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left lg:pt-10">
            <RegistryCounter onSoldOut={setSoldOut} />

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="mt-5 font-black leading-[1.05] tracking-tight"
              style={{ fontSize: "clamp(2.2rem, 6vw, 3.8rem)", color: "#f0eaff" }}
            >
              Your face.{" "}
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg, #ff2060 0%, #ff8c00 50%, #ffdd00 100%)" }}
              >
                Neon city.
              </span>
              <br />A card that{" "}
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg, #00e8ff 0%, #9b59ff 100%)" }}
              >
                moves.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mt-5 font-mono text-[13px] text-white/42 leading-relaxed max-w-sm lg:max-w-none"
            >
              Upload a selfie. Get your numbered holographic player card in Miami neon style.
              Share the flex — less than a coffee.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="mt-7 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto"
            >
              <button
                onClick={() => !soldOut && navigate("/create")}
                disabled={soldOut}
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 rounded-xl px-8 py-4 font-black tracking-[0.18em] text-[14px] relative overflow-hidden group transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(180deg, #1e0a16 0%, #130610 100%)",
                  border: "1px solid rgba(255,32,96,0.35)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), 0 0 28px rgba(255,32,96,0.12), 0 4px 16px rgba(0,0,0,0.6)",
                }}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "linear-gradient(135deg, rgba(255,32,96,0.1), rgba(155,89,255,0.07))" }} />
                <div className="absolute inset-0 overflow-hidden opacity-0 group-hover:opacity-100">
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,32,96,0.08), transparent)", animation: "shimmer-sweep 2.5s ease-in-out infinite" }} />
                </div>
                <Zap className="w-4 h-4 relative z-10" style={{ color: "#ff2060", filter: "drop-shadow(0 0 4px rgba(255,32,96,0.6))" }} />
                <span className="relative z-10" style={{ color: "#ff2060" }}>{soldOut ? "SOLD OUT" : "Make Your Card"}</span>
                {!soldOut && <ArrowRight className="w-4 h-4 relative z-10" style={{ color: "#ff2060" }} />}
              </button>

              <div className="flex items-center space-x-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#00ff7f]" style={{ boxShadow: "0 0 5px #00ff7f" }} />
                <span className="font-mono text-[10px] text-white/28 tracking-widest">{localPrice} · no account needed</span>
              </div>
            </motion.div>

            {/* Trust row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 flex items-center space-x-4 flex-wrap gap-y-2 justify-center lg:justify-start"
            >
              {["🔒 Gumroad checkout", "⚡ ~2 min delivery", "🗑 No selfie stored"].map((t) => (
                <span key={t} className="font-mono text-[9px] text-white/22 tracking-widest">{t}</span>
              ))}
            </motion.div>
          </div>

          {/* Right: demo card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.65, ease: "easeOut" }}
            className="relative shrink-0"
          >
            {/* Ambient glow behind card */}
            <div
              className="absolute inset-0 rounded-3xl blur-[60px] pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 50% 50%, rgba(255,32,96,0.18) 0%, rgba(0,232,255,0.08) 60%, transparent 100%)",
                transform: "scale(1.4)",
              }}
            />

            <div
              className="relative w-[260px] sm:w-[300px] lg:w-[340px] aspect-[3/4] rounded-2xl overflow-hidden"
              style={{
                boxShadow: "0 0 60px rgba(255,107,26,0.12), 0 0 0 1px rgba(255,107,26,0.1)",
              }}
            >
              {demoReady ? (
                <InteractiveCard jobId="demo-card-v7" standalone={false} autoAnimate={true} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center space-y-3" style={{ background: "#08050f" }}>
                  <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,32,96,0.5)", borderTopColor: "transparent" }} />
                  <p className="font-mono text-[9px] tracking-widest text-white/20 uppercase">Loading demo…</p>
                </div>
              )}

              {/* "Demo" badge */}
              <div
                className="absolute top-3 left-3 flex items-center space-x-1.5 rounded-md px-2 py-1"
                style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)" }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[#00e8ff]" style={{ animation: "pulse-cyan 2s ease-in-out infinite" }} />
                <span className="font-mono text-[8px] text-white/40 tracking-widest">DEMO · HOVER TO TILT</span>
              </div>
            </div>

            <p className="font-mono text-[9px] text-white/18 text-center mt-3 tracking-[0.35em] uppercase">
              ◆ Your card looks like this ◆
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <section className="relative z-10 py-20 px-4">
        <div className="max-w-3xl mx-auto">

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="font-mono text-[9px] tracking-[0.4em] text-white/25 uppercase mb-2">How it works</p>
            <h2 className="text-2xl font-black text-white/85 tracking-tight">Three steps to your card</h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <Step
              num="1"
              icon={<Upload className="w-5 h-5 text-[#00e8ff]" />}
              title="Upload your photo"
              desc="Pick a clear selfie. Your photo is processed in memory — never stored on our servers."
              delay={0}
            />
            <Step
              num="2"
              icon={<Cpu className="w-5 h-5 text-[#ff2060]" />}
              title="AI stylizes your portrait"
              desc="AI transforms your face into a neon-noir painting in Solara City style. Takes about 30 seconds."
              delay={0.1}
            />
            <Step
              num="3"
              icon={<Download className="w-5 h-5 text-[#9b59ff]" />}
              title="Download and share"
              desc="Get your HD interactive card + permanent shareable link. Pay once, yours forever."
              delay={0.2}
            />
          </div>
        </div>
      </section>

      {/* ── PRICE CALLOUT ─────────────────────────────────────────────── */}
      <section className="relative z-10 py-16 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-md mx-auto text-center"
        >
          <div
            className="rounded-2xl p-8"
            style={{
              background: "linear-gradient(135deg, #0e0820 0%, #080510 100%)",
              border: "1px solid rgba(255,32,96,0.12)",
              boxShadow: "inset 0 2px 12px rgba(0,0,0,0.6), 0 0 40px rgba(255,32,96,0.06)",
            }}
          >
            <p className="font-mono text-[9px] text-white/25 tracking-[0.4em] uppercase mb-3">One-time price</p>
            <p
              className="text-5xl font-black mb-1"
              style={{ color: "#ff2060", textShadow: "0 0 24px rgba(255,32,96,0.35)" }}
            >
              {localPrice}
            </p>
            <p className="font-mono text-[11px] text-white/30 tracking-widest mb-6">No account. No subscription. Instant delivery.</p>

            <ul className="space-y-2 text-left mb-8">
              {[
                ["Permanent player number", "Low numbers = rarer"],
                ["PRE-LAUNCH edition seal", "Baked into the card permanently"],
                ["Shareable link", "Anyone can view your card"],
                ["Downloadable card image", "Share on IG, X, TikTok"],
              ].map(([label, note]) => (
                <li key={label} className="flex items-start space-x-3">
                  <span className="text-[#00ff7f] mt-0.5 shrink-0 text-xs">✓</span>
                  <span className="font-mono text-[11px] text-white/55">
                    <strong className="text-white/70">{label}</strong>{" "}
                    <span className="text-white/30">— {note}</span>
                  </span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => !soldOut && navigate("/create")}
              disabled={soldOut}
              className="w-full rounded-xl py-4 font-black tracking-[0.2em] text-[13px] relative overflow-hidden group transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(180deg, #1e0a16 0%, #130610 100%)",
                border: "1px solid rgba(255,32,96,0.3)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 0 20px rgba(255,32,96,0.1)",
                color: "#ff2060",
              }}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(255,32,96,0.07)" }} />
              {soldOut ? "SOLD OUT · ALL 2,000 CARDS ISSUED" : "CLAIM MY PLAYER CARD →"}
            </button>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-4 mt-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-[9px] text-white/20 tracking-widest text-center">
            SOLARA CITY BUREAU OF RESIDENTS · OFFICIAL DOCUMENT · SC-2025
          </p>
          <div className="flex items-center space-x-6">
            <Link to="/privacy" className="font-mono text-[9px] text-white/28 hover:text-white/55 tracking-widest uppercase transition-colors flex items-center space-x-1">
              <span>Privacy</span><ExternalLink className="w-2.5 h-2.5" />
            </Link>
            <Link to="/terms" className="font-mono text-[9px] text-white/28 hover:text-white/55 tracking-widest uppercase transition-colors flex items-center space-x-1">
              <span>Terms</span><ExternalLink className="w-2.5 h-2.5" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
