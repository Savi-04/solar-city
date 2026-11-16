// Renders the MOST WANTED card to a PNG using the real template, with the
// demo portrait standing in for the AI output. No API calls, no cost — use
// this to iterate on card design.
//
//   npx tsx scripts/preview-card.ts [outfile.png]

import sharp from "sharp";
import path from "path";
import { readFileSync } from "fs";
import { buildCardSvgs } from "../src/card-template";

const out = process.argv[2] || "card-preview.png";

const FIELDS = {
  name: "ALEX NOVA",
  city: "SUNFALL CITY",
  skill: "GRAND LARCENY",
  district: "SUNFALL STRIP",
  playerNumber: 1337,
};

async function main() {
  const portraitRaw = readFileSync(path.join(process.cwd(), "assets", "demo-portrait.png"));

  const maskSvg = Buffer.from(
    '<svg width="520" height="600" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg"><rect width="260" height="300" rx="12" ry="12" fill="white"/></svg>'
  );

  const portraitBuffer = await sharp(portraitRaw)
    .resize(520, 600, { fit: "cover", position: "top" })
    .modulate({ brightness: 1.08, saturation: 1.1 })
    .sharpen({ sigma: 0.8 })
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();

  const { bgSvg, frameSvg, textSvg, bounty } = buildCardSvgs(FIELDS);

  const [bg, frame, text] = await Promise.all([
    sharp(Buffer.from(bgSvg)).png().toBuffer(),
    sharp(Buffer.from(frameSvg)).png().toBuffer(),
    sharp(Buffer.from(textSvg)).png().toBuffer(),
  ]);

  await sharp(bg)
    .composite([
      { input: portraitBuffer, top: 100, left: 140 },
      { input: frame, top: 0, left: 0 },
      { input: text, top: 0, left: 0 },
    ])
    .png()
    .toFile(out);

  console.log(`rendered ${out}  bounty=${bounty}  #${FIELDS.playerNumber}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
