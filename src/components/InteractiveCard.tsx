import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

export default function InteractiveCard({ jobId, standalone = true, autoAnimate = false }: { jobId?: string, standalone?: boolean, autoAnimate?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const activeId = jobId || id;
  const [layers, setLayers] = useState<{ bg: string, frame: string, portrait: string, text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  
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
  // Background stays relatively still
  const bgX = useTransform(springX, [0, 1], [2, -2]);
  const bgY = useTransform(springY, [0, 1], [2, -2]);
  
  // Portrait moves slightly more than bg
  const portraitX = useTransform(springX, [0, 1], [-5, 5]);
  const portraitY = useTransform(springY, [0, 1], [-5, 5]);
  
  // Frame and text move a bit
  const frameX = useTransform(springX, [0, 1], [-10, 10]);
  const frameY = useTransform(springY, [0, 1], [-10, 10]);
  
  // Text pops out the most
  const textX = useTransform(springX, [0, 1], [-15, 15]);
  const textY = useTransform(springY, [0, 1], [-15, 15]);

  // Holographic foil shimmer sweeping effect based on rotation
  // When rotated, shift the background position of a gradient
  const shimmerPosition = useTransform(springX, [0, 1], ['-100%', '200%']);

  // Ambient glow orb that tracks tilt — must be at top level (not inside JSX)
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

  useEffect(() => {
    if (!activeId) return;

    // Fetch layers
    fetch(`/api/jobs/${activeId}/layers`)
      .then(res => {
        if (!res.ok) throw new Error("Layers not ready yet or job not found");
        return res.json();
      })
      .then(data => setLayers(data))
      .catch(err => setError(err.message));
      
    // Handle device orientation for mobile touch-tilt
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // beta is front-to-back tilt in degrees, where front is positive
      // gamma is left-to-right tilt in degrees, where right is positive
      if (e.beta === null || e.gamma === null) return;
      
      // Normalize to 0-1 range
      let x = (e.gamma + 45) / 90; // clamp ~ -45 to 45
      let y = (e.beta - 45 + 45) / 90; // clamp ~ 0 to 90 (assumes holding phone upright)
      
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      
      mouseX.set(x);
      mouseY.set(y);
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    
    return () => {
      if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, [activeId, mouseX, mouseY]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    
    // Calculate normalized position (0 to 1) inside the card wrapper
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    mouseX.set(x);
    mouseY.set(y);
  };
  
  const handleMouseLeave = () => {
    // Reset to center
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
        style={standalone ? { width: "min(400px, 90vw)", height: "calc(min(400px, 90vw) * 1.3325)" } : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchMove={(e) => {
          if (!cardRef.current) return;
          const rect = cardRef.current.getBoundingClientRect();
          const touch = e.touches[0];
          const x = (touch.clientX - rect.left) / rect.width;
          const y = (touch.clientY - rect.top) / rect.height;
          mouseX.set(x);
          mouseY.set(y);
        }}
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
