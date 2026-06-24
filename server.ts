import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";
import { readFileSync } from "fs";

fal.config({ credentials: process.env.FAL_KEY });
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

  // fal.ai proxy — must be before express.json() so raw body is not pre-consumed
  app.use("/api/fal/proxy", express.raw({ type: "*/*", limit: "50mb" }), async (req: any, res: any) => {
    const targetUrl = req.headers["x-fal-target-url"] as string;
    if (!targetUrl) { res.status(400).json({ error: "Missing x-fal-target-url" }); return; }
    const headers: Record<string, string> = { "Authorization": `Key ${process.env.FAL_KEY}` };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"] as string;
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.status(response.status);
    const ct = response.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(buffer);
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(helmet({ contentSecurityPolicy: false }));

  const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Too many requests, try again later" } });
  const jobLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Step A: Upload & Validate
  app.post("/api/upload", uploadLimiter, async (req, res) => {
    try {
      let { selfie_url, name, city, age_confirmed, ownership_confirmed, privacy_accepted } = req.body;
      if (!selfie_url) return res.status(400).json({ error: "No image provided" });

      // SSRF guard — only allow fal.media CDN URLs
      try {
        const parsed = new URL(selfie_url);
        const allowed = ["fal.media", "storage.fal.ai"];
        if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
          return res.status(400).json({ error: "Invalid image source" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid image URL" });
      }
      name = (name || "UNKNOWN").slice(0, 50);
      city = (city || "UNKNOWN").slice(0, 50);

      if (!age_confirmed || !ownership_confirmed || !privacy_accepted) {
        return res.status(400).json({ error: "Consent required" });
      }

      const jobId = crypto.randomUUID();
      const playerNumber = createJob(jobId, name, city);
      const rawIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
      const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");
      logConsent(jobId, age_confirmed === "true", ownership_confirmed === "true", privacy_accepted === "true", ipHash);

      // Fetch image from fal CDN for moderation (server-to-server, fast)
      let modResult = "ACCEPT";
      try {
        const imgRes = await fetch(selfie_url);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const base64Image = imgBuffer.toString("base64");
        const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
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

      res.json({ jobId, playerNumber });

      const job = getJob(jobId);
      const district = job?.district || 'SUNRISE COAST';
      buildCardInBackground(jobId, name, city, district, playerNumber, selfie_url).catch((err) => {
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
    imageUrl: string
  ) {
    let stylizedBase64: string | null = null;

    try {
      const result = await fal.subscribe("fal-ai/nano-banana-2/edit", {
        input: {
          prompt: `Apply a high-end AAA video game lighting and texture pass directly over the original photo. Crucially, the underlying facial geometry, bone structure, features, and identity of the subject must remain completely unaltered from the input image. Do not redraw the face; only upgrade the surface rendering quality. Apply an Unreal Engine 5 rendering style, highly detailed subsurface scattering, and cinematic volumetric lighting. Illuminate the subject with dramatic dual rim lighting—neon magenta on one side, electric cyan on the other. Dark atmospheric sci-fi background. The final result must look exactly like the original person standing inside a premium 3D video game cinematic.`,
          image_urls: [imageUrl],
        },
        logs: true,
      }) as any;

      const outputUrl: string | undefined =
        result?.data?.images?.[0]?.url ?? result?.data?.image?.url;

      if (outputUrl) {
        const imgRes = await fetch(outputUrl);
        const arrayBuf = await imgRes.arrayBuffer();
        stylizedBase64 = Buffer.from(arrayBuf).toString("base64");
      }
    } catch (err: any) {
      console.error("Image stylization failed, falling back to original", err);
    }

    // Fall back to original if stylization failed
    if (!stylizedBase64) {
      const imgRes = await fetch(imageUrl);
      const arrayBuf = await imgRes.arrayBuffer();
      stylizedBase64 = Buffer.from(arrayBuf).toString("base64");
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
      const [bgBuffer, frameBuffer, textBuffer] = await Promise.all([
        sharp(Buffer.from(bgSvg)).png().toBuffer(),
        sharp(Buffer.from(frameSvg)).png().toBuffer(),
        sharp(Buffer.from(textSvg)).png().toBuffer(),
      ]);

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
  app.get("/api/jobs/:id/layers", jobLimiter, (req, res) => {
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
    app.get(`/api/jobs/:id/${layer}`, jobLimiter, (req, res) => {
      const job = getJob(req.params.id);
      if (!job || !job[`${layer}_layer_b64`]) return res.status(404).send("Not found");
      const buffer = Buffer.from(job[`${layer}_layer_b64`], "base64");
      res.setHeader("Content-Type", "image/png");
      // Demo card should never be cached — it regenerates on server restart
      const isDemoCard = req.params.id === "demo-card-v7";
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

  
  // Gumroad post-payment redirect — called via the ?wanted= URL parameter on the overlay link.
  // Marks the job DONE and redirects user to their card.
  // Only accepts jobs in PREVIEW_READY status to prevent replaying against arbitrary UUIDs.
  app.get("/api/gumroad/complete", (req: any, res: any) => {
    const jobId = req.query.job_id as string | undefined;
    if (!jobId) return res.redirect("/");

    const job = getJob(jobId);
    if (!job || job.status !== "PREVIEW_READY") {
      // Already DONE (e.g. double-redirect) — just send them to the card
      if (job?.status === "DONE") return res.redirect(`/card/${jobId}`);
      return res.redirect("/");
    }

    updateJobStatus(jobId, "DONE");
    res.redirect(`/card/${jobId}`);
  });

  // Gumroad account-level ping (fires for every sale) — used as belt-and-suspenders.
  // Without custom fields we can't identify the specific job here, so just acknowledge.
  app.post("/api/gumroad/webhook",
    express.urlencoded({ extended: true }),
    (req: any, res: any) => {
      const sellerId = req.body.seller_id as string | undefined;
      if (process.env.GUMROAD_SELLER_ID && sellerId !== process.env.GUMROAD_SELLER_ID) {
        return res.status(403).json({ error: "Invalid seller" });
      }
      res.json({ ok: true });
    }
  );

  // Dev-only checkout stub — disabled when GUMROAD_SELLER_ID is set (production)
  app.post("/api/checkout", async (req, res) => {
    if (process.env.GUMROAD_SELLER_ID) {
      return res.status(404).json({ error: "Not found" });
    }
    const { jobId } = req.body;
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    updateJobStatus(jobId, "DONE");
    res.json({ success: true });
  });

  // OG image — flat composite of the demo card for social link previews
  app.get("/api/og-image", async (req, res) => {
    try {
      const demo = getJob("demo-card-v7");
      if (demo?.bg_layer_b64 && demo?.portrait_layer_b64 && demo?.frame_layer_b64 && demo?.text_layer_b64) {
        const composite = await sharp(Buffer.from(demo.bg_layer_b64, "base64"))
          .composite([
            { input: Buffer.from(demo.portrait_layer_b64, "base64"), top: 0, left: 0 },
            { input: Buffer.from(demo.frame_layer_b64, "base64"), top: 0, left: 0 },
            { input: Buffer.from(demo.text_layer_b64, "base64"), top: 0, left: 0 },
          ])
          .jpeg({ quality: 88 })
          .toBuffer();
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.end(composite);
      }
    } catch (err) {
      console.error("OG image composite failed", err);
    }
    // Fallback: raw demo portrait while demo card is still generating
    const fallback = path.join(process.cwd(), "assets", "demo-portrait.png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(readFileSync(fallback));
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
    const indexHtml = readFileSync(path.join(distPath, "index.html"), "utf8");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      const base = `${req.protocol}://${req.get("host")}`;
      const html = indexHtml.replace(
        "</head>",
        `  <meta property="og:title" content="Solar City Card" />
  <meta property="og:description" content="Turn your selfie into a holographic game-art ID card" />
  <meta property="og:image" content="${base}/api/og-image" />
  <meta property="og:image:width" content="800" />
  <meta property="og:image:height" content="1066" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${base}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Solar City Card" />
  <meta name="twitter:description" content="Turn your selfie into a holographic game-art ID card" />
  <meta name="twitter:image" content="${base}/api/og-image" />
</head>`
      );
      res.setHeader("Content-Type", "text/html");
      res.send(html);
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
const DEMO_JOB_ID = "demo-card-v7";

async function generateDemoCard() {
  const existing = getJob(DEMO_JOB_ID);
  if (existing?.bg_layer_b64) return; // already generated

  // Insert a placeholder job row (skip player_number sequence)
  db.prepare(`
    INSERT OR IGNORE INTO jobs (id, status, name_input, city_input, district, player_number)
    VALUES (?, 'CREATED', 'ALEX NOVA', 'SOLARA CITY', 'NEON QUARTER', 0)
  `).run(DEMO_JOB_ID);

  // Demo portrait: real AI-generated image from assets/demo-portrait.png
  const demoPortraitPath = path.join(process.cwd(), "assets", "demo-portrait.png");
  const demoPortraitRaw = readFileSync(demoPortraitPath);

  const maskSvg = Buffer.from(
    '<svg width="520" height="600" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg"><rect width="260" height="300" rx="12" ry="12" fill="white"/></svg>'
  );

  const portraitBuffer = await sharp(demoPortraitRaw)
    .resize(520, 600, { fit: "cover", position: "top" })
    .modulate({ brightness: 1.08, saturation: 1.1 })
    .sharpen({ sigma: 0.8 })
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

function runCleanup() {
  db.prepare(`
    UPDATE jobs SET
      bg_layer_b64 = NULL, frame_layer_b64 = NULL,
      portrait_layer_b64 = NULL, text_layer_b64 = NULL,
      preview_base64 = NULL, unwatermarked_base64 = NULL
    WHERE created_at < datetime('now', '-7 days')
      AND (bg_layer_b64 IS NOT NULL OR preview_base64 IS NOT NULL)
  `).run();
  db.prepare(`DELETE FROM consent_log WHERE created_at < datetime('now', '-12 months')`).run();
}

runCleanup();
setInterval(runCleanup, 24 * 60 * 60 * 1000);

startServer().catch(console.error);
