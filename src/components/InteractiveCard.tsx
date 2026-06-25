import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

export default function InteractiveCard({ jobId, standalone = true, autoAnimate = false }: { jobId?: string, standalone?: boolean, autoAnimate?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const activeId = jobId || id;
  const navigate = useNavigate();
  const [layers, setLayers] = useState<{ bg: string, frame: string, portrait: string, text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [gyroPermission, setGyroPermission] = useState<'unavailable' | 'prompt' | 'granted' | 'denied'>('unavailable');
  const [videoState, setVideoState] = useState<'idle' | 'generating' | 'timeout' | 'error' | 'limit' | 'no_token'>('idle');
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(300);
  const videoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Card product-shot video state (independent of character video)
  const [cardVideoState, setCardVideoState] = useState<'idle' | 'generating' | 'timeout' | 'error' | 'limit'>('idle');
  const [cardTimerSecsLeft, setCardTimerSecsLeft] = useState<number>(300);
  const cardVideoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cardTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  const springConfig = { damping: 20, stiffness: 100, mass: 1 };
  const springX = useSpring(mouseX, springConfig);
  const springY = useSpring(mouseY, springConfig);

  // Rotate card based on mouse/touch position
  const rotateX = useTransform(springY, [0, 1], [15, -15]);
  const rotateY = useTransform(springX, [0, 1], [-15, 15]);

  // Parallax offsets for the layers
  const bgX = useTransform(springX, [0, 1], [2, -2]);
  const bgY = useTransform(springY, [0, 1], [2, -2]);
  const portraitX = useTransform(springX, [0, 1], [-5, 5]);
  const portraitY = useTransform(springY, [0, 1], [-5, 5]);
  const frameX = useTransform(springX, [0, 1], [-10, 10]);
  const frameY = useTransform(springY, [0, 1], [-10, 10]);
  const textX = useTransform(springX, [0, 1], [-15, 15]);
  const textY = useTransform(springY, [0, 1], [-15, 15]);

  // Holographic foil shimmer sweeping effect based on rotation
  const shimmerPosition = useTransform(springX, [0, 1], ['-100%', '200%']);

  // Ambient glow orb that tracks tilt
  const glowX = useTransform(springX, [0, 1], [-100, 100]);
  const glowY = useTransform(springY, [0, 1], [-100, 100]);
  const shimmerBgPos = useTransform(shimmerPosition, (val: string) => `${val} 0%`);

  // Idle sine-sweep for demo / landing page
  useEffect(() => {
    if (!autoAnimate) return;
    let animId: number;
    const sweep = () => {
      const t = Date.now() / 4500;
      mouseX.set(0.5 + Math.sin(t) * 0.32);
      mouseY.set(0.5 + Math.cos(t * 0.65) * 0.22);
      animId = requestAnimationFrame(sweep);
    };
    animId = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(animId);
  }, [autoAnimate, mouseX, mouseY]);

  // Detect whether gyroscope permission is needed (iOS 13+) or auto-available (Android)
  useEffect(() => {
    if (!window.DeviceOrientationEvent) return;
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      setGyroPermission('prompt'); // iOS 13+ — needs user gesture
    } else {
      setGyroPermission('granted'); // Android / desktop — events fire automatically
    }
  }, []);

  // Register deviceorientation listener once permission is granted
  useEffect(() => {
    if (gyroPermission !== 'granted') return;
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      // gamma: left-right tilt. -45° to +45° → 0 to 1 (neutral at 0° = 0.5)
      const x = (e.gamma + 45) / 90;
      // beta: front-back tilt. Upright = ~90°. Map ±30° from upright to 0–1.
      const y = (e.beta - 90) / 60 + 0.5;
      mouseX.set(Math.max(0, Math.min(1, x)));
      mouseY.set(Math.max(0, Math.min(1, y)));
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [gyroPermission, mouseX, mouseY]);

  // Touch tilt + scroll prevention
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const updateFromTouch = (e: TouchEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const touch = e.touches[0];
      if (!touch) return;
      mouseX.set(Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)));
      mouseY.set(Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height)));
    };
    el.addEventListener('touchstart', updateFromTouch, { passive: false });
    el.addEventListener('touchmove', updateFromTouch, { passive: false });
    return () => {
      el.removeEventListener('touchstart', updateFromTouch);
      el.removeEventListener('touchmove', updateFromTouch);
    };
  }, [mouseX, mouseY, layers]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const apiBase = standalone ? `/api/public/${activeId}` : `/api/jobs/${activeId}`;

    const loadCard = async () => {
      // In standalone mode, wait for payment to be confirmed before showing the card
      if (standalone) {
        while (!cancelled) {
          try {
            const res = await fetch(apiBase);
            if (!res.ok) { navigate("/"); return; }
            const data = await res.json();
            if (data.status === "DONE") { setPaymentPending(false); break; }
            setPaymentPending(true);
          } catch { break; }
          await new Promise<void>(r => { pollTimer = setTimeout(r, 3000); });
        }
        if (cancelled) return;
      }

      // Fetch layers
      try {
        const res = await fetch(`${apiBase}/layers`);
        if (!res.ok) throw new Error("layers_not_found");
        if (!cancelled) {
          setLayers(await res.json());
          localStorage.removeItem('solarPendingJob'); // card delivered — clear recovery entry
        }
      } catch {
        if (!cancelled) {
          if (standalone) navigate("/");
          else setError("layers_not_found");
        }
      }
    };

    loadCard();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [activeId, standalone, navigate]);

  // Capture ?owner= token from URL, store in localStorage, then clean the URL.
  // This lets the owner download videos from any future visit on this device
  // without leaking the token when they share the address bar URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ownerToken = params.get('owner');
    if (ownerToken && activeId) {
      localStorage.setItem(`dl_token_${activeId}`, ownerToken);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [activeId]);

  function getOwnerToken(): string | null {
    if (!activeId) return null;
    return localStorage.getItem(`dl_token_${activeId}`);
  }

  function withOwner(url: string): string {
    const token = getOwnerToken();
    return token ? `${url}?owner=${encodeURIComponent(token)}` : url;
  }

  // Clean up video poll on unmount
  useEffect(() => () => {
    if (videoPollRef.current) clearInterval(videoPollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (cardVideoPollRef.current) clearInterval(cardVideoPollRef.current);
    if (cardTimerRef.current) clearInterval(cardTimerRef.current);
  }, []);

  const triggerDownload = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solara-city-card.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    setVideoState('idle');
  };

  function stopTimers() {
    if (videoPollRef.current) { clearInterval(videoPollRef.current); videoPollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function handleDownloadVideo() {
    if (!id && !jobId) return;
    const publicId = id || jobId;
    stopTimers();

    // Check if the video is already ready (pre-generated at card creation time)
    const status = await fetch(`/api/public/${publicId}/video-status`).then(r => r.json()).catch(() => null);

    if (status?.video_b64 === "DONE") {
      setVideoState('generating');
      const res = await fetch(withOwner(`/api/public/${publicId}/video.mp4`)).catch(() => null);
      if (res?.ok) { const blob = await res.blob(); triggerDownload(blob); }
      else if (res?.status === 403) setVideoState('no_token');
      else setVideoState('error');
      return;
    }

    if ((status?.video_attempts ?? 0) >= 5 && status?.video_b64 !== "DONE") {
      setVideoState('limit');
      return;
    }

    // Video still generating — show 5-min countdown and poll status
    const WAIT_SECS = 300;
    setTimerSecondsLeft(WAIT_SECS);
    setVideoState('generating');
    const startedAt = Date.now();

    // If nothing is running (edge case: pre-trigger missed), kick it off via video.mp4
    if (!status?.generating && status?.video_b64 !== "ERROR") {
      fetch(withOwner(`/api/public/${publicId}/video.mp4`)).catch(() => {});
    }

    // Countdown tick — updates timer display every second
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, WAIT_SECS - elapsed);
      setTimerSecondsLeft(left);
      if (left === 0) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setVideoState(prev => prev === 'generating' ? 'timeout' : prev);
      }
    }, 1000);

    // Poll video-status (cheaper than polling video.mp4, doesn't risk re-triggering generation)
    videoPollRef.current = setInterval(async () => {
      const s = await fetch(`/api/public/${publicId}/video-status`).then(r => r.json()).catch(() => null);
      if (!s) return;

      if (s.video_b64 === "DONE") {
        stopTimers();
        const res = await fetch(withOwner(`/api/public/${publicId}/video.mp4`)).catch(() => null);
        if (res?.ok) { const blob = await res.blob(); triggerDownload(blob); }
        else if (res?.status === 403) setVideoState('no_token');
        else setVideoState('error');
        return;
      }

      if (s.video_b64 === "ERROR" || (s.video_attempts ?? 0) >= 5) {
        stopTimers();
        setVideoState((s.video_attempts ?? 0) >= 5 ? 'limit' : 'error');
      }
    }, 5000);
  }

  async function handleDownloadCardVideo() {
    if (!id && !jobId) return;
    const publicId = id || jobId;

    if (cardVideoPollRef.current) { clearInterval(cardVideoPollRef.current); cardVideoPollRef.current = null; }
    if (cardTimerRef.current) { clearInterval(cardTimerRef.current); cardTimerRef.current = null; }

    // Check if already generated
    const status = await fetch(`/api/public/${publicId}/card-video-status`).then(r => r.json()).catch(() => null);

    if (status?.card_video_b64 === "DONE") {
      setCardVideoState('generating');
      const res = await fetch(withOwner(`/api/public/${publicId}/card-video.mp4`)).catch(() => null);
      if (res?.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'solara-city-id-card.mp4';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        setCardVideoState('idle');
      } else {
        setCardVideoState('error');
      }
      return;
    }

    if ((status?.card_video_attempts ?? 0) >= 3 && status?.card_video_b64 !== "DONE") {
      setCardVideoState('limit');
      return;
    }

    // Not done yet — show 5-min countdown, kick off generation, poll status
    setCardTimerSecsLeft(300);
    setCardVideoState('generating');
    const startedAt = Date.now();

    // Kick off generation via endpoint (it deduplicates internally)
    fetch(withOwner(`/api/public/${publicId}/card-video.mp4`)).catch(() => {});

    cardTimerRef.current = setInterval(() => {
      const left = Math.max(0, 300 - Math.floor((Date.now() - startedAt) / 1000));
      setCardTimerSecsLeft(left);
      if (left === 0) {
        if (cardTimerRef.current) { clearInterval(cardTimerRef.current); cardTimerRef.current = null; }
        setCardVideoState(prev => prev === 'generating' ? 'timeout' : prev);
      }
    }, 1000);

    cardVideoPollRef.current = setInterval(async () => {
      const s = await fetch(`/api/public/${publicId}/card-video-status`).then(r => r.json()).catch(() => null);
      if (!s) return;

      if (s.card_video_b64 === "DONE") {
        if (cardVideoPollRef.current) { clearInterval(cardVideoPollRef.current); cardVideoPollRef.current = null; }
        if (cardTimerRef.current) { clearInterval(cardTimerRef.current); cardTimerRef.current = null; }
        const res = await fetch(withOwner(`/api/public/${publicId}/card-video.mp4`)).catch(() => null);
        if (res?.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'solara-city-id-card.mp4';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 15000);
          setCardVideoState('idle');
        } else {
          setCardVideoState('error');
        }
        return;
      }

      if (s.card_video_b64 === "ERROR" || (s.card_video_attempts ?? 0) >= 3) {
        if (cardVideoPollRef.current) { clearInterval(cardVideoPollRef.current); cardVideoPollRef.current = null; }
        if (cardTimerRef.current) { clearInterval(cardTimerRef.current); cardTimerRef.current = null; }
        setCardVideoState((s.card_video_attempts ?? 0) >= 3 ? 'limit' : 'error');
      }
    }, 5000);
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width);
    mouseY.set((e.clientY - rect.top) / rect.height);
  };

  const handleMouseLeave = () => {
    mouseX.set(0.5);
    mouseY.set(0.5);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-sm"
        style={{ background: "#05050d", color: "rgba(255,80,80,0.8)" }}>
        {error}
      </div>
    );
  }

  if (paymentPending) {
    const gumroadProductUrl = import.meta.env.VITE_GUMROAD_PRODUCT_URL as string | undefined;
    // Retrieve token from localStorage so the complete URL passes security check
    let savedToken: string | undefined;
    try {
      const raw = localStorage.getItem('solarPendingJob');
      if (raw) savedToken = JSON.parse(raw)?.completeToken ?? undefined;
    } catch { /* ignore */ }
    const completeUrl = `${window.location.origin}/api/gumroad/complete?job_id=${encodeURIComponent(activeId || "")}${savedToken ? `&token=${encodeURIComponent(savedToken)}` : ""}`;
    const gumroadHref = gumroadProductUrl
      ? `${gumroadProductUrl}?wanted=${encodeURIComponent(completeUrl)}`
      : undefined;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-5 px-6"
        style={{ background: "#05050d" }}>
        <div className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(255,107,26,0.5)", borderTopColor: "transparent" }} />
        <p className="font-mono text-[11px] tracking-[0.35em] uppercase"
          style={{ color: "rgba(255,107,26,0.55)", animation: "blink 1.4s step-end infinite" }}>
          Confirming Payment…
        </p>
        <p className="font-mono text-[9px] text-white/20 tracking-widest text-center">
          This page will update automatically after payment
        </p>
        {gumroadHref && (
          <a
            href={gumroadHref}
            className="mt-2 px-6 py-3 rounded-xl font-mono text-[11px] tracking-[0.2em] uppercase text-center"
            style={{
              background: "linear-gradient(180deg, #1a0c14 0%, #110710 100%)",
              border: "1px solid rgba(255,32,96,0.35)",
              color: "#ff2060",
              textDecoration: "none",
              boxShadow: "0 0 18px rgba(255,32,96,0.12)",
            }}
          >
            Complete Your Purchase →
          </a>
        )}
      </div>
    );
  }

  if (!layers) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-3"
        style={{ background: "#05050d" }}>
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "rgba(0,232,255,0.5)", borderTopColor: "transparent" }} />
        <p className="font-mono text-[11px] tracking-[0.35em] uppercase"
          style={{ color: "rgba(0,232,255,0.45)", animation: "blink 1.4s step-end infinite" }}>
          Forging Parallax Matrix…
        </p>
      </div>
    );
  }

  return (
    <div className={`${standalone ? "min-h-screen py-10 px-4" : "w-full h-full bg-transparent overflow-hidden rounded-xl"} flex flex-col items-center justify-center overflow-hidden font-sans select-none relative`}
      style={standalone ? {
        background: "#05050d",
        backgroundImage: "radial-gradient(ellipse 60% 50% at 30% 30%, rgba(0,61,79,0.18) 0%, transparent 65%), radial-gradient(ellipse 50% 60% at 70% 70%, rgba(255,107,26,0.08) 0%, transparent 65%)",
      } : undefined}>

      {standalone && (
        <div className="absolute top-4 left-4 z-20">
          <Link to="/" className="font-mono text-[9px] tracking-widest text-white/20 hover:text-white/50 transition-colors uppercase">
            ← Solara City
          </Link>
        </div>
      )}

      {/* Dynamic ambient background glow that reacts to tilt */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-20 pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(255,107,26,1) 0%, rgba(0,100,120,1) 100%)",
          x: glowX,
          y: glowY,
        }}
      />

      <div
        ref={cardRef}
        className={`relative z-10 perspective-[1200px] ${standalone ? "" : "w-full h-full"}`}
        style={standalone ? { width: "min(400px, 90vw)", height: "calc(min(400px, 90vw) * 1.3325)", touchAction: "none" } : { touchAction: "none" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchEnd={handleMouseLeave}
      >
        <motion.div
          className="relative w-full h-full will-change-transform"
          style={{
            rotateX,
            rotateY,
            transformStyle: "preserve-3d"
          }}
        >
          {/* Base Layer */}
          <motion.img
            src={layers.bg}
            className="absolute inset-0 w-full h-full rounded-[22px] drop-shadow-2xl"
            style={{ x: bgX, y: bgY, translateZ: "0px" }}
            alt="Card Base"
          />

          {/* Portrait Layer */}
          <motion.img
            src={layers.portrait}
            className="absolute inset-0 w-full h-full"
            style={{ x: portraitX, y: portraitY, translateZ: "20px" }}
            alt="Portrait"
          />

          {/* Frame Layer */}
          <motion.img
            src={layers.frame}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ x: frameX, y: frameY, translateZ: "40px" }}
            alt="Frame"
          />

          {/* Holographic Shimmer Overlay */}
          <motion.div
            className="absolute inset-[15px] rounded-[13px] pointer-events-none mix-blend-color-dodge opacity-20"
            style={{
              background: "linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.35) 45%, rgba(255,0,255,0.25) 50%, rgba(0,255,255,0.25) 55%, transparent 75%)",
              backgroundSize: "200% 200%",
              backgroundPosition: shimmerBgPos,
              translateZ: "45px"
            }}
          />

          {/* Text Layer */}
          <motion.img
            src={layers.text}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ x: textX, y: textY, translateZ: "60px" }}
            alt="Text"
          />
        </motion.div>
      </div>

      {standalone && (
        <div className="relative z-10 flex flex-col items-center mt-8 space-y-4">
          <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-center" style={{ color: "rgba(255,255,255,0.18)" }}>
            ◆ Hover or tilt to inspect hologram ◆
          </p>
          {/* iOS 13+ gyroscope permission button — only appears when permission can be requested */}
          {gyroPermission === 'prompt' && (
            <button
              onClick={async () => {
                try {
                  const perm = await (DeviceOrientationEvent as any).requestPermission();
                  setGyroPermission(perm === 'granted' ? 'granted' : 'denied');
                } catch { setGyroPermission('denied'); }
              }}
              className="font-mono text-[9px] tracking-[0.3em] uppercase px-4 py-2 rounded-lg transition-colors"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}
            >
              ◈ Enable gyroscope tilt
            </button>
          )}
          {/* Download for TikTok — video is pre-generated at card creation, usually ready on arrival */}
          {videoState === 'no_token' ? (
            <div
              className="inline-flex items-center justify-center rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[11px] w-full max-w-[280px] text-center"
              style={{ background: "rgba(255,160,0,0.06)", border: "1px solid rgba(255,160,0,0.22)", color: "rgba(255,160,0,0.7)", lineHeight: "1.6" }}
            >
              Open the owner link from your email to download
            </div>
          ) : videoState === 'limit' ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
              <div
                className="inline-flex items-center justify-center rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[11px] w-full"
                style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.25)", color: "rgba(255,68,68,0.6)" }}
              >
                <span>Generation limit reached — contact support</span>
              </div>
              <button
                onClick={async () => {
                  const publicId = id || jobId;
                  const s = await fetch(`/api/public/${publicId}/video-status`).then(r => r.json()).catch(() => null);
                  if (s && (s.video_attempts ?? 0) < 5 && s.video_b64 !== 'ERROR') setVideoState('idle');
                }}
                className="font-mono text-[9px] tracking-[0.25em] uppercase"
                style={{ color: "rgba(255,255,255,0.2)" }}
              >
                ↺ check if unlocked
              </button>
            </div>
          ) : videoState === 'timeout' ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
              <div
                className="inline-flex items-center justify-center rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[11px] w-full text-center"
                style={{ background: "rgba(255,160,0,0.06)", border: "1px solid rgba(255,160,0,0.2)", color: "rgba(255,160,0,0.65)", lineHeight: "1.5" }}
              >
                ⏳ Still rendering — tap to check if ready
              </div>
              <button
                onClick={handleDownloadVideo}
                className="font-mono text-[9px] tracking-[0.25em] uppercase"
                style={{ color: "rgba(255,255,255,0.25)" }}
              >
                ↺ check status
              </button>
            </div>
          ) : videoState === 'generating' ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
              <div
                className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[12px] w-full"
                style={{ background: "linear-gradient(180deg, #060f08 0%, #040a06 100%)", border: "1px solid rgba(0,255,127,0.18)", color: "rgba(0,255,127,0.5)", cursor: "wait" }}
              >
                <span style={{ display: "inline-block", animation: "spin-slow 1.2s linear infinite" }}>◌</span>
                <span>{Math.floor(timerSecondsLeft / 60)}:{String(timerSecondsLeft % 60).padStart(2, '0')} — generating…</span>
              </div>
              <div style={{ width: "100%", maxWidth: "280px", height: "2px", background: "rgba(0,255,127,0.08)", borderRadius: "1px", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "rgba(0,255,127,0.45)", borderRadius: "1px", transition: "width 1s linear", width: `${((300 - timerSecondsLeft) / 300) * 100}%` }} />
              </div>
            </div>
          ) : (
            <button
              onClick={handleDownloadVideo}
              className="inline-flex items-center justify-center space-x-2 rounded-xl px-7 py-3.5 font-black tracking-[0.14em] text-[13px] transition-all w-full max-w-[280px]"
              style={{
                background: "linear-gradient(180deg, #0a1a10 0%, #061009 100%)",
                border: "1px solid rgba(0,255,127,0.38)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 22px rgba(0,255,127,0.12)",
                color: videoState === 'error' ? "#ffaa00" : "#00ff7f",
                cursor: "pointer",
              }}
            >
              {videoState === 'error' ? (
                <span>⚠ Retry Download</span>
              ) : (
                <>
                  <span style={{ fontSize: "15px" }}>⬇</span>
                  <span>Download for TikTok</span>
                </>
              )}
            </button>
          )}

          {/* Card product-shot download — cinematic water-droplet video, on demand */}
          {cardVideoState === 'limit' ? (
            <div
              className="inline-flex items-center justify-center rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[11px] w-full max-w-[280px] text-center"
              style={{ background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.25)", color: "rgba(255,68,68,0.6)" }}
            >
              Card video limit reached — contact support
            </div>
          ) : cardVideoState === 'timeout' ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
              <div
                className="inline-flex items-center justify-center rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[11px] w-full text-center"
                style={{ background: "rgba(255,160,0,0.06)", border: "1px solid rgba(255,160,0,0.2)", color: "rgba(255,160,0,0.65)", lineHeight: "1.5" }}
              >
                ⏳ Still rendering — tap to check if ready
              </div>
              <button
                onClick={handleDownloadCardVideo}
                className="font-mono text-[9px] tracking-[0.25em] uppercase"
                style={{ color: "rgba(255,255,255,0.25)" }}
              >
                ↺ check status
              </button>
            </div>
          ) : cardVideoState === 'generating' ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-[280px]">
              <div
                className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 font-mono tracking-[0.1em] text-[12px] w-full"
                style={{ background: "linear-gradient(180deg, #0d0a18 0%, #080614 100%)", border: "1px solid rgba(180,120,255,0.18)", color: "rgba(180,120,255,0.55)", cursor: "wait" }}
              >
                <span style={{ display: "inline-block", animation: "spin-slow 1.2s linear infinite" }}>◌</span>
                <span>{Math.floor(cardTimerSecsLeft / 60)}:{String(cardTimerSecsLeft % 60).padStart(2, '0')} — rendering card…</span>
              </div>
              <div style={{ width: "100%", maxWidth: "280px", height: "2px", background: "rgba(180,120,255,0.08)", borderRadius: "1px", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "rgba(180,120,255,0.45)", borderRadius: "1px", transition: "width 1s linear", width: `${((300 - cardTimerSecsLeft) / 300) * 100}%` }} />
              </div>
            </div>
          ) : (
            <button
              onClick={handleDownloadCardVideo}
              className="inline-flex items-center justify-center space-x-2 rounded-xl px-7 py-3.5 font-black tracking-[0.14em] text-[13px] transition-all w-full max-w-[280px]"
              style={{
                background: "linear-gradient(180deg, #0d0a18 0%, #080614 100%)",
                border: `1px solid rgba(180,120,255,${cardVideoState === 'error' ? '0.2' : '0.35'})`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 0 20px rgba(140,80,255,0.08)",
                color: cardVideoState === 'error' ? "#ffaa00" : "#b478ff",
                cursor: "pointer",
              }}
            >
              {cardVideoState === 'error' ? (
                <span>⚠ Retry Card Video</span>
              ) : (
                <>
                  <span style={{ fontSize: "15px" }}>✦</span>
                  <span>Share Card</span>
                </>
              )}
            </button>
          )}

          <Link
            to="/create"
            className="inline-flex items-center space-x-2 rounded-xl px-7 py-3.5 font-black tracking-[0.18em] text-[13px] transition-all"
            style={{
              background: "linear-gradient(180deg, #1a0e06 0%, #0e0906 100%)",
              border: "1px solid rgba(255,107,26,0.32)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 0 20px rgba(255,107,26,0.1)",
              color: "#ff6b1a",
            }}
          >
            <span>Make yours</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
