# Solar City Card — Staging Environment Config

Use this file to replicate the project in any agentic IDE or CI environment.

---

## Repository

```
git clone https://github.com/Savi-04/solar-city.git
cd solar-city
```

---

## Runtime Requirements

| Requirement | Version |
|---|---|
| Node.js | >= 20.0.0 |
| npm | >= 10 |
| OS | Linux (Debian/Ubuntu recommended) or macOS |

Native build tools required for `better-sqlite3` and `sharp`:
```bash
# Debian/Ubuntu
apt-get install python3 make g++

# macOS (via Xcode CLT)
xcode-select --install
```

---

## Install Dependencies

```bash
npm ci
```

> Use `npm ci` (not `npm install`) for reproducible installs.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Required — Google Gemini (used for image moderation)
GEMINI_API_KEY=your_gemini_api_key_here

# Required — Fal.ai (used for image stylization)
FAL_KEY=your_fal_key_here

# Optional — controls "Founding Member" edition seal on cards
# Format: YYYY-MM-DD  (defaults to 2025-06-26 if unset)
LAUNCH_DATE=2025-06-26

# Optional — Railway/Docker persistent storage path for SQLite DB
# Leave unset for local dev (DB saved as jobs.db in project root)
DATA_DIR=/data

# Optional — server port (defaults to 3000)
PORT=3000

# Required for production payments (Gumroad)
# When GUMROAD_SELLER_ID is set, /api/checkout stub is disabled
GUMROAD_SELLER_ID=your_gumroad_seller_id

# Frontend — baked at build time (must set before npm run build)
VITE_GUMROAD_PRODUCT_URL=https://yourname.gumroad.com/l/your-product-slug
```

### Where to get keys

| Key | Where |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `FAL_KEY` | https://fal.ai/dashboard → API Keys |
| `GUMROAD_SELLER_ID` | Gumroad Dashboard → Settings → Profile → "Seller ID" |
| `VITE_GUMROAD_PRODUCT_URL` | Gumroad product permalink URL (e.g. `https://yourname.gumroad.com/l/resident-id`) |

---

## Dev Server

```bash
npm run dev
```

Runs `tsx server.ts` — starts Express + Vite dev server together on port 3000.

---

## Production Build

```bash
npm run build
npm start
```

- `npm run build` → Vite compiles frontend to `dist/`, esbuild bundles server to `dist/server.cjs`
- `npm start` → `node dist/server.cjs`

---

## Docker

A `Dockerfile` is included at project root:

```bash
docker build -t solar-city .
docker run -p 3000:3000 \
  -e GEMINI_API_KEY=your_key \
  -e FAL_KEY=your_fal_key \
  -e DATA_DIR=/data \
  -v $(pwd)/data:/data \
  solar-city
```

### Dockerfile summary
- Base: `node:20-bookworm-slim`
- Installs: `python3 make g++` (for native modules)
- Sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
- Runs `npm ci` then `npm run build`
- Exposes port `3000`
- CMD: `npm start`

---

## Railway Deployment

1. Connect the GitHub repo (`https://github.com/Savi-04/solar-city.git`) to Railway
2. Railway auto-detects the `Dockerfile` and builds
3. Set these environment variables in Railway dashboard:
   - `GEMINI_API_KEY`
   - `FAL_KEY`
   - `DATA_DIR=/data`
   - `LAUNCH_DATE=2025-06-26` (or your staging date)
4. Add a persistent volume mounted at `/data` (for SQLite DB)
5. Railway injects `PORT` automatically — no need to set it

---

## Key Architecture

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 6 + Tailwind 4 + Framer Motion |
| Backend | Express 4 (single server, no separate API) |
| Database | better-sqlite3 (WAL mode, file at `DATA_DIR/jobs.db`) |
| Image AI | Fal.ai `fal-ai/nano-banana-2/edit` (img2img stylization) |
| Moderation | Google Gemini 2.5 Flash (text + vision) |
| Image processing | Sharp (masking, compositing, SVG → PNG) |
| Deployment | Docker → Railway |

---

## Staging-Specific Recommendations

- Set `LAUNCH_DATE` to tomorrow's date so cards show "PRE-LAUNCH" edition seal
- Use a separate `FAL_KEY` with a low spending limit for staging
- Mount a separate `/data` volume from production so DBs don't mix
- Set `NODE_ENV=staging` (or leave unset — server only checks for `production`)

---

## API Endpoints (for testing)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/upload` | JSON body: `{ selfie_url, name, city, age_confirmed, ownership_confirmed, privacy_accepted }` |
| `GET /api/jobs/:id` | Poll job status |
| `GET /api/jobs/:id/layers` | Get card layer images (base64) |
| `GET /api/registry/count` | Issued card count |
| `GET /api/og-image` | OG meta image for link previews |
| `USE /api/fal/proxy` | fal.ai proxy (keeps API key server-side) |

---

## Folder Structure

```
/
├── server.ts          # Express server + all API routes
├── src/
│   ├── App.tsx        # Root app, state machine
│   ├── db.ts          # SQLite schema + queries
│   ├── components/
│   │   ├── InteractiveCard.tsx   # 3D parallax card viewer
│   │   └── UploadStep.tsx        # Upload form + fal proxy upload
│   └── pages/
│       └── LandingPage.tsx       # Marketing landing page
├── assets/
│   └── demo-portrait.png         # AI-generated demo character
├── index.html         # Entry point (OG meta tags injected server-side in prod)
├── Dockerfile
├── vite.config.ts
└── tsconfig.json
```
