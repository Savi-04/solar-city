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
            text: `Retain the original facial features, expression, and structure of the subject, but upgrade the lighting and textures to match a high-end AAA video game cinematic. Apply an Unreal Engine 5 rendering style with incredibly detailed 3D textures, subsurface scattering, and cinematic volumetric lighting. Illuminate the subject with dramatic dual rim lighting—neon magenta on one side, electric cyan on the other. The background should be a dark, moody atmospheric sci-fi void. The final result must look like premium video game promotional art while remaining completely recognizable as the original subject. 8k resolution, masterpiece quality.`,
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

      const portraitLayerBuffer = await sharp({
        create: { width: 800, height: 1066, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      })
      .composite([{ input: portraitBuffer, top: 100, left: 140 }])
      .png()
      .toBuffer();

      saveJobLayers(jobId, bgBuffer.toString("base64"), frameBuffer.toString("base64"), portraitLayerBuffer.toString("base64"), textBuffer.toString("base64"));
      
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
      const isDemoCard = req.params.id === "demo-card-v6";
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
const DEMO_JOB_ID = "demo-card-v6";

async function generateDemoCard() {
  const existing = getJob(DEMO_JOB_ID);
  if (existing?.bg_layer_b64) return; // already generated

  // Insert a placeholder job row (skip player_number sequence)
  db.prepare(`
    INSERT OR IGNORE INTO jobs (id, status, name_input, city_input, district, player_number)
    VALUES (?, 'CREATED', 'ALEX NOVA', 'SOLARA CITY', 'NEON QUARTER', 0)
  `).run(DEMO_JOB_ID);

  // Demo portrait: gamified character with teal hair, dual-color glowing eyes, cyberpunk jacket
  const demoPortraitSvg = `
    <svg width="260" height="300" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg-demo" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stop-color="#002830"/>
          <stop offset="100%" stop-color="#050a10"/>
        </linearGradient>
        <linearGradient id="skin-g" x1="30%" y1="100%" x2="70%" y2="0%">
          <stop offset="0%" stop-color="#c47a3a"/>
          <stop offset="55%" stop-color="#d4894a"/>
          <stop offset="100%" stop-color="#8a4a22"/>
        </linearGradient>
        <linearGradient id="hair-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#006878"/>
          <stop offset="50%" stop-color="#003d4f"/>
          <stop offset="100%" stop-color="#002030"/>
        </linearGradient>
        <radialGradient id="amber-key" cx="20%" cy="92%" r="70%">
          <stop offset="0%" stop-color="#ff6b1a" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#ff6b1a" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="cyan-rim" cx="88%" cy="8%" r="62%">
          <stop offset="0%" stop-color="#00e8ff" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#00e8ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="lime-top" cx="50%" cy="0%" r="45%">
          <stop offset="0%" stop-color="#b8ff3c" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#b8ff3c" stop-opacity="0"/>
        </radialGradient>
        <filter id="sf"><feGaussianBlur stdDeviation="2"/></filter>
        <filter id="sf3"><feGaussianBlur stdDeviation="3.5"/></filter>
        <filter id="glow-a">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-c">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- Background -->
      <rect width="260" height="300" fill="url(#bg-demo)"/>
      <rect width="260" height="300" fill="url(#amber-key)"/>
      <rect width="260" height="300" fill="url(#cyan-rim)"/>
      <rect width="260" height="300" fill="url(#lime-top)"/>

      <!-- Subtle bg circuit lines -->
      <g opacity="0.07" stroke="#00e8ff" stroke-width="0.5" fill="none">
        <path d="M 18 210 L 18 228 L 36 228 L 36 240"/>
        <path d="M 242 190 L 242 208 L 224 208 L 224 220"/>
        <circle cx="36" cy="240" r="2" fill="#00e8ff" stroke="none"/>
        <circle cx="224" cy="220" r="2" fill="#00e8ff" stroke="none"/>
        <path d="M 8 260 L 30 260 L 30 270 L 50 270"/>
        <path d="M 252 270 L 230 270 L 230 258 L 210 258"/>
      </g>

      <!-- Jacket / shoulders -->
      <path d="M -15 300 Q 30 252 78 232 Q 106 220 130 218 Q 154 220 182 232 Q 230 252 275 300 Z" fill="#0a1820"/>
      <!-- Jacket inner panels -->
      <path d="M 78 232 Q 100 222 114 232 L 110 268 Q 104 278 94 275 Z" fill="#0d2230"/>
      <path d="M 182 232 Q 160 222 146 232 L 150 268 Q 156 278 166 275 Z" fill="#0d2230"/>
      <!-- Jacket tech panel lines -->
      <path d="M 28 290 Q 54 258 78 238" stroke="#00c6d4" stroke-width="1.2" fill="none" opacity="0.55"/>
      <path d="M 232 290 Q 206 258 182 238" stroke="#00c6d4" stroke-width="1.2" fill="none" opacity="0.55"/>
      <path d="M 40 300 Q 68 268 96 248" stroke="#ff6b1a" stroke-width="0.7" fill="none" opacity="0.38"/>
      <path d="M 220 300 Q 192 268 164 248" stroke="#ff6b1a" stroke-width="0.7" fill="none" opacity="0.38"/>
      <!-- Collar amber trim -->
      <path d="M 78 232 Q 106 221 130 219 Q 154 221 182 232" stroke="#ff6b1a" stroke-width="1.5" fill="none" opacity="0.75"/>
      <!-- Jacket shoulder amber glow -->
      <path d="M 50 280 Q 70 256 90 240" stroke="#ff6b1a" stroke-width="3" fill="none" opacity="0.18" filter="url(#sf)"/>
      <path d="M 210 280 Q 190 256 170 240" stroke="#ff6b1a" stroke-width="3" fill="none" opacity="0.18" filter="url(#sf)"/>
      <!-- Small tech badge left shoulder -->
      <rect x="52" y="260" width="18" height="10" rx="2" fill="#003d4f" stroke="#00c6d4" stroke-width="0.6" opacity="0.7"/>
      <rect x="55" y="263" width="6" height="1.5" rx="0.5" fill="#00e8ff" opacity="0.9"/>
      <rect x="55" y="266" width="10" height="1.5" rx="0.5" fill="#00e8ff" opacity="0.6"/>

      <!-- Neck -->
      <path d="M 113 217 Q 111 226 130 232 Q 149 226 147 217 L 144 200 Q 141 193 130 192 Q 119 193 116 200 Z" fill="#b87840"/>
      <path d="M 113 217 Q 111 226 130 232" stroke="#ff6b1a" stroke-width="1.2" fill="none" opacity="0.65"/>
      <!-- Cyan neck shadow right -->
      <path d="M 147 217 Q 149 226 130 232" stroke="#00c6d4" stroke-width="0.8" fill="none" opacity="0.4"/>

      <!-- Head base — warm skin -->
      <ellipse cx="130" cy="132" rx="76" ry="88" fill="url(#skin-g)"/>

      <!-- Cyan rim light on face right -->
      <path d="M 196 88 Q 212 132 196 178" stroke="#00e8ff" stroke-width="9" fill="none" opacity="0.28" filter="url(#sf)"/>
      <path d="M 191 92 Q 205 132 191 174" stroke="#a0eeff" stroke-width="2.5" fill="none" opacity="0.55"/>

      <!-- Amber key light on face left -->
      <path d="M 64 88 Q 48 132 64 178" stroke="#ff6b1a" stroke-width="9" fill="none" opacity="0.45" filter="url(#sf)"/>
      <path d="M 69 92 Q 55 132 69 174" stroke="#ffa040" stroke-width="2.5" fill="none" opacity="0.65"/>

      <!-- TEAL/CYAN HAIR — bold, stylized -->
      <!-- Hair mass -->
      <path d="M 54 132 Q 56 44 130 36 Q 204 44 206 132 L 200 100 Q 192 46 158 38 Q 144 34 130 34 Q 116 34 102 38 Q 68 46 60 100 Z" fill="url(#hair-g)"/>
      <!-- Hair volume depth -->
      <path d="M 60 100 Q 56 66 82 48 Q 107 33 130 32 Q 153 33 178 48 Q 204 66 200 100" fill="#002838" opacity="0.75"/>
      <!-- Hair top highlight (cyan) -->
      <path d="M 98 38 Q 130 26 162 38" stroke="#00c6d4" stroke-width="3.5" fill="none" opacity="0.8" stroke-linecap="round"/>
      <path d="M 108 34 Q 130 28 152 34" stroke="#00e8ff" stroke-width="1.5" fill="none" opacity="0.6"/>
      <!-- Hair side sheen -->
      <path d="M 56 80 Q 68 52 104 42" stroke="#00c6d4" stroke-width="2.5" fill="none" opacity="0.65" stroke-linecap="round"/>
      <path d="M 204 80 Q 192 52 156 42" stroke="#00c6d4" stroke-width="2.5" fill="none" opacity="0.5" stroke-linecap="round"/>
      <!-- Lime hair crown accent -->
      <path d="M 112 36 Q 130 28 148 36" stroke="#b8ff3c" stroke-width="1.5" fill="none" opacity="0.55"/>
      <circle cx="130" cy="27" r="2" fill="#b8ff3c" opacity="0.6"/>
      <!-- Hair strands loose -->
      <path d="M 54 130 Q 50 158 53 190" stroke="#006878" stroke-width="2.5" fill="none" opacity="0.5"/>
      <path d="M 206 130 Q 210 158 207 190" stroke="#006878" stroke-width="2.5" fill="none" opacity="0.4"/>

      <!-- Eyebrows — bold dark arches -->
      <path d="M 88 110 Q 106 101 124 104" stroke="#1a1008" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>
      <path d="M 136 104 Q 154 101 172 110" stroke="#1a1008" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>
      <!-- Brow highlight -->
      <path d="M 90 109 Q 107 102 123 105" stroke="#c47a3a" stroke-width="1" fill="none" opacity="0.35"/>

      <!-- LEFT EYE — amber/gold glowing -->
      <ellipse cx="107" cy="128" rx="18" ry="11" fill="#1a0800"/>
      <ellipse cx="107" cy="128" rx="14" ry="7.5" fill="#8b3c00"/>
      <ellipse cx="107" cy="128" rx="14" ry="7.5" fill="#ff8020" opacity="0.65"/>
      <ellipse cx="107" cy="128" rx="9" ry="5" fill="#ffb840" opacity="0.75"/>
      <ellipse cx="107" cy="128" rx="5" ry="5" fill="#0a0502"/>
      <ellipse cx="107" cy="128" rx="15" ry="8" fill="none" stroke="#ff6b1a" stroke-width="1" opacity="0.9" filter="url(#glow-a)"/>
      <!-- Amber eye glow bloom -->
      <ellipse cx="107" cy="128" rx="18" ry="11" fill="#ff6b1a" opacity="0.08" filter="url(#sf3)"/>
      <!-- Left eye specular -->
      <ellipse cx="102" cy="124" rx="3.5" ry="2.5" fill="white" opacity="0.9"/>
      <ellipse cx="113" cy="131" rx="1.5" ry="1" fill="white" opacity="0.5"/>

      <!-- RIGHT EYE — cyan glowing -->
      <ellipse cx="153" cy="128" rx="18" ry="11" fill="#000a10"/>
      <ellipse cx="153" cy="128" rx="14" ry="7.5" fill="#006070"/>
      <ellipse cx="153" cy="128" rx="14" ry="7.5" fill="#00d4e8" opacity="0.6"/>
      <ellipse cx="153" cy="128" rx="9" ry="5" fill="#60f0ff" opacity="0.7"/>
      <ellipse cx="153" cy="128" rx="5" ry="5" fill="#020a0c"/>
      <ellipse cx="153" cy="128" rx="15" ry="8" fill="none" stroke="#00e8ff" stroke-width="1" opacity="0.9" filter="url(#glow-c)"/>
      <!-- Cyan eye glow bloom -->
      <ellipse cx="153" cy="128" rx="18" ry="11" fill="#00e8ff" opacity="0.07" filter="url(#sf3)"/>
      <!-- Right eye specular -->
      <ellipse cx="148" cy="124" rx="3.5" ry="2.5" fill="white" opacity="0.9"/>
      <ellipse cx="159" cy="131" rx="1.5" ry="1" fill="white" opacity="0.5"/>

      <!-- Under-eye eyelashes suggestion -->
      <path d="M 93 135 Q 107 140 121 135" fill="none" stroke="#ff6b1a" stroke-width="0.7" opacity="0.4"/>
      <path d="M 139 135 Q 153 140 167 135" fill="none" stroke="#00e8ff" stroke-width="0.7" opacity="0.4"/>

      <!-- Nose — minimal, warm -->
      <path d="M 122 145 L 118 162 Q 126 167 130 167 Q 134 167 142 162 L 138 145" fill="none" stroke="#8a4010" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
      <ellipse cx="120" cy="163" rx="3" ry="2.4" fill="#7a3808" opacity="0.55"/>
      <ellipse cx="140" cy="163" rx="3" ry="2.4" fill="#7a3808" opacity="0.55"/>

      <!-- Lips — warm, defined -->
      <path d="M 108 184 Q 119 177 130 178 Q 141 177 152 184 Q 141 197 130 199 Q 119 197 108 184 Z" fill="#9a3818" opacity="0.95"/>
      <path d="M 108 184 Q 119 176 130 177 Q 141 176 152 184" stroke="#ff6b1a" stroke-width="1.6" fill="none" opacity="0.72"/>
      <path d="M 117 180 Q 130 176 143 180" stroke="rgba(255,160,80,0.4)" stroke-width="1.5" fill="none"/>

      <!-- Cheek blush — amber -->
      <ellipse cx="88" cy="150" rx="20" ry="11" fill="#ff6b1a" opacity="0.1" filter="url(#sf)"/>
      <!-- Cheek blush — cyan right -->
      <ellipse cx="172" cy="150" rx="20" ry="11" fill="#00c6d4" opacity="0.08" filter="url(#sf)"/>

      <!-- Jaw amber glow -->
      <path d="M 74 196 Q 102 216 130 220 Q 158 216 186 196" fill="none" stroke="#ff6b1a" stroke-width="2" opacity="0.28" filter="url(#sf)"/>

      <!-- Cyberpunk facial mark — small teal triangles under right eye -->
      <polygon points="168,142 174,138 174,146" fill="#00e8ff" opacity="0.65"/>
      <polygon points="176,144 180,141 180,147" fill="#00e8ff" opacity="0.4"/>

      <!-- Forehead circuit accent (lime) -->
      <path d="M 116 72 L 130 66 L 144 72" stroke="#b8ff3c" stroke-width="0.8" fill="none" opacity="0.5"/>
      <circle cx="130" cy="65" r="2" fill="#b8ff3c" opacity="0.6"/>
      <path d="M 123 69 L 137 69" stroke="#b8ff3c" stroke-width="0.5" fill="none" opacity="0.3"/>
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

  const portraitLayerBuffer = await sharp({
    create: { width: 800, height: 1066, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
  .composite([{ input: portraitBuffer, top: 100, left: 140 }])
  .png()
  .toBuffer();

  saveJobLayers(
    DEMO_JOB_ID,
    bgBuffer.toString("base64"),
    frameBuffer.toString("base64"),
    portraitLayerBuffer.toString("base64"),
    textBuffer.toString("base64"),
  );

  updateJobStatus(DEMO_JOB_ID, "DONE");
  console.log("Demo card generated successfully.");
}

startServer().catch(console.error);
