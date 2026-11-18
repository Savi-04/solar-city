# Handoff: starting this project in a different folder

Written 18 Nov 2026 against the code as it stands. Everything below was read out
of the repository, not remembered. Where something is unverified it says so.

Read this file top to bottom once. Steps 1 to 6 get a working copy running; the
rest is reference.

---

## 0. What this project is, in four lines

A player ID card generator. A buyer uploads a selfie, a safety check runs, the
portrait is restyled, the card is composited server side, the buyer pays through
Gumroad, and the finished card is delivered at a public URL with an optional
video. One Express process serves both the API and the frontend. One SQLite
file holds everything.

Stack: React 19 + React Router 7 + Tailwind v4 + Vite 6 on the front, Express 4
in TypeScript (run by `tsx`, bundled by `esbuild`) on the back, `better-sqlite3`
in WAL mode for data, `sharp` for compositing, Gemini for the safety check,
fal.ai for stylisation and video.

---

## 1. What to copy, and what never to copy

From this folder, copy **everything except** the list below.

| Never copy | Why |
|---|---|
| `jobs.db`, `jobs.db-shm`, `jobs.db-wal` | 17 MB of live buyer data: emails, photos, consent log, IP hashes. A dev copy has no business holding it, and copies of it are copies of a breach. |
| `.env` | Real production keys. The new folder gets a stub from `.env.example`, unless you pass `--with-env` to the copy script. |
| `videos/` | 2.1 MB of generated buyer video. Same reason as the database. |
| `node_modules/` | 347 MB. Rebuild with `npm ci`. |
| `dist/` | Build output. Rebuild with `npm run build`. |
| `.taste-skill/` | Design-checker scratch state, including four Chrome profile directories. |

