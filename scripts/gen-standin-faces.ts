// Generates synthetic stand-in portraits for the landing page demo cards.
//
// Synthetic on purpose. A MOST WANTED bulletin built from a real, identifiable
// person's photograph would depict them as a wanted criminal, which licensed
// stock and Wikimedia Commons portraits do not make acceptable. These faces
// belong to nobody.
//
//   npx tsx scripts/gen-standin-faces.ts

import { fal } from "@fal-ai/client";
import { writeFileSync } from "fs";
import path from "path";
import "dotenv/config";

const OUT = path.join(process.cwd(), "assets", "standins");

const PEOPLE = [
  { id: "a", look: "a woman in her late twenties with dark curly hair pulled back, light brown skin, a small scar through one eyebrow, plain black tank top" },
  { id: "b", look: "a man in his forties with a shaved head and a short greying beard, deep brown skin, plain grey work shirt" },
  { id: "c", look: "a young man in his early twenties with messy blonde hair, pale skin, faint stubble, plain white t-shirt" },
];

const BASE =
  "Photorealistic head and shoulders portrait, shot straight on, neutral unsmiling expression looking directly into the lens. " +
  "Even soft daylight, plain mid-grey studio wall behind. 50mm lens, natural skin texture with visible pores. " +
  "No text, no watermark, no props, no uniform, no badge.";

async function main() {
  for (const p of PEOPLE) {
    const r: any = await fal.subscribe("fal-ai/flux/schnell", {
      input: { prompt: `${BASE} The subject is ${p.look}.`, image_size: "square_hd", num_images: 1 },
    });
    const url = r?.data?.images?.[0]?.url;
    if (!url) { console.error(p.id, "no image returned"); continue; }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(path.join(OUT, `face-${p.id}.jpg`), buf);
    console.log(`face-${p.id}.jpg  ${Math.round(buf.length / 1024)}KB`);
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
