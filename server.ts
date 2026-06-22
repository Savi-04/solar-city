import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";
import {
  db,
  createJob,
  updateJobPreview,
  updateJobStatus,
  setJobOutput,
  getJob,
  saveJobLayers,
  logConsent,
  getRegistryCount,
} from "./src/db.ts";

// Edition seal computed relative to launch date (set LAUNCH_DATE env var, e.g. "2025-06-24")
function getEditionSeal(): string {
  const launchDate = process.env.LAUNCH_DATE ? new Date(process.env.LAUNCH_DATE) : new Date('2025-06-26');
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24));
  const monthStr = now.toLocaleString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
  if (diffDays < 0) return `PRE-LAUNCH · ${monthStr}`;
  if (diffDays === 0) return 'DAY ONE';
  if (diffDays <= 7) return 'LAUNCH WEEK';
  return `ISSUED · ${monthStr}`;
}

function formatPlayerNumber(n: number): string {
  return n.toString().padStart(4, '0');
}

const PORT = parseInt(process.env.PORT || "3000");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

async function startServer() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Step A: Upload & Validate
  app.post("/api/upload", upload.single("selfie"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image provided" });
      }

      let { name, city, age_confirmed, ownership_confirmed, privacy_accepted } = req.body;
      name = name || "UNKNOWN";
      city = city || "UNKNOWN";

      if (!age_confirmed || !ownership_confirmed || !privacy_accepted) {
        return res.status(400).json({ error: "Consent required" });
      }

      const jobId = crypto.randomUUID();
      const playerNumber = createJob(jobId, name, city);
      logConsent(jobId, age_confirmed === "true", ownership_confirmed === "true", privacy_accepted === "true");

      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype;

      // ─── Run moderation fast, in parallel with stylization start ───
      // We return the jobId to the client immediately after moderation passes.
      // Stylization + card building continue in the background; client polls for preview_url.
      let modResult = "ACCEPT";
      try {
        const modInteraction = await ai.interactions.create({
          model: "gemini-2.5-flash",
          input: [
            { type: "image", data: base64Image, mime_type: mimeType as any },
            { type: "text", text: "Does this image contain a single adult human face? Output exactly ACCEPT if it is, or REJECT if there are issues." },
          ],
        });
        modResult = modInteraction.output_text?.trim() || "ACCEPT";
      } catch (err) {
        console.error("Moderation check failed, skipping...", err);
      }

      if (modResult?.includes("REJECT")) {
        return res.status(400).json({ error: "Image failed safety check or isn't a clear adult human face" });
      }

      // ✅ Respond immediately after moderation — client gets jobId right away (~3-5s)
      res.json({ jobId, playerNumber });

      // ─── Background: stylize + build card + store preview ───
      // This runs after the HTTP response is already sent
      const job = getJob(jobId);
      const district = job?.district || 'SUNRISE COAST';
      buildCardInBackground(jobId, name, city, district, playerNumber, base64Image, mimeType).catch((err) => {
        console.error("Background card build failed", err);
        updateJobStatus(jobId, "FAILED");
      });

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Runs fully in background after upload responds
  async function buildCardInBackground(
    jobId: string, name: string, city: string,
    district: string, playerNumber: number,
    base64Image: string, mimeType: string
  ) {
    let stylizedBase64 = base64Image;

    try {
      const styleInteraction = await ai.interactions.create({
        model: "gemini-2.5-flash-image",
        input: [
          { type: "image", data: base64Image, mime_type: mimeType as any },
          {
            type: "text",
            text: `Transform this photo into a bold graphic-novel / screenprint style portrait for an official ID card. NOT photorealistic. NOT anime. Aim for high-end editorial illustration — clean, confident, deliberate. Smooth tonal shading with 4-5 distinct tonal bands (posterized/screenprint feel). Primary key light from below-left: warm amber/golden light catching the chin, cheekbones, and nose. Secondary fill light from upper-right: cold chrome/teal rim light on the opposite side. Deep confident shadows. The eyes must be sharp, fully detailed, and direct. Preserve the subject's exact facial features, bone structure, skin tone, hairstyle. The portrait must be recognizable as the same person — do NOT alter race, gender, or age. Head and shoulders only, centered, portrait crop. Dark teal/near-black background. No text, no logos, no watermarks.`,
          },
        ],
      });

      const imageOutput = styleInteraction.steps
        .slice().reverse()
        .find((s) => s.type === "model_output")
        ?.content?.find((c) => c.type === "image");

      if (imageOutput?.data) {
        stylizedBase64 = imageOutput.data;
      }
    } catch (err) {
      console.error("Image stylization failed, falling back to original", err);
    }

    // Portrait window: 260×300px at x=70, y=50 in SVG coords.
    // 2× render: resize portrait to 520×600px, composite at top=100, left=140.
    const maskSvg = Buffer.from(
      '<svg width="520" height="600" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg"><rect width="260" height="300" rx="12" ry="12" fill="white"/></svg>'
    );

    const portraitBuffer = await sharp(Buffer.from(stylizedBase64, "base64"))
      .resize(520, 600, { fit: "cover", position: "centre" })
      .modulate({ brightness: 1.12, saturation: 1.15 })
      .sharpen({ sigma: 1.0, m1: 0.5, m2: 0.8 })
      .ensureAlpha()
      .composite([{ input: maskSvg, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // Guilloche grain lines — teal/amber tones for Solara palette
    const guillocheLines = (() => {
      let paths = "";
      for (let y = 0; y <= 533; y += 11) {
        let d = `M 0 ${y}`;
        for (let x = 0; x <= 400; x += 8) {
          const dy = Math.sin((x / 400) * Math.PI * 6 + (y / 11)) * 2.5;
          d += ` L ${x} ${y + dy}`;
        }
        paths += `<path d="${d}" fill="none" stroke="rgba(0,61,79,0.12)" stroke-width="0.4"/>`;
      }
      for (let x = 0; x <= 400; x += 13) {
        let d = `M ${x} 0`;
        for (let y = 0; y <= 533; y += 8) {
          const dx = Math.sin((y / 533) * Math.PI * 8 + (x / 13)) * 2;
          d += ` L ${x + dx} ${y}`;
        }
        paths += `<path d="${d}" fill="none" stroke="rgba(255,107,26,0.04)" stroke-width="0.4"/>`;
      }
      return paths;
    })();

    // Bureau Seal: compass rose + 6-ray sun + "SC" center
    const bureauSeal = (() => {
      const cx = 377, cy = 25, r = 19;
      const ticks = Array.from({length: 8}, (_, i) => {
        const a = (i * 45 - 90) * Math.PI / 180;
        return `<line x1="${(cx + Math.cos(a) * r).toFixed(1)}" y1="${(cy + Math.sin(a) * r).toFixed(1)}" x2="${(cx + Math.cos(a) * (r-5)).toFixed(1)}" y2="${(cy + Math.sin(a) * (r-5)).toFixed(1)}" stroke="#ffc94a" stroke-width="0.9"/>`;
      }).join('');
      const starR = r - 8, innerR = (r - 8) * 0.42;
      let pts = '';
      for (let i = 0; i < 6; i++) {
        const oa = (i * 60 - 90) * Math.PI / 180;
        const ia = ((i + 0.5) * 60 - 90) * Math.PI / 180;
        pts += `${(cx + Math.cos(oa) * starR).toFixed(1)},${(cy + Math.sin(oa) * starR).toFixed(1)} `;
        pts += `${(cx + Math.cos(ia) * innerR).toFixed(1)},${(cy + Math.sin(ia) * innerR).toFixed(1)} `;
      }
      return `<g opacity="0.88"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffc94a" stroke-width="0.9"/>${ticks}<polygon points="${pts.trim()}" fill="#ffc94a" opacity="0.62"/><text x="${cx}" y="${(cy + 3.5).toFixed(1)}" font-family="Impact,'Arial Black',sans-serif" font-size="6" fill="#ffc94a" text-anchor="middle" font-weight="900">SC</text></g>`;
    })();

    // Fake barcode lines — bottom of card
    const barcodeLines = (() => {
      const pat = [2,1,3,1,2,1,1,3,2,1,1,2,3,1,1,2,1,3,2,1,1,2,1,1,3];
      const total = pat.reduce((a,b) => a+b, 0);
      const scale = 100 / total;
      let cx = 20, out = '';
      pat.forEach((u, i) => {
        const w = (u * scale).toFixed(1);
        if (i % 2 === 0) out += `<rect x="${cx.toFixed(1)}" y="478" width="${w}" height="24" fill="#4a6b7a" opacity="0.5"/>`;
        cx += u * scale;
      });
      return out;
    })();

    const playerNumStr = formatPlayerNumber(playerNumber);
    const residentId = `SC-${playerNumber.toString().padStart(8, '0')}`;
    const nameFontSize = name.length <= 8 ? 26 : name.length <= 13 ? 21 : 17;
    const nameLetterSpacing = name.length <= 8 ? 3 : 1;

    // All SVGs at 2× (800×1066) with viewBox="0 0 400 533" — crisp retina rendering
    // Card: 400×533 (3:4 ratio — ID card proportion)
    const sharedDefs = `
      <defs>
        <linearGradient id="bg-main" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#003d4f"/>
          <stop offset="100%" stop-color="#070d14"/>
        </linearGradient>
        <linearGradient id="amber-coral" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#ff6b1a"/>
          <stop offset="100%" stop-color="#ff3d5a"/>
        </linearGradient>
        <linearGradient id="holo-strip" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#ff00aa"/>
          <stop offset="25%"  stop-color="#00ffdd"/>
          <stop offset="50%"  stop-color="#ffee00"/>
          <stop offset="75%"  stop-color="#aa00ff"/>
          <stop offset="100%" stop-color="#ff00aa"/>
        </linearGradient>
        <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#ffc94a"/>
          <stop offset="50%"  stop-color="#ffe08a"/>
          <stop offset="100%" stop-color="#d4961f"/>
        </linearGradient>
        <radialGradient id="portrait-glow" cx="50%" cy="28%" r="40%">
          <stop offset="0%"   stop-color="#ff6b1a" stop-opacity="0.06"/>
          <stop offset="100%" stop-color="#070d14" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="edge-dark" cx="50%" cy="50%" r="65%">
          <stop offset="55%"  stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>
        </radialGradient>
        <clipPath id="card-clip"><rect width="400" height="533" rx="18"/></clipPath>
      </defs>
    `;

    const bgSvg = `
      <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
        ${sharedDefs}
        <g clip-path="url(#card-clip)">
          <rect width="400" height="533" fill="url(#bg-main)"/>
          ${guillocheLines}
          <rect x="60" y="44" width="280" height="310" fill="url(#portrait-glow)" rx="14"/>
          <!-- Holographic diagonal strip (crosses card mid-section, below portrait) -->
          <rect x="-200" y="322" width="800" height="32" fill="url(#holo-strip)" opacity="0.14"
                transform="rotate(-35, 200, 338)"/>
          <rect width="400" height="533" fill="url(#edge-dark)"/>
        </g>
      </svg>
    `;

    const frameSvg = `
      <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
        ${sharedDefs}
        <defs>
          <mask id="portrait-window">
            <rect width="400" height="533" rx="18" fill="white"/>
            <rect x="70" y="50" width="260" height="300" rx="12" fill="black"/>
          </mask>
        </defs>

        <!-- Dark teal chrome overlay (masked away at portrait window) -->
        <rect width="400" height="533" fill="rgba(0,30,42,0.55)" rx="18" mask="url(#portrait-window)"/>

        <!-- Card outer border -->
        <rect width="400" height="533" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="18"/>

        <!-- Portrait window decorative border: amber→coral gradient, 2px -->
        <rect x="69" y="49" width="262" height="302" rx="13" fill="none" stroke="url(#amber-coral)" stroke-width="2"/>

        <!-- Header bar: "SOLARA CITY" -->
        <text x="20" y="31"
          fill="#ff6b1a" font-family="Impact,'Arial Black',sans-serif"
          font-size="19" font-weight="900" letter-spacing="4">SOLARA CITY</text>

        <!-- Header subtitle: "BUREAU OF RESIDENTS" -->
        <text x="20" y="43"
          fill="#e8f4f8" font-family="Arial,sans-serif"
          font-size="7.5" letter-spacing="3.5" opacity="0.5">BUREAU OF RESIDENTS</text>

        <!-- Bureau Seal (compass rose + sun + SC) -->
        ${bureauSeal}

        <!-- Header divider (amber tint) -->
        <rect x="0" y="50" width="400" height="0.6" fill="rgba(255,107,26,0.3)"/>

        <!-- Name/city section top divider -->
        <rect x="16" y="400" width="368" height="0.5" fill="rgba(255,255,255,0.07)"/>

        <!-- Data rows section top divider -->
        <rect x="16" y="416" width="368" height="0.3" fill="rgba(255,255,255,0.05)"/>

        <!-- Data row labels -->
        <text x="20" y="430" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">RESIDENT ID</text>
        <text x="20" y="444" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">DISTRICT</text>
        <text x="20" y="458" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">CLEARANCE</text>
        <text x="20" y="472" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">ISSUED</text>

        <!-- Status bar divider -->
        <rect x="0" y="478" width="400" height="0.5" fill="rgba(255,255,255,0.06)"/>

        <!-- Fake barcode (bottom-left) -->
        ${barcodeLines}

        <!-- STATUS: VERIFIED ✦ (bottom-right, lime) -->
        <text x="384" y="498"
          fill="#b8ff3c" font-family="'Courier New',monospace"
          font-size="7.5" text-anchor="end" letter-spacing="1.5" font-weight="700">STATUS: VERIFIED ✦</text>

        <!-- Legal disclaimer -->
        <text x="200" y="526"
          fill="rgba(255,255,255,0.12)" font-family="monospace"
          font-size="4" text-anchor="middle" letter-spacing="0.8">
          SOLARA CITY BUREAU OF RESIDENTS ✦ OFFICIAL DOCUMENT ✦ SC-2025
        </text>
      </svg>
    `;

    const textSvg = `
      <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
        ${sharedDefs}

        <!-- Resident number (top-right in header, subtle) -->
        <text x="338" y="31"
          fill="rgba(255,107,26,0.45)" font-family="'Courier New',monospace"
          font-size="7" text-anchor="end" letter-spacing="1">#${playerNumStr}</text>

        <!-- Name: bold, chrome -->
        <text x="20" y="383"
          fill="#e8f4f8" font-family="Impact,'Arial Black',sans-serif"
          font-size="${nameFontSize}" font-weight="900" letter-spacing="${nameLetterSpacing}">${name.toUpperCase()}</text>

        <!-- City: smaller, muted teal -->
        <text x="20" y="397"
          fill="#4a6b7a" font-family="Arial,sans-serif"
          font-size="10.5" letter-spacing="2">${city.toUpperCase()}</text>

        <!-- RESIDENT ID value -->
        <text x="135" y="430"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">${residentId}</text>

        <!-- DISTRICT value -->
        <text x="135" y="444"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">${district}</text>

        <!-- CLEARANCE value (lime — verified) -->
        <text x="135" y="458"
          fill="#b8ff3c" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1">UNRESTRICTED</text>

        <!-- ISSUED value -->
        <text x="135" y="472"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">2025</text>
      </svg>
    `;

    try {
      const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
      const frameBuffer = await sharp(Buffer.from(frameSvg)).png().toBuffer();
      const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();

      const unwatermarkedBuffer = await sharp(bgBuffer)
        .composite([
          { input: portraitBuffer, top: 100, left: 140 },
          { input: frameBuffer, top: 0, left: 0 },
          { input: textBuffer, top: 0, left: 0 }
        ])
        .png()
        .toBuffer();

      const watermarkSvg = `
        <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
          <text x="200" y="280" fill="#ffffff" font-family="Arial Black, sans-serif" font-weight="900" font-size="52" text-anchor="middle" opacity="0.26" transform="rotate(-38 200 280)" letter-spacing="4">PREVIEW</text>
        </svg>
      `;
      const previewBuffer = await sharp(unwatermarkedBuffer)
        .composite([{ input: Buffer.from(watermarkSvg), top: 0, left: 0 }])
        .jpeg({ quality: 85 })
        .toBuffer();

      saveJobLayers(jobId, bgBuffer.toString("base64"), frameBuffer.toString("base64"), portraitBuffer.toString("base64"), textBuffer.toString("base64"));
      
      const unwBase64 = unwatermarkedBuffer.toString("base64");
      const prevBase64 = previewBuffer.toString("base64");
      updateJobPreview(jobId, `data:image/jpeg;base64,${prevBase64}`, unwBase64);
    } catch (err) {
      console.error("Composite failed", err);
      updateJobStatus(jobId, "FAILED");
    }
  }

  // Endpoints to serve the layers
  app.get("/api/jobs/:id/layers", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (!job.bg_layer_b64) return res.status(404).json({ error: "Layers not generated yet" });

    res.json({
      bg: "/api/jobs/" + job.id + "/bg",
      frame: "/api/jobs/" + job.id + "/frame",
      portrait: "/api/jobs/" + job.id + "/portrait",
      text: "/api/jobs/" + job.id + "/text"
    });
  });

  ['bg', 'frame', 'portrait', 'text'].forEach(layer => {
    app.get(`/api/jobs/:id/${layer}`, (req, res) => {
      const job = getJob(req.params.id);
      if (!job || !job[`${layer}_layer_b64`]) return res.status(404).send("Not found");
      const buffer = Buffer.from(job[`${layer}_layer_b64`], "base64");
      res.setHeader("Content-Type", "image/png");
      // Demo card should never be cached — it regenerates on server restart
      const isDemoCard = req.params.id === "demo-card-v3";
      res.setHeader("Cache-Control", isDemoCard ? "no-cache, no-store" : "public, max-age=31536000");
      res.end(buffer);
    });
  });

  app.get("/api/registry/count", (req, res) => {
    res.json(getRegistryCount());
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      id: job.id,
      status: job.status,
      name: job.name_input,
      city: job.city_input,
      preview_url: job.preview_base64,
      output_url: job.output_url,
      layers_ready: !!job.bg_layer_b64,
      player_number: job.player_number,
      district: job.district,
    });
  });

  
  // Card delivery — marks job DONE immediately (free MVP, no payment/video capture)
  app.post("/api/checkout", async (req, res) => {
    const { jobId } = req.body;
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    updateJobStatus(jobId, "DONE");
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Generate demo card in background on startup (non-blocking)
    generateDemoCard().catch((e) => console.error("Demo card gen failed:", e));
  });
}

