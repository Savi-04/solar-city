// The three pictures for the "how it works" section, built from material the
// pipeline already produced: the raw stand-in selfie, the relit portrait cut
// from the finished card, and the card's foot with the charges and bounty.
// The kit's card panels are portrait boxes (--p-h), so these are 3:4, not 4:3:
// a landscape crop gets sliced to ribbons inside them. No API calls.
import sharp from "sharp";
import path from "node:path";

const W = 960, H = 1280;
const root = process.cwd();
const out = (n: string) => path.join(root, "public", "demo", n);
const card = path.join(root, "public", "demo", "card-a.webp");

async function main() {
  // 1. what the visitor sends: the raw portrait
  await sharp(path.join(root, "assets", "standins", "face-a.jpg"))
    .resize(W, H, { fit: "cover", position: "top" })
    .webp({ quality: 82 }).toFile(out("step-photo.webp"));

  // 2. what the office does: the relit portrait at the card's own geometry
  await sharp(card).extract({ left: 140, top: 100, width: 520, height: 600 })
    .resize(W, H, { fit: "cover", position: "top" })
    .webp({ quality: 82 }).toFile(out("step-relit.webp"));

  // 3. what is issued: the bulletin itself. The card is already 3:4, so it
  // fills the panel whole; a crop of its foot cannot be 3:4 without cutting
  // the charges off at the sides.
  await sharp(card).resize(W, H, { fit: "cover" })
    .webp({ quality: 82 }).toFile(out("step-issued.webp"));

  console.log(`wrote the three step pictures at ${W}x${H}`);
}
main();
