// Runs the stand-in faces through the real card pipeline and saves the
// finished bulletins for the landing page. Requires the dev server running.
//
//   npx tsx scripts/gen-demo-cards.ts

import { fal } from "@fal-ai/client";
import sqlite from "better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import sharp from "sharp";
import "dotenv/config";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(process.cwd(), "public", "demo");

const CAST = [
  { face: "a", name: "VESPER",    city: "SUNFALL CITY", skill: "GRAND LARCENY" },
  { face: "b", name: "AUGUSTINE", city: "CORAL KEYS",   skill: "RACKETEERING" },
  { face: "c", name: "KITE",      city: "GOLD COAST",   skill: "STREET RACING" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const c of CAST) {
    const buf = readFileSync(path.join("assets", "standins", `face-${c.face}.jpg`));
    const selfie_url = await fal.storage.upload(new Blob([buf], { type: "image/jpeg" }));

    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selfie_url, name: c.name, city: c.city, skill: c.skill,
        age_confirmed: true, ownership_confirmed: true, privacy_accepted: true,
      }),
    });
    if (!res.ok) { console.error(c.name, res.status, (await res.text()).slice(0, 200)); continue; }
    const { jobId } = await res.json();

    // /api/jobs/:id returns only the watermarked preview; the clean card lives
    // in the row itself, so wait on status there and read it straight out.
    let card: string | undefined;
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const j = await fetch(`${BASE}/api/jobs/${jobId}`).then((r) => r.json());
      if (j.status === "FAILED") break;
      if (j.status === "PREVIEW_READY" || j.status === "DONE") {
        card = (sqlite(process.cwd() + "/jobs.db", { readonly: true })
          .prepare("SELECT unwatermarked_base64 AS c FROM jobs WHERE id = ?")
          .get(jobId) as any)?.c;
        break;
      }
    }
    if (!card) { console.error(c.name, "no card produced"); continue; }

    const png = Buffer.from(card, "base64");
    await sharp(png).webp({ quality: 88 }).toFile(path.join(OUT, `card-${c.face}.webp`));
    const { size } = await sharp(path.join(OUT, `card-${c.face}.webp`)).metadata() as any;
    console.log(`card-${c.face}.webp  ${c.name}  ${Math.round(png.length / 1024)}KB png -> webp`);
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
