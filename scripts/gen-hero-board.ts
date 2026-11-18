// The hero window is a wide frame; three tall cards laid out in it can only
// ever cover about 14% of the screen, and shrinking them to fit cuts them.
// So the three bulletins are composited into one wide board image that fills
// the window. No API calls.
import sharp from "sharp";
import path from "node:path";

const W = 1600, H = 600, CARD_H = 500, GAP = 48;
const root = process.cwd();

async function main() {
  const cards = await Promise.all(["a", "b", "c"].map((k) =>
    sharp(path.join(root, "public", "demo", `card-${k}.webp`))
      .resize({ height: CARD_H })
      .toBuffer({ resolveWithObject: true })
  ));
  const total = cards.reduce((n, c) => n + c.info.width, 0) + GAP * (cards.length - 1);
  let x = Math.round((W - total) / 2);
  const top = Math.round((H - CARD_H) / 2);
  const layers = cards.map((c) => {
    const item = { input: c.data, left: x, top };
    x += c.info.width + GAP;
    return item;
  });

  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .webp({ quality: 88 })
    .toFile(path.join(root, "public", "demo", "board.webp"));
  console.log(`wrote board.webp ${W}x${H}, three cards ${CARD_H} tall`);
}
main();
