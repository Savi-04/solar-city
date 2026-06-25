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
import { readFileSync, createReadStream } from "fs";
import * as fsPromises from "fs/promises";
import nodemailer from "nodemailer";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

fal.config({ credentials: process.env.FAL_KEY });
const videoGenInProgress = new Set<string>();     // character video — prevents double-charging
const cardVideoGenInProgress = new Set<string>(); // card product video
import {
  db,
  createJob,
  updateJobPreview,
  updateJobStatus,
  setJobOutput,
  getJob,
  saveJobLayers,
  saveVideoOnly,
  logConsent,
  getRegistryCount,
  setPublicId,
  getJobByPublicId,
  getLeaderboard,
  setBuyerEmail,
  incrementVideoAttempts,
  resetVideoAttempts,
  saveVideoError,
  incrementCardVideoAttempts,
  saveCardVideoOnly,
  saveCardVideoError,
  setDownloadToken,
} from "./src/db.ts";

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const SAFE_TEXT_RE = /^[^<>&"'`]+$/;

// Derive base URL once — used in all absolute URLs we send out
const BASE_URL =
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "https://solar-city-production.up.railway.app");

function sendCardEmail(to: string, cardUrl: string): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP not configured — skipping card email to", to);
    return Promise.resolve();
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter.sendMail({
    from: `"Solara City Bureau of Residents" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Solara City Resident ID is ready",
    text: `Your holographic ID card is ready.\n\nView it here: ${cardUrl}\n\nBookmark this link — it's permanent and unique to you.\n\n— Solara City Bureau of Residents`,
    html: `<div style="background:#05050d;color:#e8e0f5;font-family:monospace;padding:32px;max-width:480px;margin:auto;border-radius:12px"><h2 style="color:#ff6b1a;margin-top:0">Solara City Bureau of Residents</h2><p>Your holographic Resident ID is ready.</p><p style="margin:24px 0"><a href="${cardUrl}" style="background:#ff2060;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">VIEW MY CARD →</a></p><p style="font-size:12px;color:#888">Or copy this link: ${cardUrl}</p><p style="font-size:12px;color:#888">Bookmark it — this link is permanent and unique to you.</p></div>`,
  }).then(() => { console.log("Card email sent to", to); });
}

