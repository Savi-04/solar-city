import React, { useEffect, useState } from "react";
import { Loader2, Zap, Star, Shield, Link as LinkIcon } from "lucide-react";
import { motion } from "motion/react";
import InteractiveCard from "./InteractiveCard";
import { useCurrencyPrice } from "../hooks/useCurrencyPrice";
import { trackEvent } from "../hooks/usePageView";

interface PreviewStepProps {
  jobId: string;
  previewUrl: string;
  onPay: () => void;
  isProcessingPayment: boolean;
  playerNumber?: number | null;
  completeToken?: string;
}

function HudCorners({ color = "#00e8ff" }: { color?: string }) {
  const style = { borderColor: color };
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2" style={style} />
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2" style={style} />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2" style={style} />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2" style={style} />
    </div>
  );
}

const FEATURES = [
  { icon: <Star className="w-3 h-3" />, label: "Permanent resident ID — lower numbers are rarer", color: "#ffc94a" },
  { icon: <Zap className="w-3 h-3" />, label: "AI portrait in Solara City graphic-novel style", color: "#ff6b1a" },
  { icon: <Shield className="w-3 h-3" />, label: "Holographic parallax card with tilt effect", color: "#00c6d4" },
  { icon: <LinkIcon className="w-3 h-3" />, label: "Shareable link + download for IG / X / TikTok", color: "#b8ff3c" },
];