Everything else travels: `server.ts`, `src/`, `public/`, `scripts/`, `docs/`,
`index.html`, `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `Dockerfile`, `railway.toml`, `claude.md`, `.gitignore`,
`.env.example`.

There is a script for exactly this:

```bash
bash scripts/handoff-new-folder.sh ~/Desktop/SaaS_projects/sunfall-city-v3
```

It refuses to write into a folder that already has files, copies only what
belongs, and leaves you a `.env` stub to fill in.

Add `--with-env` to carry the real keys across instead of a stub, so the new
folder runs immediately:

```bash
bash scripts/handoff-new-folder.sh --with-env ~/Desktop/SaaS_projects/sunfall-city-v3
```

The copy is written mode 600 and is gitignored in the new folder, but it is a
second file on disk holding live keys. If that folder is for experiments,
minting a separate `FAL_KEY` and `ADMIN_SECRET` keeps a runaway loop or a leak
contained to one of them.

---

## 2. Bring it up

```bash
cd <the new folder> && npm ci
```

`better-sqlite3` and `sharp` compile native code. On macOS that needs Xcode
command line tools; on Linux `python3 make g++`. The `Dockerfile` installs
those plus `ffmpeg`.

```bash
cp .env.example .env
```

Fill it in using the table in section 3, then:

```bash
npm run dev
```

That is `tsx server.ts`. Express starts on port 3000, mounts Vite as
middleware, and creates a fresh empty `jobs.db` in the project directory on
first run. The schema is created by `src/db.ts` at startup, so there is no
migration step and no seed file.

| Command | What it does |
|---|---|
| `npm run dev` | `tsx server.ts`, dev server on <http://localhost:3000> |
| `npm run build` | `vite build` then `esbuild server.ts` into `dist/server.cjs` |
| `npm start` | `node dist/server.cjs`, production |
| `npm run lint` | `tsc --noEmit`, type check only, no tests exist |

---

## 3. Credentials and environment

Nine variables matter. **Do not reuse the production keys in a second folder**
that you will be experimenting in: a leaked `ADMIN_SECRET` is free generation at
your cost, and a leaked `FAL_KEY` is your card on someone else's renders. Mint
new ones for the new folder where the column says so.

| Variable | Required | Where it comes from | New key for a new folder? |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | <https://aistudio.google.com/> | Reuse is fine, free tier |
| `FAL_KEY` | yes | <https://fal.ai/dashboard/keys> | **Mint a new one.** This one spends money per call |
| `ADMIN_SECRET` | yes | You generate it: `python3 -c "import secrets; print(secrets.token_urlsafe(24))"` | **Always new.** It is the only guard on the payment bypass, `/analytics` and the admin panel |
| `VITE_GUMROAD_PRODUCT_URL` | for payments | Your Gumroad product page | Reuse, or point at a Gumroad test product |
| `GUMROAD_SELLER_ID` | for payments | Gumroad settings | Reuse |
| `GUMROAD_ACCESS_TOKEN` | optional | Gumroad application token | Only needed for the reconcile sweep and `/api/admin/gumroad-sync`; that endpoint also accepts the token in its request body instead |
| `PUBLIC_URL` | recommended | Your own origin | **Set it.** See the trap below |
| `SMTP_USER`, `SMTP_PASS` | optional | A mail account app password | Without both, `sendCardEmail` logs a warning and skips, so buyers get no email at all and nothing errors |
| `DATA_DIR` | production | A mounted volume path, e.g. `/data` | Leave unset locally |
| `LAUNCH_DATE` | optional | A date string | Controls the edition seal on cards |
| `PORT` | optional | Defaults to `3000` | Railway sets it |

**The `PUBLIC_URL` trap.** `.env.example` documents a variable called
`BASE_URL`, but `server.ts:78` reads `process.env.PUBLIC_URL` and falls back to
a hardcoded **v1** domain, `solar-city-production.up.railway.app`. Setting
`BASE_URL` does nothing. If you deploy without `PUBLIC_URL`, every absolute URL
in buyer emails and OG tags points at the old site. On Railway,
`RAILWAY_PUBLIC_DOMAIN` is read as a second fallback and saves you; anywhere
else it does not. The `.env.example` in this folder has been corrected to name
`PUBLIC_URL`; fixing the fallback in `server.ts` is still open.

`VITE_GUMROAD_PRODUCT_URL` is a **build-time** variable. It is baked into the
bundle by `vite build`, so it must be present when the build runs, not only at
runtime. Railway needs it declared as a build arg, which the `Dockerfile`
already does.

---

## 4. Routes

### Pages

`/` is **not** a React route. It is a standalone HTML document,
`public/landing.html`, served by an Express handler at `server.ts:1254` that is
registered ahead of the Vite and static middleware so it wins in both dev and
production. It is separate because the design kit's `system.css` carries bare
element rules that would restyle the React pages. `src/pages/LandingPage.tsx`
is still wired to `/` inside `App.tsx` but is now unreachable; the Express
handler shadows it.

| Path | Served by |
|---|---|
| `/` | `public/landing.html` in dev, `dist/landing.html` in production |
| `/create` | React, the upload and generate flow |
| `/id/:publicId` | React `InteractiveCard`, also server rendered for OG tags at `server.ts:1275` |
| `/terms`, `/privacy` | React, still in v1 teal styling |
| `/analytics` | React dashboard, admin secret gated |
| `/paid-users` | React admin panel, admin secret gated |
| anything else | redirected to `/` |

### API

| Method and path | Purpose |
|---|---|
| `POST /api/upload` | The whole generate pipeline. The long one |
| `GET /api/health` | Railway health check |
| `GET /api/jobs/:id` | Job status |
| `GET /api/jobs/:id/layers` and `/:layer` | Card layers by internal job id |
| `GET /api/registry/count` | `{ issued, remaining }`, used by the landing page |
| `GET /api/public/:publicId` | Public card payload |
| `GET /api/public/:publicId/layers`, `/thumb`, `/og-card` | Public card images |
| `GET /api/public/:publicId/video.mp4`, `/video-status` | Portrait video |
| `GET /api/public/:publicId/card-video.mp4`, `/card-video-status` | Card video |
| `POST /api/public/:publicId/video-reset` | Clears a failed video attempt |
| `GET /api/leaderboard` | Public list |
| `GET /api/og-image` | Share image |
| `GET /api/gumroad/complete` | The buyer's return from Gumroad |
| `POST /api/gumroad/webhook` | Gumroad ping, verified against `GUMROAD_SELLER_ID` |
| `POST /api/checkout` | Stripe leftover from v1 |
| `POST /api/analytics/pageview`, `GET /api/analytics/stats` | Own analytics |
| `/api/fal/proxy` | Browser to fal storage proxy, so image bytes transit this server |
| `POST /api/admin/bypass-payment` | Free generation, admin secret |
| `POST /api/admin/rescue-job` | Unstick a job |
| `GET /api/admin/jobs` | Admin list |
| `POST /api/admin/gumroad-sync` | Reconcile against Gumroad |
| `POST /api/admin/video-unlock/:publicId`, `/card-video-unlock/:publicId` | Force a video |

Rate limiting: `express-rate-limit`, three limiters (`uploadLimiter`,
`jobLimiter`, `analyticsLimiter`). Headers: `helmet`, configured at
`server.ts:237`.

---

## 5. Data

One SQLite file, `jobs.db`, WAL mode, created on first run. Four tables.

- **`jobs`** — one row per card. `id` (internal), `public_id` (the shareable
  one, uniquely indexed where not null), `status`, the buyer's inputs
  (`name_input`, `city_input`, `district`, `platform`, `skill_input`),
  `player_number`, `buyer_email`, `complete_token`, `download_token`, and the
  image and video payloads stored as base64 **columns in the database**:
  `preview_base64`, `unwatermarked_base64`, `bg_layer_b64`,
  `frame_layer_b64`, `portrait_layer_b64`, `text_layer_b64`, `video_b64`,
  `card_video_b64`. Plus `video_attempts` / `video_error` and the card video
  equivalents, and `stripe_session_id` from v1.
- **`consent_log`** — `job_id`, three booleans, `ip_hash`, timestamp.
- **`page_views`** — page, country, city, device, referrer, timestamp.
- **`sqlite_sequence`** — SQLite's own.

Storing media as base64 in the database is why the file reaches 17 MB with a
small number of buyers. It is a known shape, not an accident, and it is the
first thing to change if this grows.

`DATA_DIR` moves `jobs.db` and `videos/` to a mounted volume. Unset, both live
in the project folder, and both are gitignored.

---

## 6. Verify the new folder actually works

In order. Stop at the first failure.

1. `npm run lint` — clean, no output.
2. `npm run dev`, then open <http://localhost:3000>. The landing page loads,
   the hero board shows three bulletins, and the issued count on the page is a
   number, not a blank.
3. `curl -s localhost:3000/api/health` — returns ok.
4. `curl -s localhost:3000/api/registry/count` — `{"issued":0,"remaining":...}`
   on a fresh database.
5. Open `/create` and run one generation using the admin bypass:
   `http://localhost:3000/?admin_mode=<your ADMIN_SECRET>`. This spends a
   Gemini call and a fal stylisation call. It does **not** spend a Kling video
   call unless you trigger the video.