function generatePublicId(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b: number) => alpha[b % 32]).join('');
}

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
  app.set('trust proxy', 1);

  const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Too many requests, try again later" } });
  const jobLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

  // fal.ai proxy — must be before express.json() so raw body is not pre-consumed
  app.use("/api/fal/proxy", jobLimiter, express.raw({ type: "*/*", limit: "50mb" }), async (req: any, res: any) => {
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
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https://api.dicebear.com"],
        connectSrc: ["'self'", "https://open.er-api.com", "https://*.fal.run", "https://*.fal.ai", "https://fal.media", "https://*.fal.media"],
        frameSrc: ["'none'"],
        mediaSrc: ["'self'", "blob:"],
      }
    }
  }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Step A: Upload & Validate
  app.post("/api/upload", uploadLimiter, async (req, res) => {
    try {
      let { selfie_url, name, city, skill, age_confirmed, ownership_confirmed, privacy_accepted } = req.body;
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
      name = (name || "UNKNOWN").slice(0, 50).trim();
      city = (city || "UNKNOWN").slice(0, 50).trim();
      skill = (skill || "CITIZEN").slice(0, 30).trim();

      if (!SAFE_TEXT_RE.test(name) || !SAFE_TEXT_RE.test(city) || !SAFE_TEXT_RE.test(skill)) {
        return res.status(400).json({ error: "Name, city, and skill must not contain special characters (< > & \" ')" });
      }

      if (!age_confirmed || !ownership_confirmed || !privacy_accepted) {
        return res.status(400).json({ error: "Consent required" });
      }

      const { remaining } = getRegistryCount();
      if (remaining <= 0) return res.status(410).json({ error: "All 2,000 Solara City resident IDs have been issued." });

      const jobId = crypto.randomUUID();
      const completeToken = crypto.randomBytes(16).toString("hex");
      const playerNumber = createJob(jobId, name, city, skill, completeToken);
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

      res.json({ jobId, playerNumber, completeToken });

      const job = getJob(jobId);
      const district = job?.district || 'SUNRISE COAST';
      buildCardInBackground(jobId, name, city, skill, district, playerNumber, selfie_url).catch((err) => {
        console.error("Background card build failed", err);
        updateJobStatus(jobId, "FAILED");
      });

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Card generation failed. Please try again." });
    }
  });

  // Runs fully in background after upload responds
  async function buildCardInBackground(
    jobId: string, name: string, city: string,
    skill: string, district: string, playerNumber: number,
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
          font-size="${nameFontSize}" font-weight="900" letter-spacing="${nameLetterSpacing}">${escapeXml(name.toUpperCase())}</text>

        <!-- City: smaller, muted teal -->
        <text x="20" y="397"
          fill="#4a6b7a" font-family="Arial,sans-serif"
          font-size="10.5" letter-spacing="2">${escapeXml(city.toUpperCase())}</text>

        <!-- RESIDENT ID value -->
        <text x="135" y="430"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">${escapeXml(residentId)}</text>

        <!-- DISTRICT value -->
        <text x="135" y="444"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">${escapeXml(district)}</text>

        <!-- SKILL value -->
        <text x="135" y="458"
          fill="#b8ff3c" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1">${escapeXml(skill.toUpperCase())}</text>

        <!-- ISSUED value -->
        <text x="135" y="472"
          fill="#e8f4f8" font-family="'Courier New',monospace"
          font-size="7" letter-spacing="1" opacity="0.82">${new Date().toISOString().slice(0, 10)}</text>
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

  // ─── Video generation (fal.ai Kling O3 — VIDEO 3.0 Omni) ───────────────────
  // Pre-generate video silently as soon as a card is paid for.
  // Safe to call multiple times — guards against duplicates and already-done state.
  function triggerVideoIfReady(jobId: string): void {
    const job = getJob(jobId);
    if (!job || !job.bg_layer_b64 || !job.public_id) return;
    if (job.video_b64 === "DONE") return;
    if (videoGenInProgress.has(job.id)) return;
    videoGenInProgress.add(job.id);
    generateCardVideo(job.id)
      .catch(e => console.error(`[video] Pre-generation failed for ${job.id}:`, e))
      .finally(() => videoGenInProgress.delete(job.id));
  }

  // Generates (or returns existing) a cryptographically random download token.
  // Used to gate video downloads so only the card owner can download their assets.
  function ensureDownloadToken(jobId: string): string {
    const job = getJob(jobId);
    if (job?.download_token) return job.download_token;
    const token = crypto.randomBytes(24).toString('hex');
    setDownloadToken(jobId, token);
    return token;
  }

  // Validates the download token from a request. Returns true if access is allowed.
  // Legacy jobs (no token) are allowed through so existing users aren't locked out.
  // Admin secret in ?admin= query param bypasses token check for admin panel downloads.
  function checkDownloadToken(req: any, res: any, job: { download_token: string | null }): boolean {
    if (!job.download_token) return true; // legacy card — no token required
    if (process.env.ADMIN_SECRET && req.query.admin === process.env.ADMIN_SECRET) return true;
    const provided = req.query.owner as string | undefined;
    if (provided === job.download_token) return true;
    res.status(403).json({ error: "owner_required", message: "Check your email for the owner link to download your videos." });
    return false;
  }

  async function generateCardVideo(jobId: string): Promise<void> {
    const job = getJob(jobId);
    if (!job?.bg_layer_b64 || !job?.portrait_layer_b64 || !job?.frame_layer_b64 || !job?.text_layer_b64 || !job.public_id) {
      saveVideoError(jobId, "Card layers not found in DB — card may be incomplete");
      return;
    }

    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    await fsPromises.mkdir(videosDir, { recursive: true });
    const videoPath = path.join(videosDir, `${job.public_id}.mp4`);

    try {

    // Already generated — don't re-charge
    try { await fsPromises.access(videoPath); return; } catch {}

    console.log(`[video] Starting Kling O3 generation for ${jobId}`);

    // ── @Element1: portrait face (frontal image for Kling character identity lock) ──
    const portraitLayerBuf = Buffer.from(job.portrait_layer_b64, "base64");
    const { width: pW = 800, height: pH = 1066 } = await sharp(portraitLayerBuf).metadata();
    const canExtract = pW >= 660 && pH >= 700;
    const portraitFaceBuffer = canExtract
      ? await sharp(portraitLayerBuf)
          .extract({ left: 140, top: 100, width: 520, height: 600 })
          .resize(560, 646, { fit: "fill" })
          .jpeg({ quality: 95 })
          .toBuffer()
      : await sharp(portraitLayerBuf)
          .resize(560, 646, { fit: "cover" })
          .jpeg({ quality: 95 })
          .toBuffer();

    // ── @Image1: full card composite (800×1066, same as og-card) ─────────────
    const fullCardBuf = await sharp(Buffer.from(job.bg_layer_b64, "base64"))
      .composite([
        { input: Buffer.from(job.portrait_layer_b64, "base64") },
        { input: Buffer.from(job.frame_layer_b64, "base64") },
        { input: Buffer.from(job.text_layer_b64, "base64") },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    // Upload both images in parallel
    console.log(`[video] Uploading portrait + card for ${jobId}...`);
    const [portraitUrl, cardUrl] = await Promise.all([
      fal.storage.upload(new Blob([portraitFaceBuffer], { type: "image/jpeg" })),
      fal.storage.upload(new Blob([fullCardBuf], { type: "image/jpeg" })),
    ]);
    console.log(`[video] portrait → ${portraitUrl}`);
    console.log(`[video] card → ${cardUrl}`);

    // ── Call fal.ai Kling O3 Standard reference-to-video ────────────────────
    // Increment here — only counts when we actually hit the API, not on triggers/retries
    incrementVideoAttempts(jobId);

    // Keep prompt under ~2000 chars — Kling rejects longer prompts with 422
    const PROMPT = `Full-body shot, 9:16 vertical frame. @Image1 stands center-left, closer to camera, filling the lower two-thirds of the frame. Face and full body prominently visible and sharp.

CHARACTER CONSISTENCY — CRITICAL: Face, facial features, skin tone, hair, and every article of clothing must be reproduced IDENTICALLY from the portrait reference. Do not alter, substitute, redesign, or reinterpret any part of the outfit or appearance. The character looks exactly like the reference photo — only the lighting environment changes. Neutral confident stance, body completely still.

Background: Indoor private garage. Three luxury vehicles — sleek sports car (left), massive monster truck (center), luxury sedan (right). Chrome shelving and neon-lit display cases line the back wall. Thin wisps of transparent smoke drift slowly.

Lighting: Powerful three-point studio setup. Strong bright key light from upper-right illuminates character clearly — face fully lit, no shadows obscuring features. Warm fill on vehicles. Crisp rim light separates character from background. No dark faces. No crushed blacks.

Camera pans VERY SLOWLY rightward over 10 seconds. Smooth, no cuts, no shake. Ultra-realistic AAA quality.`;

    const result = await fal.subscribe("fal-ai/kling-video/o3/standard/reference-to-video", {
      input: {
        prompt: PROMPT,
        image_urls: [portraitUrl],
        duration: "10",
        aspect_ratio: "9:16",
        generate_audio: false,
      },
      logs: true,
      onQueueUpdate: (update: any) => {
        console.log(`[video] Kling O3 status: ${update.status} for ${jobId}`);
      },
    }) as any;

    const videoUrl: string | undefined = result?.data?.video?.url;

    if (!videoUrl) {
      const detail = JSON.stringify(result?.data).slice(0, 400);
      console.error("[video] Full Kling O3 response:", detail);
      saveVideoError(jobId, `No video URL in Kling response: ${detail}`);
      throw new Error("No video URL in Kling O3 response");
    }

    // ── Download Kling video, then overlay the exact card via FFmpeg ──────────
    console.log(`[video] Downloading from ${videoUrl}`);
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
    const videoBuf = Buffer.from(await videoRes.arrayBuffer());

    const rawVideoPath = videoPath.replace(".mp4", "_raw.mp4");
    const cardJpegPath = videoPath.replace(".mp4", "_card.jpg");
    await fsPromises.writeFile(rawVideoPath, videoBuf);
    await fsPromises.writeFile(cardJpegPath, fullCardBuf);
    console.log(`[video] Raw video saved (${videoBuf.length} bytes), compositing card...`);

    try {
      // Probe video dimensions to compute overlay position
      const { stdout: probeOut } = await execAsync(
        `ffprobe -v quiet -print_format json -show_streams "${rawVideoPath}"`
      );
      const vStream = JSON.parse(probeOut).streams?.find((s: any) => s.codec_type === "video");
      const vW: number = vStream?.width ?? 1080;
      const vH: number = vStream?.height ?? 1920;

      // Card in top-right corner — 1.8× larger than before, 20px margin from edges
      const cardW = Math.round(vW * 0.54);

      const fc =
        `[1:v]scale=${cardW}:-1[card];` +
        `[0:v][card]overlay=x='main_w-overlay_w-20':y='20':shortest=1`;

      await execAsync(
        `ffmpeg -y -i "${rawVideoPath}" -loop 1 -i "${cardJpegPath}" ` +
        `-filter_complex "${fc}" ` +
        `-c:v libx264 -preset fast -crf 20 -an -movflags +faststart "${videoPath}"`
      );
      console.log(`[video] Card overlay applied (right side) → ${videoPath}`);
    } catch (ffmpegErr: any) {
      // FFmpeg failed — use raw Kling video as fallback
      console.error("[video] FFmpeg overlay failed, using raw video:", ffmpegErr?.message);
      await fsPromises.copyFile(rawVideoPath, videoPath);
    } finally {
      await fsPromises.unlink(rawVideoPath).catch(() => {});
      await fsPromises.unlink(cardJpegPath).catch(() => {});
    }

    console.log(`[video] Done → ${videoPath}`);
    saveVideoOnly(jobId, "DONE");
    } catch (err: any) {
      const detail = err?.body?.detail ? JSON.stringify(err.body.detail) : '';
      const msg = `${err?.message || String(err)}${detail ? ` | detail: ${detail}` : ''}`;
      console.error(`[video] generateCardVideo FAILED for ${jobId}:`, msg);
      saveVideoError(jobId, msg);
      throw err;
    }
  }

  // ── Card product-shot video ──────────────────────────────────────────────────
  // Generates a cinematic 9:16 product shot of the card itself (water droplets,
  // jungle knife, wooden table, side camera) — separate from the character video.
  async function generateCardProductVideo(jobId: string): Promise<void> {
    const job = getJob(jobId);
    if (!job?.bg_layer_b64 || !job?.portrait_layer_b64 || !job?.frame_layer_b64 || !job?.text_layer_b64 || !job.public_id) {
      saveCardVideoError(jobId, "Card layers not found — card may be incomplete");
      return;
    }

    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    await fsPromises.mkdir(videosDir, { recursive: true });
    const productVideoPath = path.join(videosDir, `${job.public_id}_p.mp4`);

    try {
      try { await fsPromises.access(productVideoPath); return; } catch {}

      console.log(`[card-video] Starting product shot generation for ${jobId}`);

      const fullCardBuf = await sharp(Buffer.from(job.bg_layer_b64, "base64"))
        .composite([
          { input: Buffer.from(job.portrait_layer_b64, "base64") },
          { input: Buffer.from(job.frame_layer_b64, "base64") },
          { input: Buffer.from(job.text_layer_b64, "base64") },
        ])
        .jpeg({ quality: 95 })
        .toBuffer();

      console.log(`[card-video] Uploading card image for ${jobId}...`);
      const cardUrl = await fal.storage.upload(new Blob([fullCardBuf], { type: "image/jpeg" }));
      console.log(`[card-video] card → ${cardUrl}`);

      incrementCardVideoAttempts(jobId);

      const PRODUCT_PROMPT = `GoPro chest-mount first-person POV shot. A real human hand with natural skin and fingers enters frame from below, palm facing up. A playing card rests on a dark polished surface — it shares the same geometric patterns, border design and color palette as the reference card but the printed text fields are blank, only the background artwork is visible.

The hand lifts the card slowly and turns it to face the camera. A soft biometric fingerprint scanner pulse glows on the card surface — scanning animation. A holographic ripple spreads across the card face as it unlocks. The card design shimmers and the full artwork appears — text, details, and design now exactly matching the reference card image. The hand holds the fully revealed card forward, crisp and sharp in frame.

Camera: GoPro wide-angle, subtle fisheye distortion, chest-mounted perspective. Hand occupies lower half of frame. Shallow focus on the card, background softly blurred.

Lighting: warm ambient light with soft side fill. Natural skin tones on the hand. The card surface catches light cleanly.

Hyper-realistic, cinematic quality, smooth motion.`;

      const result = await fal.subscribe("fal-ai/kling-video/o3/standard/reference-to-video", {
        input: {
          prompt: PRODUCT_PROMPT,
          image_urls: [cardUrl],
          duration: "8",
          aspect_ratio: "9:16",
          generate_audio: false,
        },
        logs: true,
        onQueueUpdate: (update: any) => {
          console.log(`[card-video] Kling status: ${update.status} for ${jobId}`);
        },
      }) as any;

      const videoUrl: string | undefined = result?.data?.video?.url;
      if (!videoUrl) {
        const detail = JSON.stringify(result?.data).slice(0, 400);
        saveCardVideoError(jobId, `No video URL in Kling response: ${detail}`);
        throw new Error("No video URL in card product video Kling response");
      }

      console.log(`[card-video] Downloading from ${videoUrl}`);
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Failed to download card product video: ${videoRes.status}`);
      const videoBuf = Buffer.from(await videoRes.arrayBuffer());
      await fsPromises.writeFile(productVideoPath, videoBuf);

      console.log(`[card-video] Done → ${productVideoPath} (${videoBuf.length} bytes)`);
      saveCardVideoOnly(jobId, "DONE");
    } catch (err: any) {
      const detail = err?.body?.detail ? JSON.stringify(err.body.detail) : '';
      const msg = `${err?.message || String(err)}${detail ? ` | detail: ${detail}` : ''}`;
      console.error(`[card-video] generateCardProductVideo FAILED for ${jobId}:`, msg);
      saveCardVideoError(jobId, msg);
      throw err;
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

  app.get("/api/jobs/:id", jobLimiter, (req, res) => {
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
      public_id: job.public_id,
    });
  });

  
  // Public card endpoints — use opaque public_id so UUID is never exposed
  app.get("/api/public/:publicId", jobLimiter, (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      id: job.id,
      status: job.status,
      name: job.name_input,
      city: job.city_input,
      player_number: job.player_number,
      district: job.district,
      layers_ready: !!job.bg_layer_b64,
    });
  });

  app.get("/api/public/:publicId/layers", jobLimiter, (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job || !job.bg_layer_b64) return res.status(404).send("Not found");
    const base = `/api/public/${req.params.publicId}`;
    res.json({ bg: `${base}/bg`, frame: `${base}/frame`, portrait: `${base}/portrait`, text: `${base}/text` });
  });

  (['bg', 'frame', 'portrait', 'text'] as const).forEach(layer => {
    app.get(`/api/public/:publicId/${layer}`, jobLimiter, (req: any, res: any) => {
      const job = getJobByPublicId(req.params.publicId);
      if (!job || !job[`${layer}_layer_b64`]) return res.status(404).send("Not found");
      const buffer = Buffer.from(job[`${layer}_layer_b64`] as string, "base64");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.end(buffer);
    });
  });

  app.get("/api/public/:publicId/thumb", jobLimiter, async (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job || !job.bg_layer_b64 || !job.portrait_layer_b64 || !job.frame_layer_b64 || !job.text_layer_b64) {
      return res.status(404).send("Not found");
    }
    try {
      const thumb = await sharp(Buffer.from(job.bg_layer_b64, "base64"))
        .composite([
          { input: Buffer.from(job.portrait_layer_b64, "base64") },
          { input: Buffer.from(job.frame_layer_b64, "base64") },
          { input: Buffer.from(job.text_layer_b64, "base64") },
        ])
        .resize(220, 293, { fit: "fill" })
        .jpeg({ quality: 82 })
        .toBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.end(thumb);
    } catch {
      res.status(500).send("Error");
    }
  });

  app.get("/api/leaderboard", (req: any, res: any) => {
    const entries = getLeaderboard(50);
    res.json(entries.map(e => ({
      player_number: e.player_number,
      name: e.name_input,
      city: e.city_input,
      public_id: e.public_id,
      district: e.district,
    })));
  });

  // Gumroad post-payment redirect — called via the ?wanted= URL parameter on the overlay link.
  // Marks the job DONE and redirects user to their card.
  // Only accepts jobs in PREVIEW_READY status to prevent replaying against arbitrary UUIDs.
  app.get("/api/gumroad/complete", (req: any, res: any) => {
    const jobId = req.query.job_id as string | undefined;
    const token = req.query.token as string | undefined;
    if (!jobId) return res.redirect("/");

    const job = getJob(jobId);
    if (!job || job.status !== "PREVIEW_READY") {
      // Already DONE (e.g. double-redirect) — redirect with download token so the owner can download
      if (job?.status === "DONE" && job.public_id) {
        const dlToken = job.download_token || ensureDownloadToken(job.id);
        return res.redirect(`/id/${job.public_id}?owner=${dlToken}`);
      }
      return res.redirect("/");
    }

    // Verify the one-time complete token to prevent payment bypass
    if (!token || !job.complete_token || token !== job.complete_token) {
      return res.status(403).send("Invalid or missing token.");
    }

    updateJobStatus(jobId, "DONE");
    const publicId = generatePublicId();
    setPublicId(jobId, publicId);
    const dlToken = ensureDownloadToken(jobId);
    triggerVideoIfReady(jobId);
    res.redirect(`/id/${publicId}?owner=${dlToken}`);
  });

  // Gumroad server-to-server ping — primary completion path (more reliable than browser redirect).
  // Gumroad POSTs url_params[wanted] containing our complete URL with job_id + token.
  app.post("/api/gumroad/webhook",
    express.urlencoded({ extended: true }),
    async (req: any, res: any) => {
      const sellerId = req.body.seller_id as string | undefined;
      if (process.env.GUMROAD_SELLER_ID && sellerId !== process.env.GUMROAD_SELLER_ID) {
        return res.status(403).json({ error: "Invalid seller" });
      }

      try {
        // Read job_id + tok from direct url_params (new approach — Gumroad strips ?wanted= but preserves other params).
        // Fall back to parsing url_params.wanted for any older purchases.
        const directJobId = req.body.url_params?.job_id as string | undefined;
        const directTok = req.body.url_params?.tok as string | undefined;
        const wantedUrl = req.body.url_params?.wanted as string | undefined;

        let jobId: string | null = null;
        let token: string | null = null;

        if (directJobId && directTok) {
          jobId = directJobId;
          token = directTok;
        } else if (wantedUrl) {
          const parsed = new URL(wantedUrl);
          jobId = parsed.searchParams.get("job_id");
          token = parsed.searchParams.get("token");
        }

        const buyerEmail = req.body.email as string | undefined;
        console.log(`Gumroad webhook: job=${jobId} buyer=${buyerEmail} (source: ${directJobId ? "url_params.job_id" : wantedUrl ? "wanted" : "none"})`);

        if (jobId && token) {
            const job = getJob(jobId);
            if (job && job.status === "PREVIEW_READY" && job.complete_token === token) {
              updateJobStatus(jobId, "DONE");
              const publicId = generatePublicId();
              setPublicId(jobId, publicId);
              const dlToken = ensureDownloadToken(jobId);
              if (buyerEmail) {
                setBuyerEmail(jobId, buyerEmail);
                // Owner link includes the download token — only this email recipient can download videos
                const cardUrl = `${BASE_URL}/id/${publicId}?owner=${dlToken}`;
                sendCardEmail(buyerEmail, cardUrl).catch(console.error);
              }
              triggerVideoIfReady(jobId);
              console.log(`Job ${jobId} completed via webhook → /id/${publicId}`);
            } else if (job?.status === "DONE") {
              // Browser redirect already completed it — send email if we haven't yet, trigger video if not started
              if (job.public_id && buyerEmail && !job.buyer_email) {
                setBuyerEmail(jobId, buyerEmail);
                const dlToken = ensureDownloadToken(jobId);
                const cardUrl = `${BASE_URL}/id/${job.public_id}?owner=${dlToken}`;
                sendCardEmail(buyerEmail, cardUrl).catch(console.error);
              }
              triggerVideoIfReady(jobId);
            } else {
              console.warn(`Webhook: job ${jobId} in unexpected state: ${job?.status ?? "not found"}`);
            }
        } else {
          console.warn("Gumroad webhook: no job_id/tok in url_params and no wanted URL — sale not matched to a job");
        }
      } catch (err) {
        console.error("Webhook processing error:", err);
      }

      res.json({ ok: true });
    }
  );

  // Admin rescue — mark a stuck PREVIEW_READY job as DONE (for jobs where redirect + webhook both failed)
  app.post("/api/admin/rescue-job", express.json(), (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const jobId = req.body.job_id as string | undefined;
    if (!jobId) return res.status(400).json({ error: "job_id required" });
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "DONE") {
      return res.json({ ok: true, public_id: job.public_id, already_done: true, card_url: `/id/${job.public_id}` });
    }
    updateJobStatus(jobId, "DONE");
    const publicId = generatePublicId();
    setPublicId(jobId, publicId);
    const dlToken = ensureDownloadToken(jobId);
    triggerVideoIfReady(jobId);
    console.log(`Admin rescue: job ${jobId} → /id/${publicId}`);
    return res.json({ ok: true, public_id: publicId, card_url: `/id/${publicId}`, owner_url: `${BASE_URL}/id/${publicId}?owner=${dlToken}` });
  });

  // Admin: list all jobs (excluding demo-card) for debugging
  app.get("/api/admin/jobs", (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const jobs = db.prepare(`
      SELECT id, status, name_input, city_input, district, player_number, public_id, buyer_email,
             substr(created_at, 1, 16) as created_at,
             CASE WHEN complete_token IS NOT NULL THEN 1 ELSE 0 END as has_token,
             video_b64, COALESCE(video_attempts, 0) as video_attempts, video_error,
             card_video_b64, COALESCE(card_video_attempts, 0) as card_video_attempts, card_video_error
      FROM jobs WHERE id != 'demo-card-v7' ORDER BY created_at DESC LIMIT 100
    `).all();
    return res.json(jobs);
  });

  // Admin: trigger Gumroad sync immediately using a token from the request body.
  // This lets you rescue stuck jobs without setting the GUMROAD_ACCESS_TOKEN env var.
  app.post("/api/admin/gumroad-sync", express.json(), async (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const token = (req.body.access_token as string | undefined) || process.env.GUMROAD_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: "Provide access_token in body or set GUMROAD_ACCESS_TOKEN env var" });

    try {
      const r = await fetch(`https://api.gumroad.com/v2/sales?access_token=${token}&after=2025-01-01`);
      const data = await r.json() as any;
      if (!data.success) return res.status(502).json({ error: "Gumroad API error", detail: data });

      const rescued: any[] = [];
      const skipped: any[] = [];
      for (const sale of (data.sales as any[])) {
        const saleInfo = { email: sale.email, created_at: sale.created_at, sale_id: sale.id };
        const directJobId = sale.url_params?.job_id as string | undefined;
        const directTok = sale.url_params?.tok as string | undefined;
        const wantedUrl = sale.url_params?.wanted as string | undefined;
        let jobId: string | null = null;
        let tok: string | null = null;
        if (directJobId && directTok) {
          jobId = directJobId; tok = directTok;
        } else if (wantedUrl) {
          try { const p = new URL(wantedUrl); jobId = p.searchParams.get("job_id"); tok = p.searchParams.get("token"); } catch { /* skip */ }
        }
        try {
          if (!jobId || !tok) { skipped.push({ ...saleInfo, reason: "no url_params.job_id/tok or wanted" }); continue; }
          const job = getJob(jobId);
          if (!job) { skipped.push({ ...saleInfo, job_id: jobId, reason: "job not found in DB" }); continue; }
          if (job.status === "DONE") { skipped.push({ ...saleInfo, job_id: jobId, reason: "already DONE", public_id: job.public_id }); continue; }
          if (job.complete_token !== tok) { skipped.push({ ...saleInfo, job_id: jobId, reason: "token mismatch" }); continue; }
          updateJobStatus(jobId, "DONE");
          const publicId = generatePublicId();
          setPublicId(jobId, publicId);
          if (sale.email) setBuyerEmail(jobId, sale.email);
          ensureDownloadToken(jobId);
          triggerVideoIfReady(jobId);
          console.log(`Admin gumroad-sync: rescued job ${jobId} (${sale.email}) → /id/${publicId}`);
          rescued.push({ ...saleInfo, job_id: jobId, public_id: publicId, card_url: `/id/${publicId}` });
        } catch { skipped.push({ ...saleInfo, reason: "parse error" }); }
      }

      return res.json({ ok: true, total_sales: data.sales.length, rescued: rescued.length, rescued_details: rescued, skipped });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

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

  // Reset video error state so the user can retry generation
  app.post("/api/public/:publicId/video-reset", jobLimiter, (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (job.video_b64 === "ERROR") saveVideoOnly(job.id, null as any);
    res.json({ ok: true });
  });

  // Admin: unlock video generation for a card (resets attempt counter + error state)
  app.post("/api/admin/video-unlock/:publicId", async (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });
    resetVideoAttempts(job.id);
    // Delete video file from disk so it regenerates from scratch, not re-serves the old bad video
    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    const videoFile = path.join(videosDir, `${job.public_id}.mp4`);
    await fsPromises.unlink(videoFile).catch(() => {});
    res.json({ ok: true, message: "Video attempts reset and video file deleted — will regenerate on next request" });
  });

  app.post("/api/admin/card-video-unlock/:publicId", async (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });
    db.prepare('UPDATE jobs SET card_video_b64 = NULL, card_video_attempts = 0, card_video_error = NULL WHERE id = ?').run(job.id);
    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    await fsPromises.unlink(path.join(videosDir, `${job.public_id}_p.mp4`)).catch(() => {});
    res.json({ ok: true, message: "Card video attempts reset and file deleted — will regenerate on next request" });
  });

  // Full-resolution card JPEG for OG meta tag images (800×1066)
  app.get("/api/public/:publicId/og-card", jobLimiter, async (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job?.bg_layer_b64 || !job?.portrait_layer_b64 || !job?.frame_layer_b64 || !job?.text_layer_b64) {
      return res.status(404).send("Not found");
    }
    try {
      const img = await sharp(Buffer.from(job.bg_layer_b64, "base64"))
        .composite([
          { input: Buffer.from(job.portrait_layer_b64, "base64") },
          { input: Buffer.from(job.frame_layer_b64, "base64") },
          { input: Buffer.from(job.text_layer_b64, "base64") },
        ])
        .jpeg({ quality: 90 })
        .toBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.end(img);
    } catch { res.status(500).send("Error"); }
  });

  // TikTok MP4 download — serves cached video or triggers on-demand generation
  app.get("/api/public/:publicId/video.mp4", jobLimiter, async (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (!checkDownloadToken(req, res, job)) return;

    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    const videoPath = path.join(videosDir, `${req.params.publicId}.mp4`);

    const VIDEO_MAX_ATTEMPTS = 5;
    const attempts = job.video_attempts ?? 0;

    // Attempt cap — prevents repeated billing on failure/abuse
    if (attempts >= VIDEO_MAX_ATTEMPTS && job.video_b64 !== "DONE") {
      return res.status(429).json({ status: "limit_reached", message: "Video generation limit reached. Contact support." });
    }

    // ERROR state — surface to client (frontend handles clear + re-trigger on user action)
    if (job.video_b64 === "ERROR") {
      if (attempts >= VIDEO_MAX_ATTEMPTS) {
        return res.status(429).json({ status: "limit_reached", message: "Video generation limit reached. Contact support." });
      }
      return res.status(500).json({ status: "error", error: job.video_error ?? "Video generation failed" });
    }

    try {
      const stat = await fsPromises.stat(videoPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="solara-city-card.mp4"`);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "public, max-age=86400");
      createReadStream(videoPath).pipe(res);
    } catch {
      // Video not yet on disk — trigger on-demand if card is ready and not already running
      if (job.status === "DONE" && job.bg_layer_b64 && !videoGenInProgress.has(job.id)) {
        videoGenInProgress.add(job.id);
        generateCardVideo(job.id)
          .catch(e => console.error("[video] On-demand generation failed:", e))
          .finally(() => videoGenInProgress.delete(job.id));
      }
      res.status(202).json({ status: "generating" });
    }
  });

  // Video status — returns current state + error without serving the file.
  // Also triggers generation if the video hasn't started yet (token-free so polling always works).
  app.get("/api/public/:publicId/video-status", jobLimiter, (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });

    const attempts = job.video_attempts ?? 0;
    const maxAttempts = 5;
    // Kick off generation if not done, not errored, not at limit, and not already running
    if (
      job.status === "DONE" &&
      job.video_b64 !== "DONE" &&
      job.video_b64 !== "ERROR" &&
      attempts < maxAttempts &&
      job.bg_layer_b64 &&
      !videoGenInProgress.has(job.id)
    ) {
      videoGenInProgress.add(job.id);
      generateCardVideo(job.id)
        .catch(e => console.error("[video] Status-triggered generation failed:", e))
        .finally(() => videoGenInProgress.delete(job.id));
    }

    res.json({
      video_b64: job.video_b64,
      video_attempts: attempts,
      video_error: job.video_error,
      generating: videoGenInProgress.has(job.id),
    });
  });

  // Card product-shot video — trigger + serve
  app.get("/api/public/:publicId/card-video.mp4", jobLimiter, async (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job || job.status !== "DONE") return res.status(404).json({ error: "Not found" });
    if (!checkDownloadToken(req, res, job)) return;

    const CARD_VIDEO_MAX_ATTEMPTS = 3;
    const attempts = job.card_video_attempts ?? 0;

    if (attempts >= CARD_VIDEO_MAX_ATTEMPTS && job.card_video_b64 !== "DONE") {
      return res.status(429).json({ status: "limit_reached", message: "Card video generation limit reached. Contact support." });
    }
    if (job.card_video_b64 === "ERROR") {
      if (attempts >= CARD_VIDEO_MAX_ATTEMPTS) {
        return res.status(429).json({ status: "limit_reached", message: "Card video generation limit reached. Contact support." });
      }
      return res.status(500).json({ status: "error", error: job.card_video_error ?? "Card video generation failed" });
    }

    const videosDir = path.join(process.env.DATA_DIR || process.cwd(), "videos");
    const productVideoPath = path.join(videosDir, `${job.public_id}_p.mp4`);

    try {
      const stat = await fsPromises.stat(productVideoPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="solara-city-id-card.mp4"`);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "public, max-age=86400");
      createReadStream(productVideoPath).pipe(res);
    } catch {
      if (!cardVideoGenInProgress.has(job.id)) {
        cardVideoGenInProgress.add(job.id);
        generateCardProductVideo(job.id)
          .catch(e => console.error("[card-video] On-demand generation failed:", e))
          .finally(() => cardVideoGenInProgress.delete(job.id));
      }
      res.status(202).json({ status: "generating" });
    }
  });

  // Card product-shot video status — also triggers generation if not yet started.
  app.get("/api/public/:publicId/card-video-status", jobLimiter, (req: any, res: any) => {
    const job = getJobByPublicId(req.params.publicId);
    if (!job) return res.status(404).json({ error: "Not found" });

    const attempts = job.card_video_attempts ?? 0;
    const maxAttempts = 3;
    if (
      job.status === "DONE" &&
      job.card_video_b64 !== "DONE" &&
      job.card_video_b64 !== "ERROR" &&
      attempts < maxAttempts &&
      job.bg_layer_b64 &&
      !cardVideoGenInProgress.has(job.id)
    ) {
      cardVideoGenInProgress.add(job.id);
      generateCardProductVideo(job.id)
        .catch(e => console.error("[card-video] Status-triggered generation failed:", e))
        .finally(() => cardVideoGenInProgress.delete(job.id));
    }

    res.json({
      card_video_b64: job.card_video_b64,
      card_video_attempts: attempts,
      card_video_error: job.card_video_error,
      generating: cardVideoGenInProgress.has(job.id),
    });
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

    // Per-card OG tags for /id/:publicId — must be before the catch-all
    app.get("/id/:publicId", (req: any, res: any) => {
      const job = getJobByPublicId(req.params.publicId);
      const base = `${req.protocol}://${req.get("host")}`;
      const cardUrl = `${base}/id/${req.params.publicId}`;

      const title = job?.status === "DONE" && job.name_input
        ? `RESIDENT ${job.name_input.toUpperCase()} — SOLARA CITY ID`
        : "SOLARA CITY — Holographic ID Card";
      const desc = job?.status === "DONE"
        ? `${job.name_input}, ${job.city_input} · Solara City Bureau of Residents`
        : "Turn your selfie into a holographic game-art ID card";
      const ogImage = job?.status === "DONE"
        ? `${base}/api/public/${req.params.publicId}/og-card`
        : `${base}/api/og-image`;

      const html = indexHtml.replace(
        "</head>",
        `  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="800" />
  <meta property="og:image:height" content="1066" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${cardUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${ogImage}" />
</head>`
      );
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    });

    app.get("*", (req, res) => {
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
    console.log(`DB: ${process.env.DATA_DIR ? process.env.DATA_DIR + '/jobs.db (persistent volume ✓)' : 'jobs.db (local — set DATA_DIR=/data for persistence)'}`);
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
        font-size="7" letter-spacing="1">HACKER</text>
      <text x="135" y="472"
        fill="#e8f4f8" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">${new Date().toISOString().slice(0, 10)}</text>
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
      AND status != 'DONE'
      AND (bg_layer_b64 IS NOT NULL OR preview_base64 IS NOT NULL)
  `).run();
  db.prepare(`DELETE FROM consent_log WHERE created_at < datetime('now', '-12 months')`).run();
}

runCleanup();
setInterval(runCleanup, 24 * 60 * 60 * 1000);

// Gumroad API sync — catches any sales where the webhook was missed.
// Only runs when GUMROAD_ACCESS_TOKEN env var is set.
async function syncGumroadSales() {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) return;
  try {
    const r = await fetch(`https://api.gumroad.com/v2/sales?access_token=${token}&after=2025-01-01`);
    const data = await r.json() as any;
    if (!data.success || !Array.isArray(data.sales)) return;
    for (const sale of data.sales) {
      try {
        const directJobId = sale.url_params?.job_id as string | undefined;
        const directTok = sale.url_params?.tok as string | undefined;
        const wantedUrl = sale.url_params?.wanted as string | undefined;
        let jobId: string | null = null;
        let tok: string | null = null;
        if (directJobId && directTok) {
          jobId = directJobId; tok = directTok;
        } else if (wantedUrl) {
          const p = new URL(wantedUrl);
          jobId = p.searchParams.get("job_id");
          tok = p.searchParams.get("token");
        }
        if (!jobId || !tok) continue;
        const job = getJob(jobId);
        if (job && job.status === "PREVIEW_READY" && job.complete_token === tok) {
          updateJobStatus(jobId, "DONE");
          const publicId = generatePublicId();
          setPublicId(jobId, publicId);
          if (sale.email) setBuyerEmail(jobId, sale.email);
          console.log(`Gumroad sync: rescued job ${jobId} → /id/${publicId}`);
        }
      } catch { /* skip malformed entries */ }
    }
  } catch (err) {
    console.error("Gumroad sync error:", err);
  }
}

syncGumroadSales();
setInterval(syncGumroadSales, 30 * 60 * 1000);

startServer().catch(console.error);
