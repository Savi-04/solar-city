import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const jobId = process.argv[2];
if (!jobId) {
  console.error("No jobId provided");
  process.exit(1);
}

const url = `http://localhost:3000/card/${jobId}`;
const videosDir = path.join(process.cwd(), 'videos');
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

async function capture() {
  console.log(`Starting capture for ${jobId}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 450, height: 800 },
    recordVideo: {
      dir: videosDir,
      size: { width: 450, height: 800 }
    }
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for layers to load
  await page.waitForTimeout(2000);

  const cx = 225;
  const cy = 400;
  const rX = 200;
  const rY = 100;

  // Move mouse in a smooth figure-8 to show off holographic effect and parallax
  const steps = 120; // 4 seconds at 30 fps
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = cx + Math.sin(t) * rX;
    const y = cy + Math.sin(t * 2) * rY;
    
    await page.mouse.move(x, y);
    await page.waitForTimeout(33); // ~30fps realtime
  }

  // Let the spring settle
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(1000);

  await context.close();
  await browser.close();

  // Find the generated video
  const files = fs.readdirSync(videosDir);
  const videoFile = files.find(f => f.endsWith('.webm')); // playwright usually saves .webm
  if (videoFile) {
    const oldPath = path.join(videosDir, videoFile);
    const newPath = path.join(process.cwd(), `temp_${jobId}.webm`);
    fs.renameSync(oldPath, newPath);
    console.log(newPath);
  } else {
    console.error("Video not found");
    process.exit(1);
  }
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
