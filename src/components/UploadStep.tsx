import React, { useState, useRef, useEffect } from "react";
import { Upload, Camera, AlertTriangle, Zap, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { fal } from "@fal-ai/client";

fal.config({ proxyUrl: "/api/fal/proxy" });

interface UploadStepProps {
  onUpload: (data: FormData) => void;
  isUploading: boolean;
  uploadError: string | null;
}

function LedCheckbox({
  checked,
  onChange,
  color,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color: string;
  label: React.ReactNode;
}) {
  return (
    <label className="flex items-start space-x-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="led-check"
        style={{ "--led-color": color } as React.CSSProperties}
      />
      <span className="text-[11px] font-mono text-white/60 group-hover:text-white/90 transition-colors leading-relaxed">
        {label}
      </span>
    </label>
  );
}

export default function UploadStep({ onUpload, isUploading, uploadError }: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [skill, setSkill] = useState("");
  const [touched, setTouched] = useState({ name: false, city: false, skill: false });
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [counter, setCounter] = useState<{ issued: number; remaining: number } | null>(null);
  const [falUploading, setFalUploading] = useState(false);
  const [falError, setFalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/registry/count")
      .then((r) => r.json())
      .then(setCounter)
      .catch(() => {});
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) {
      const selected = e.dataTransfer.files[0];
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mark all fields touched so errors show on submit attempt
    if (!name || !city || !skill) {
      setTouched({ name: true, city: true, skill: true });
      return;
    }
    if (!file || !ageConfirmed || !ownershipConfirmed || !privacyAccepted) return;

    setFalError(null);
    setFalUploading(true);
    try {
      const selfie_url = await fal.storage.upload(file);
      const fd = new FormData();
      fd.append("selfie_url", selfie_url);
      fd.append("name", name);
      fd.append("city", city);
      fd.append("skill", skill);
      fd.append("age_confirmed", ageConfirmed.toString());
      fd.append("ownership_confirmed", ownershipConfirmed.toString());
      fd.append("privacy_accepted", privacyAccepted.toString());
      onUpload(fd);
    } catch (err: any) {
      setFalError(err?.message || "Upload failed, please try again");
    } finally {
      setFalUploading(false);
    }
  };

  const busy = isUploading || falUploading;
  const canSubmit = file && name && city && skill && ageConfirmed && ownershipConfirmed && privacyAccepted && !busy;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      className="max-w-md w-full mx-auto relative z-10"
    >
      {/* RGB animated border */}
      <div className="rgb-border-wrap rounded-[18px]">
        <div className="skeuo-panel rounded-[17px] p-6">

          {/* Window chrome */}
          <div className="flex items-center mb-5">
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" style={{ boxShadow: "0 0 6px rgba(255,95,87,0.8)" }} />
              <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" style={{ boxShadow: "0 0 6px rgba(255,189,46,0.8)" }} />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28ca41]" style={{ boxShadow: "0 0 6px rgba(40,202,65,0.8)" }} />
            </div>
            <div className="flex-1 mx-4 h-px bg-white/5" />
            <span className="font-mono text-[9px] text-white/60 tracking-widest">NEON_OS v2.0</span>
          </div>

          {/* Hero: scarcity counter */}
          <motion.div
            className="text-center mb-6"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <div className="inline-flex items-center space-x-3 mb-2">
              <Zap className="w-5 h-5 text-[#ff6b1a]" style={{ filter: "drop-shadow(0 0 6px rgba(255,107,26,0.8))" }} />
              <h1
                className="text-4xl font-black tracking-[0.15em] text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg, #ff6b1a 0%, #e8f4f8 50%, #00c6d4 100%)" }}
              >
                SUNFALL CITY
              </h1>
              <Zap className="w-5 h-5 text-[#00c6d4]" style={{ filter: "drop-shadow(0 0 6px rgba(0,198,212,0.8))" }} />
            </div>
            <p className="font-mono text-[9px] tracking-[0.32em] text-white/60 uppercase mb-3">
              County Sheriff · Fugitive Bulletin
            </p>

            {/* Live counter */}
            <div
              className="inline-flex items-center space-x-2 rounded-lg px-4 py-2"
              style={{
                background: "rgba(255,107,26,0.06)",
                border: "1px solid rgba(255,107,26,0.2)",
                boxShadow: "0 0 16px rgba(255,107,26,0.08)",
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff6b1a]" style={{ animation: "pulse-pink 1.5s ease-in-out infinite" }} />
              {counter ? (
                <span className="font-mono text-[10px] tracking-widest" style={{ color: "rgba(255,160,80,0.9)" }}>
                  <span className="text-white/70 font-bold">{counter.issued.toLocaleString()}</span>
                  {" "}IDs ISSUED · {" "}
                  <span className="text-[#ff6b1a] font-bold">{counter.remaining.toLocaleString()}</span>
                  {" "}REMAINING
                </span>
              ) : (
                <span className="font-mono text-[10px] text-white/60 tracking-widest">BULLETIN ACTIVE</span>
              )}
            </div>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Upload zone */}
            <div>
              <div className="flex items-center space-x-1.5 mb-1.5">
                <div className="w-1 h-1 rounded-full bg-[#00e8ff]" style={{ boxShadow: "0 0 4px #00e8ff" }} />
                <label className="text-[9px] font-mono text-[#00e8ff]/90 tracking-[0.28em] uppercase">Mugshot</label>
              </div>

              <div
                className="relative overflow-hidden rounded-xl cursor-pointer group transition-all duration-300"
                style={{
                  background: "linear-gradient(135deg, #090b18 0%, #060810 100%)",
                  boxShadow: "inset 0 2px 10px rgba(0,0,0,0.8)",
                  border: preview ? "1px solid rgba(0,232,255,0.3)" : "1px dashed rgba(255,255,255,0.1)",
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <AnimatePresence mode="wait">
                  {preview ? (
                    <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative h-32 scanlines">
                      <img src={preview} alt="Preview" className="w-full h-full object-cover opacity-55 group-hover:opacity-35 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex flex-col items-center space-y-1">
                          <Camera className="w-6 h-6 text-white" />
                          <span className="font-mono text-[10px] font-bold text-white tracking-widest">RESCAN</span>
                        </div>
                      </div>
                      <div className="absolute top-2 right-2 flex items-center space-x-1 rounded px-1.5 py-0.5" style={{ background: "rgba(0,255,127,0.08)", border: "1px solid rgba(0,255,127,0.25)" }}>
                        <div className="w-1.5 h-1.5 rounded-full bg-[#00ff7f]" style={{ boxShadow: "0 0 5px #00ff7f" }} />
                        <span className="font-mono text-[8px] text-[#00ff7f] tracking-wider">SCAN OK</span>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-8 space-y-3">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300" style={{ background: "linear-gradient(135deg, #0f1220 0%, #080a12 100%)", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.85), 0 0 14px rgba(255,32,96,0.07)" }}>
                        <Upload className="w-5 h-5 text-[#ff2060]" />
                      </div>
                      <div className="text-center">
                        <p className="font-mono text-xs font-bold text-white/60 tracking-widest">UPLOAD YOUR PHOTO</p>
                        <p className="font-mono text-[9px] text-white/60 mt-0.5">clear face · good lighting</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-0 group-hover:opacity-100">
                  <div className="absolute left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent 0%, #00e8ff 50%, transparent 100%)", animation: "scan-down 1.8s ease-in-out infinite" }} />
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </div>
            </div>

            {/* Player Handle + City */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center space-x-1.5 mb-1.5">
                  <div className="w-1 h-1 rounded-full bg-[#00e8ff]" style={{ boxShadow: "0 0 4px #00e8ff" }} />
                  <label className="text-[9px] font-mono text-[#00c6d4]/90 tracking-[0.28em] uppercase">Alias</label>
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, name: true }))}
                  className="skeuo-input w-full rounded-lg px-3 py-2.5 font-mono text-sm uppercase tracking-wider placeholder:text-white/45"
                  placeholder="ALEX NOVA"
                  maxLength={15}
                />
                {touched.name && !name && <p className="font-mono text-[9px] text-[#ff4444] mt-1">Name is required</p>}
              </div>
              <div>
                <div className="flex items-center space-x-1.5 mb-1.5">
                  <div className="w-1 h-1 rounded-full bg-[#ff2060]" style={{ boxShadow: "0 0 4px #ff2060" }} />
                  <label className="text-[9px] font-mono text-[#ff2060] tracking-[0.28em] uppercase">Last Seen In</label>
                </div>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, city: true }))}
                  className="skeuo-input w-full rounded-lg px-3 py-2.5 font-mono text-sm uppercase tracking-wider placeholder:text-white/45"
                  placeholder="SUNFALL CITY"
                  maxLength={20}
                />
                {touched.city && !city && <p className="font-mono text-[9px] text-[#ff4444] mt-1">City is required</p>}
              </div>
            </div>

            {/* Skill / Role */}
            <div>
              <div className="flex items-center space-x-1.5 mb-1.5">
                <div className="w-1 h-1 rounded-full bg-[#b8ff3c]" style={{ boxShadow: "0 0 4px #b8ff3c" }} />
                <label className="text-[9px] font-mono text-[#b8ff3c]/90 tracking-[0.28em] uppercase">Charges</label>
              </div>
              <input
                type="text"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, skill: true }))}
                className="skeuo-input w-full rounded-lg px-3 py-2.5 font-mono text-sm uppercase tracking-wider placeholder:text-white/45"
                placeholder="GRAND LARCENY · STREET RACING"
                maxLength={20}
              />
              {touched.skill && !skill && <p className="font-mono text-[9px] text-[#ff4444] mt-1">Skill is required</p>}
            </div>

            {/* Consent panel */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: "#060810", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <p className="font-mono text-[9px] text-white/60 tracking-[0.35em] uppercase mb-2.5">Authorization Required</p>
              <LedCheckbox checked={ageConfirmed} onChange={setAgeConfirmed} color="#00e8ff" label="I confirm I am 18 years or older." />
              <LedCheckbox checked={ownershipConfirmed} onChange={setOwnershipConfirmed} color="#9b59ff" label="This is my photo or I have permission to use it." />
              <LedCheckbox
                checked={privacyAccepted}
                onChange={setPrivacyAccepted}
                color="#ff2060"
                label={<>I agree to the{" "}<a href="/terms" target="_blank" rel="noreferrer" className="text-[#ff2060] hover:text-[#ff2060] underline transition-colors">Terms</a>{" "}&amp;{" "}<a href="/privacy" target="_blank" rel="noreferrer" className="text-[#ff2060] hover:text-[#ff2060] underline transition-colors">Privacy Policy</a>. Facial data is not stored long-term.</>}
              />
            </div>

            {/* Error */}
            <AnimatePresence>
              {(uploadError || falError) && (
                <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-start space-x-2.5 rounded-xl p-3" style={{ background: "rgba(255,0,0,0.05)", border: "1px solid rgba(255,0,0,0.18)" }}>
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs font-mono text-red-300/80">{falError || uploadError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="skeuo-btn w-full rounded-xl py-[14px] font-black tracking-[0.18em] text-[13px] disabled:opacity-30 disabled:cursor-not-allowed relative overflow-hidden"
              style={{ border: "1px solid rgba(255,32,96,0.15)" }}
            >
              <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,32,96,0.08) 0%, rgba(0,232,255,0.06) 100%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)", animation: canSubmit ? "shimmer-sweep 3s ease-in-out infinite" : "none" }} />
              <span className="relative z-10 text-white/85 flex items-center justify-center space-x-2.5">
                {falUploading ? (
                  <>
                    <Cpu className="w-4 h-4 text-[#00e8ff]" style={{ animation: "spin-slow 2s linear infinite" }} />
                    <span>UPLOADING…</span>
                  </>
                ) : isUploading ? (
                  <>
                    <Cpu className="w-4 h-4 text-[#ff6b1a]" style={{ animation: "spin-slow 2s linear infinite" }} />
                    <span>FILING BULLETIN…</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-[#ff6b1a]" style={{ filter: "drop-shadow(0 0 4px rgba(255,107,26,0.6))" }} />
                    <span>PUT ME ON THE BULLETIN</span>
                    <Zap className="w-4 h-4 text-[#00c6d4]" style={{ filter: "drop-shadow(0 0 4px rgba(0,198,212,0.6))" }} />
                  </>
                )}
              </span>
            </button>

            <p className="font-mono text-[8px] text-center text-white/60 tracking-wide">
              Sunfall City County Sheriff · Novelty Bulletin · Not a government document
            </p>

          </form>
        </div>
      </div>
    </motion.div>
  );
}