export default function PreviewStep({ jobId, previewUrl: _previewUrl, onPay, isProcessingPayment, playerNumber, completeToken }: PreviewStepProps) {
  const [district, setDistrict] = useState<string | null>(null);
  const { price: localPrice, oldPrice } = useCurrencyPrice();

  const gumroadProductUrl = import.meta.env.VITE_GUMROAD_PRODUCT_URL as string | undefined;
  const completeUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/gumroad/complete?job_id=${encodeURIComponent(jobId)}${completeToken ? `&token=${encodeURIComponent(completeToken)}` : ""}`
    : "";
  const gumroadHref = gumroadProductUrl
    ? `${gumroadProductUrl}?wanted=${encodeURIComponent(completeUrl)}&job_id=${encodeURIComponent(jobId)}${completeToken ? `&tok=${encodeURIComponent(completeToken)}` : ""}`
    : undefined;
  const residentId = playerNumber !== null && playerNumber !== undefined
    ? `SC-${playerNumber.toString().padStart(8, "0")}`
    : "—";

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.district) setDistrict(d.district);
      })
      .catch(() => {});
  }, [jobId]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="max-w-md w-full mx-auto relative z-10"
    >
      <div className="rgb-border-wrap rounded-[18px]">
        <div className="skeuo-panel rounded-[17px] p-6 flex flex-col items-center">

          {/* Header */}
          <div className="text-center mb-6 w-full">
            <div className="flex items-center justify-center space-x-2 mb-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00ff7f]" style={{ boxShadow: "0 0 6px #00ff7f", animation: "pulse-green 2s ease-in-out infinite" }} />
              <h2
                className="text-xl font-black tracking-[0.18em] text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg, #ff2060, #ffffff, #00e8ff)" }}
              >
                CARD READY
              </h2>
              <div className="w-1.5 h-1.5 rounded-full bg-[#00ff7f]" style={{ boxShadow: "0 0 6px #00ff7f", animation: "pulse-green 2s ease-in-out infinite 0.5s" }} />
            </div>
            <p className="font-mono text-[9px] tracking-[0.32em] text-white/22 uppercase">Lock in your spot before it&apos;s gone</p>
          </div>

          {/* Card in HUD frame */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="relative w-full max-w-[260px] mb-8"
          >
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 50% 50%, rgba(255,32,96,0.1) 0%, transparent 70%)",
                filter: "blur(20px)",
                transform: "scale(1.3)",
              }}
            />
            <div
              className="relative aspect-[2/3] rounded-xl overflow-hidden scanlines"
              style={{ boxShadow: "0 0 30px rgba(255,32,96,0.08), 0 0 0 1px rgba(255,32,96,0.1)" }}
            >
              <InteractiveCard jobId={jobId} standalone={false} />
              <HudCorners color="#ff2060" />
            </div>
            <div className="absolute -bottom-5 inset-x-0 text-center">
              <span className="font-mono text-[8px] text-white/18 tracking-[0.4em] uppercase">Preview Mode Active</span>
            </div>
          </motion.div>

          {/* Registry stat bar */}
          <div className="w-full grid grid-cols-3 gap-2 mb-5">
            {[
              { label: "RESIDENT ID", value: residentId, color: "#ffc94a" },
              { label: "DISTRICT", value: district || "—", color: "#ff6b1a" },
              { label: "ISSUED", value: "2025", color: "#00c6d4" },
            ].map((stat) => (
              <div key={stat.label} className="hud-stat rounded-lg py-2 text-center">
                <p className="font-mono text-[8px] text-white/22 tracking-widest">{stat.label}</p>
                <p className="font-mono text-[10px] font-bold tracking-wider mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Features panel */}
          <div
            className="w-full rounded-xl p-4 mb-5 space-y-2.5"
            style={{
              background: "#060810",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <p className="font-mono text-[9px] text-white/18 tracking-[0.35em] uppercase mb-3">What you get</p>
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="flex items-center space-x-2.5"
              >
                <span style={{ color: f.color }}>{f.icon}</span>
                <span className="font-mono text-xs text-white/45">{f.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Pay button */}
          <motion.button
            onClick={() => {
              if (gumroadHref) {
                trackEvent("cta:claim-resident-id");
                onPay();
                window.location.href = gumroadHref;
              }
            }}
            disabled={isProcessingPayment}
            whileHover={{ scale: isProcessingPayment ? 1 : 1.01 }}
            whileTap={{ scale: isProcessingPayment ? 1 : 0.99 }}
            className="w-full rounded-xl py-4 relative overflow-hidden group disabled:opacity-45 disabled:cursor-not-allowed transition-shadow duration-200"
            style={{
              background: "linear-gradient(180deg, #1a0c14 0%, #110710 100%)",
              border: "1px solid rgba(255,32,96,0.25)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(255,32,96,0.08), 0 4px 14px rgba(0,0,0,0.55)",
            }}
          >
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
              style={{ background: "linear-gradient(135deg, rgba(255,32,96,0.1) 0%, rgba(155,89,255,0.07) 100%)" }}
            />
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-0 group-hover:opacity-100">
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent 0%, rgba(255,32,96,0.08) 50%, transparent 100%)", animation: "shimmer-sweep 2.5s ease-in-out infinite" }} />
            </div>

            {isProcessingPayment ? (
              <span className="relative z-10 flex items-center justify-center space-x-2">
                <Loader2 className="w-5 h-5 animate-spin text-[#ff2060]" />
                <span className="font-mono text-sm text-white/50 tracking-widest">PROCESSING…</span>
              </span>
            ) : (
              <span className="relative z-10 flex flex-col items-center">
                <span
                  className="font-black tracking-[0.18em] text-[15px]"
                  style={{ color: "#ff2060", textShadow: "0 0 12px rgba(255,32,96,0.45)" }}
                >
                  GET MY CARD · <span style={{ textDecoration: "line-through", color: "rgba(255,255,255,0.45)", fontSize: "0.82em" }}>{oldPrice}</span> {localPrice} →
                </span>
                <span className="font-mono text-[10px] text-white/28 tracking-widest mt-1">One-time · Shareable link · Yours to keep</span>
              </span>
            )}
          </motion.button>

          <p className="font-mono text-[8px] text-center text-white/14 mt-3 tracking-wide">
            Secure checkout · Powered by Gumroad · Solara City Bureau of Residents
          </p>

        </div>
      </div>
    </motion.div>
  );
}