// ─── Demo card ───────────────────────────────────────────────────────────────
// Generated once on startup using a hardcoded SVG portrait — no AI call needed.
const DEMO_JOB_ID = "demo-card-v3";

async function generateDemoCard() {
  const existing = getJob(DEMO_JOB_ID);
  if (existing?.bg_layer_b64) return; // already generated

  // Insert a placeholder job row (skip player_number sequence)
  db.prepare(`
    INSERT OR IGNORE INTO jobs (id, status, name_input, city_input, district, player_number)
    VALUES (?, 'CREATED', 'ALEX NOVA', 'SOLARA CITY', 'NEON QUARTER', 0)
  `).run(DEMO_JOB_ID);

  // Demo portrait: graphic-novel silhouette with amber key light + chrome/teal rim light
  const demoPortraitSvg = `
    <svg width="260" height="300" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg-demo" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stop-color="#003d4f"/>
          <stop offset="100%" stop-color="#070d14"/>
        </linearGradient>
        <radialGradient id="amber-key" cx="25%" cy="88%" r="65%">
          <stop offset="0%" stop-color="#ff6b1a" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#ff6b1a" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="chrome-rim" cx="82%" cy="15%" r="55%">
          <stop offset="0%" stop-color="#a0dde8" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#a0dde8" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="face-shade" x1="30%" y1="95%" x2="70%" y2="5%">
          <stop offset="0%" stop-color="#3d1a0a"/>
          <stop offset="40%" stop-color="#1e0f08"/>
          <stop offset="100%" stop-color="#0c1a1e"/>
        </linearGradient>
        <radialGradient id="face-hi" cx="30%" cy="75%" r="40%">
          <stop offset="0%" stop-color="#ffc94a" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
        </radialGradient>
        <filter id="sf"><feGaussianBlur stdDeviation="2"/></filter>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.8" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="260" height="300" fill="url(#bg-demo)"/>
      <rect width="260" height="300" fill="url(#amber-key)"/>
      <rect width="260" height="300" fill="url(#chrome-rim)"/>
      <!-- Shoulders -->
      <path d="M -10 300 Q 28 256 76 238 Q 104 228 130 226 Q 156 228 184 238 Q 232 256 270 300 Z" fill="#0a1a1e"/>
      <path d="M 18 300 Q 52 260 96 245 Q 115 239 130 237 Q 145 239 164 245 Q 208 260 242 300 Z" fill="#0e2028"/>
      <path d="M 76 238 Q 104 228 130 226" fill="none" stroke="#ff6b1a" stroke-width="1.2" stroke-opacity="0.4"/>
      <!-- Neck -->
      <path d="M 115 224 Q 113 231 130 236 Q 147 231 145 224 L 142 205 Q 140 199 130 198 Q 120 199 118 205 Z" fill="#0d1e24"/>
      <path d="M 115 224 Q 113 231 130 236" fill="none" stroke="#ff6b1a" stroke-width="1" stroke-opacity="0.35" filter="url(#sf)"/>
      <!-- Head -->
      <ellipse cx="130" cy="136" rx="78" ry="92" fill="#08141a"/>
      <!-- Hair -->
      <path d="M 52 136 Q 54 52 130 44 Q 206 52 208 136 L 202 108 Q 196 56 160 46 Q 146 42 130 42 Q 114 42 100 46 Q 64 56 58 108 Z" fill="#061018"/>
      <path d="M 60 100 Q 72 66 102 52" fill="none" stroke="#a0dde8" stroke-width="1.8" stroke-opacity="0.28"/>
      <path d="M 158 52 Q 188 66 200 100" fill="none" stroke="#a0dde8" stroke-width="1.8" stroke-opacity="0.2"/>
      <!-- Face -->
      <ellipse cx="130" cy="148" rx="66" ry="76" fill="url(#face-shade)"/>
      <ellipse cx="130" cy="148" rx="66" ry="76" fill="url(#face-hi)"/>
      <!-- Amber rim left (key) -->
      <path d="M 64 106 Q 54 146 64 194" fill="none" stroke="#ff6b1a" stroke-width="3.5" stroke-opacity="0.55" filter="url(#sf)"/>
      <path d="M 69 110 Q 60 148 69 190" fill="none" stroke="#ffc94a" stroke-width="1.8" stroke-opacity="0.4"/>
      <!-- Chrome rim right -->
      <path d="M 196 106 Q 206 146 196 194" fill="none" stroke="#e8f4f8" stroke-width="3" stroke-opacity="0.38" filter="url(#sf)"/>
      <path d="M 191 109 Q 200 146 191 191" fill="none" stroke="#a0dde8" stroke-width="1.5" stroke-opacity="0.32"/>
      <!-- Eyebrows -->
      <path d="M 93 120 Q 108 113 123 115" fill="none" stroke="rgba(200,180,140,0.55)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M 137 115 Q 152 113 167 120" fill="none" stroke="rgba(200,180,140,0.55)" stroke-width="2.2" stroke-linecap="round"/>
      <!-- Eyes amber/gold iris -->
      <g filter="url(#glow)">
        <ellipse cx="110" cy="137" rx="15" ry="8.5" fill="#0c1c20"/>
        <ellipse cx="110" cy="137" rx="12" ry="5.8" fill="#8b5e1a" opacity="0.9"/>
        <ellipse cx="110" cy="137" rx="12" ry="5.8" fill="#ffc94a" opacity="0.52"/>
        <ellipse cx="150" cy="137" rx="15" ry="8.5" fill="#0c1c20"/>
        <ellipse cx="150" cy="137" rx="12" ry="5.8" fill="#8b5e1a" opacity="0.9"/>
        <ellipse cx="150" cy="137" rx="12" ry="5.8" fill="#ffc94a" opacity="0.52"/>
      </g>
      <ellipse cx="110" cy="137" rx="4.5" ry="4.5" fill="#060e10" opacity="0.82"/>
      <ellipse cx="150" cy="137" rx="4.5" ry="4.5" fill="#060e10" opacity="0.82"/>
      <ellipse cx="106" cy="134" rx="3.2" ry="2.2" fill="white" opacity="0.72"/>
      <ellipse cx="146" cy="134" rx="3.2" ry="2.2" fill="white" opacity="0.72"/>
      <path d="M 98 142 Q 110 147 122 142" fill="none" stroke="#ff6b1a" stroke-width="0.8" stroke-opacity="0.5"/>
      <path d="M 138 142 Q 150 147 162 142" fill="none" stroke="#ff6b1a" stroke-width="0.8" stroke-opacity="0.5"/>
      <!-- Nose -->
      <path d="M 123 150 L 118 168 Q 126 172 130 172 Q 134 172 142 168 L 137 150" fill="none" stroke="rgba(255,180,80,0.1)" stroke-width="1.2" stroke-linecap="round"/>
      <ellipse cx="120" cy="169" rx="3.2" ry="2.6" fill="rgba(80,50,20,0.5)"/>
      <ellipse cx="140" cy="169" rx="3.2" ry="2.6" fill="rgba(80,50,20,0.5)"/>
      <!-- Lips -->
      <path d="M 106 190 Q 118 184 130 185 Q 142 184 154 190 Q 142 202 130 204 Q 118 202 106 190 Z" fill="#3d1a08" opacity="0.95"/>
      <path d="M 106 190 Q 118 183 130 184 Q 142 183 154 190" fill="none" stroke="#ff6b1a" stroke-width="1.4" stroke-opacity="0.6"/>
      <!-- Jaw amber catch-light -->
      <path d="M 76 200 Q 102 220 130 224 Q 158 220 184 200" fill="none" stroke="#ff6b1a" stroke-width="1.8" stroke-opacity="0.26" filter="url(#sf)"/>
      <ellipse cx="130" cy="214" rx="26" ry="7" fill="#ff6b1a" opacity="0.1" filter="url(#sf)"/>
    </svg>
  `;

  const maskSvg = Buffer.from(
    '<svg width="520" height="600" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg"><rect width="260" height="300" rx="12" ry="12" fill="white"/></svg>'
  );

  const portraitBuffer = await sharp(Buffer.from(demoPortraitSvg))
    .resize(520, 600, { fit: "fill" })
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Guilloche grain lines — same as buildCardInBackground
  const guillocheLines = (() => {
    let paths = "";
    for (let y = 0; y <= 533; y += 11) {
      let d = `M 0 ${y}`;
      for (let x = 0; x <= 400; x += 8) {
        const dy = Math.sin((x / 400) * Math.PI * 6 + (y / 11)) * 2.5;
        d += ` L ${x} ${y + dy}`;
      }
      paths += `<path d="${d}" fill="none" stroke="rgba(0,61,79,0.12)" stroke-width="0.4"/>`;
    }
    for (let x = 0; x <= 400; x += 13) {
      let d = `M ${x} 0`;
      for (let y = 0; y <= 533; y += 8) {
        const dx = Math.sin((y / 533) * Math.PI * 8 + (x / 13)) * 2;
        d += ` L ${x + dx} ${y}`;
      }
      paths += `<path d="${d}" fill="none" stroke="rgba(255,107,26,0.04)" stroke-width="0.4"/>`;
    }
    return paths;
  })();

  // Bureau Seal — same as buildCardInBackground
  const bureauSeal = (() => {
    const cx = 377, cy = 25, r = 19;
    const ticks = Array.from({length: 8}, (_, i) => {
      const a = (i * 45 - 90) * Math.PI / 180;
      return `<line x1="${(cx + Math.cos(a) * r).toFixed(1)}" y1="${(cy + Math.sin(a) * r).toFixed(1)}" x2="${(cx + Math.cos(a) * (r-5)).toFixed(1)}" y2="${(cy + Math.sin(a) * (r-5)).toFixed(1)}" stroke="#ffc94a" stroke-width="0.9"/>`;
    }).join('');
    const starR = r - 8, innerR = (r - 8) * 0.42;
    let pts = '';
    for (let i = 0; i < 6; i++) {
      const oa = (i * 60 - 90) * Math.PI / 180;
      const ia = ((i + 0.5) * 60 - 90) * Math.PI / 180;
      pts += `${(cx + Math.cos(oa) * starR).toFixed(1)},${(cy + Math.sin(oa) * starR).toFixed(1)} `;
      pts += `${(cx + Math.cos(ia) * innerR).toFixed(1)},${(cy + Math.sin(ia) * innerR).toFixed(1)} `;
    }
    return `<g opacity="0.88"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffc94a" stroke-width="0.9"/>${ticks}<polygon points="${pts.trim()}" fill="#ffc94a" opacity="0.62"/><text x="${cx}" y="${(cy + 3.5).toFixed(1)}" font-family="Impact,'Arial Black',sans-serif" font-size="6" fill="#ffc94a" text-anchor="middle" font-weight="900">SC</text></g>`;
  })();

  // Fake barcode — same as buildCardInBackground
  const barcodeLines = (() => {
    const pat = [2,1,3,1,2,1,1,3,2,1,1,2,3,1,1,2,1,3,2,1,1,2,1,1,3];
    const total = pat.reduce((a,b) => a+b, 0);
    const scale = 100 / total;
    let cx = 20, out = '';
    pat.forEach((u, i) => {
      const w = (u * scale).toFixed(1);
      if (i % 2 === 0) out += `<rect x="${cx.toFixed(1)}" y="478" width="${w}" height="24" fill="#4a6b7a" opacity="0.5"/>`;
      cx += u * scale;
    });
    return out;
  })();

  const sharedDefs = `
    <defs>
      <linearGradient id="bg-main" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#003d4f"/>
        <stop offset="100%" stop-color="#070d14"/>
      </linearGradient>
      <linearGradient id="amber-coral" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#ff6b1a"/>
        <stop offset="100%" stop-color="#ff3d5a"/>
      </linearGradient>
      <linearGradient id="holo-strip" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#ff00aa"/>
        <stop offset="25%"  stop-color="#00ffdd"/>
        <stop offset="50%"  stop-color="#ffee00"/>
        <stop offset="75%"  stop-color="#aa00ff"/>
        <stop offset="100%" stop-color="#ff00aa"/>
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#ffc94a"/>
        <stop offset="50%"  stop-color="#ffe08a"/>
        <stop offset="100%" stop-color="#d4961f"/>
      </linearGradient>
      <radialGradient id="portrait-glow" cx="50%" cy="28%" r="40%">
        <stop offset="0%"   stop-color="#ff6b1a" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#070d14" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="edge-dark" cx="50%" cy="50%" r="65%">
        <stop offset="55%"  stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>
      </radialGradient>
      <clipPath id="card-clip"><rect width="400" height="533" rx="18"/></clipPath>
    </defs>
  `;

  const bgSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <g clip-path="url(#card-clip)">
        <rect width="400" height="533" fill="url(#bg-main)"/>
        ${guillocheLines}
        <rect x="60" y="44" width="280" height="310" fill="url(#portrait-glow)" rx="14"/>
        <rect x="-200" y="322" width="800" height="32" fill="url(#holo-strip)" opacity="0.14"
              transform="rotate(-35, 200, 338)"/>
        <rect width="400" height="533" fill="url(#edge-dark)"/>
      </g>
    </svg>
  `;

  const frameSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <defs>
        <mask id="portrait-window">
          <rect width="400" height="533" rx="18" fill="white"/>
          <rect x="70" y="50" width="260" height="300" rx="12" fill="black"/>
        </mask>
      </defs>
      <rect width="400" height="533" fill="rgba(0,30,42,0.55)" rx="18" mask="url(#portrait-window)"/>
      <rect width="400" height="533" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="18"/>
      <rect x="69" y="49" width="262" height="302" rx="13" fill="none" stroke="url(#amber-coral)" stroke-width="2"/>
      <text x="20" y="31"
        fill="#ff6b1a" font-family="Impact,'Arial Black',sans-serif"
        font-size="19" font-weight="900" letter-spacing="4">SOLARA CITY</text>
      <text x="20" y="43"
        fill="#e8f4f8" font-family="Arial,sans-serif"
        font-size="7.5" letter-spacing="3.5" opacity="0.5">BUREAU OF RESIDENTS</text>
      ${bureauSeal}
      <rect x="0" y="50" width="400" height="0.6" fill="rgba(255,107,26,0.3)"/>
      <rect x="16" y="400" width="368" height="0.5" fill="rgba(255,255,255,0.07)"/>
      <rect x="16" y="416" width="368" height="0.3" fill="rgba(255,255,255,0.05)"/>
      <text x="20" y="430" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">RESIDENT ID</text>
      <text x="20" y="444" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">DISTRICT</text>
      <text x="20" y="458" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">CLEARANCE</text>
      <text x="20" y="472" fill="#4a6b7a" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">ISSUED</text>
      <rect x="0" y="478" width="400" height="0.5" fill="rgba(255,255,255,0.06)"/>
      ${barcodeLines}
      <text x="384" y="498"
        fill="#b8ff3c" font-family="'Courier New',monospace"
        font-size="7.5" text-anchor="end" letter-spacing="1.5" font-weight="700">STATUS: VERIFIED ✦</text>
      <text x="200" y="526"
        fill="rgba(255,255,255,0.12)" font-family="monospace"
        font-size="4" text-anchor="middle" letter-spacing="0.8">
        SOLARA CITY BUREAU OF RESIDENTS ✦ OFFICIAL DOCUMENT ✦ SC-2025
      </text>
    </svg>
  `;

  const textSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <text x="338" y="31"
        fill="rgba(255,107,26,0.45)" font-family="'Courier New',monospace"
        font-size="7" text-anchor="end" letter-spacing="1">#0000</text>
      <text x="20" y="383"
        fill="#e8f4f8" font-family="Impact,'Arial Black',sans-serif"
        font-size="26" font-weight="900" letter-spacing="3">ALEX NOVA</text>
      <text x="20" y="397"
        fill="#4a6b7a" font-family="Arial,sans-serif"
        font-size="10.5" letter-spacing="2">SOLARA CITY</text>
      <text x="135" y="430"
        fill="#e8f4f8" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">SC-00000000</text>
      <text x="135" y="444"
        fill="#e8f4f8" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">NEON QUARTER</text>
      <text x="135" y="458"
        fill="#b8ff3c" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1">UNRESTRICTED</text>
      <text x="135" y="472"
        fill="#e8f4f8" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">2025</text>
    </svg>
  `;

  const bgBuffer    = await sharp(Buffer.from(bgSvg)).png().toBuffer();
  const frameBuffer = await sharp(Buffer.from(frameSvg)).png().toBuffer();
  const textBuffer  = await sharp(Buffer.from(textSvg)).png().toBuffer();

  saveJobLayers(
    DEMO_JOB_ID,
    bgBuffer.toString("base64"),
    frameBuffer.toString("base64"),
    portraitBuffer.toString("base64"),
    textBuffer.toString("base64"),
  );

  updateJobStatus(DEMO_JOB_ID, "DONE");
  console.log("Demo card generated successfully.");
}

startServer().catch(console.error);