6. `npm run build && npm start` on port 3000, then re-check `/`. This is the
   only way to catch a path that works in dev and breaks in production, since
   the landing page is read from `dist/` there.

**Do not** trigger video generation casually. Kling is a paid call per run and
has never been tested end to end in this build.

---

## 7. Rules that travel with the project

These are constraints, not preferences. Breaking them has a cost.

1. **No trademarks.** No "GTA", "Grand Theft Auto", "Vice City", "Leonida",
   Rockstar or Take-Two names, logos, fonts or character likenesses anywhere in
   the product, copy, metadata, assets or ads. The sun-bleached neon crime city
   *aesthetic* is a genre and is fine. The names are not.
2. **Never print buyer data.** Queries against `jobs` or `consent_log` return
   aggregate counts only. No emails, no photos, no IP hashes in logs, in
   terminal output or in a chat transcript.
3. **Do not break the working pipeline.** Generation, payment and compositing
   work today. Changes go behind a new path or a flag until proven.
4. **No personal photographs** of the owner on the site.
5. **Nothing deploys** until the Railway account is paid.
6. **`ADMIN_SECRET` is the whole perimeter.** Without it, the bypass, the
   analytics dashboard and the admin panel refuse every request. With it, they
   are free generation and buyer data. Treat it as a password.

---

## 8. Deploying

Railway, Docker build, using the repository `Dockerfile`.

- Health check `/api/health`, 300 s timeout, restart on failure up to 3 times
  (`railway.toml`).
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set in the image: Playwright is a
  dependency but its browsers are not downloaded, because that capture path is
  not used in this build.
- Set `DATA_DIR=/data` and mount a volume there, or every deploy wipes the
  database.
- Set `PUBLIC_URL` to the real domain (section 3).
- Declare `VITE_GUMROAD_PRODUCT_URL` as a **build** variable, not only a
  runtime one.
- The container listens on `PORT`, defaulting to 3000; Railway injects 8080 and
  the `Dockerfile` exposes it.

---

## 9. Open items you inherit

Each of these is a real decision waiting, not a nit.

| Item | Where |
|---|---|
| `PUBLIC_URL` falls back to the v1 domain | `server.ts:78` |
| Root `README.md` and `ARCHITECTURE.md` are stale v1 text (Veo, Multer, Stripe, "Neon ID Card") | repository root; use `docs/ARCHITECTURE.md` instead |
| `/terms` and `/privacy` still render in v1 teal, so the new footer links jump visually | `src/pages/Terms.tsx`, `Privacy.tsx` |
| No footer contact address; the `.example` stand-in was removed rather than ship a dead one | `public/landing.html` |
| Video generation untested end to end, costs a paid Kling call | `/api/public/:publicId/video.mp4` path |
| `src/pages/LandingPage.tsx` is dead code shadowed by the Express route | `src/App.tsx:305` |
| Stripe is a leftover from v1; payments are Gumroad | `/api/checkout` |
| `Staging-config.md` is v1 text and tells you to clone the old `solar-city` repository | repository root |
| No tests of any kind. `npm run lint` is a type check | `package.json` |
| Media stored as base64 columns | section 5 |
| The known gaps in the pipeline itself, including the moderation ordering that burns a player number, the layers endpoint with no payment check, and Gemini failing open | `docs/ARCHITECTURE.md`, "Known gaps" |

---

## 10. The rest of the documentation

| File | What it covers |
|---|---|
| `docs/ARCHITECTURE.md` | The request flow end to end, plus the known gaps stated plainly |
| `docs/LANDING-PAGE.md` | Why `/` is a separate document, the design deal, and the measurement behind every media query |
| `docs/DECISIONS.md` | Each decision with its reasoning and its cost |
| `docs/RUNBOOK.md` | Running it, env vars, regenerating demo assets, re-running the design checkers |
| `docs/GLOSSARY.md` | Project terms and the stack pieces worth defining |
| `docs/NEW-CHAT-PROMPT.md` | The block to paste when opening a fresh Claude session on this project |
| `claude.md` | The brief, the constraints, and the pointer into `docs/` |
