# Sunfall City (v2) — handoff

Upload a selfie, get a fictional **MOST WANTED** bulletin: AI-restyled mugshot,
alias, charges, jurisdiction and a bounty figure, as a 3D-parallax card plus
shareable MP4s. Forked from Solara City v1 (sci-fi resident ID) and rethemed.

> This file was rewritten against the actual code. The v1 copy described a
> Playwright/Veo/Gemini-image pipeline that no longer exists.

---

## Stack

| Layer | What |
|---|---|
| Frontend | React 19, Vite 6, Tailwind v4, `motion/react`, React Router 7 |
| Backend | Express 4 + TypeScript, `tsx` in dev, esbuild to CJS for prod |
| DB | SQLite via `better-sqlite3`, WAL mode, single `jobs.db` |
| Moderation | Google Gemini 2.5 Flash |
| Stylisation | fal.ai `nano-banana-2/edit` |
| Video | fal.ai `kling-video/o3/standard/reference-to-video` |
| Compositing | `sharp` (SVG to PNG, alpha masking) |
| Transcode | FFmpeg via `execFileAsync` (no shell, so no shell-injection surface) |
| Payments | Gumroad, hosted checkout |
| Hosting | Railway, persistent disk volume for MP4s |

Two distinct fal services are in play: fal **storage** (a file host) and fal
**models**. The browser talks to fal storage through this server's own proxy
at `/api/fal/proxy`, which exists so `FAL_KEY` never reaches the browser. The
image bytes therefore **do** pass through the server, as a streamed raw body.
They are not written to disk or persisted, but "the server never sees the
photo" is wrong.

---

## The flow, in order

1. **Upload.** The browser calls `fal.storage.upload(file)`, configured with
   `proxyUrl: "/api/fal/proxy"`. The bytes stream through this server, which
   attaches `FAL_KEY` and forwards to fal storage, then hands back a URL. The
   proxy allowlists fal hostnames, so it cannot be used as an open relay.
2. **Moderation.** Server fetches that URL, base64s it, and asks Gemini to
   approve it. A `REJECT` returns 400.
   *Known issue: the job row is inserted **before** moderation, so a rejected
   photo leaves an orphan `CREATED` row and permanently burns a sequential
   player number.*
3. **Card build (free, before payment).** `buildCardInBackground` is fired and
   **not awaited**. It calls fal to restyle the portrait, then composites four
   SVG layers with sharp. Measured end to end at **under 10 seconds** on a
   1024x1024 JPEG. Ends at `PREVIEW_READY`.
4. **Preview.** The client polls every 3s and flips the screen when
   `preview_url` appears. A watermarked JPEG is shown.
5. **Payment.** Gumroad. On completion the status becomes `DONE`, a `public_id`
   and `download_token` are minted, and `triggerVideoIfReady` starts the
   **character video only**.
6. **Videos.** Character video (10s) auto-fires at payment. Card video (8s) is
   **on demand**, only when the user asks. Each budgets `WAIT_SECS = 300`.

**The card is generated before payment. Payment buys the permanent link, the
download token and the videos.** That ordering is deliberate: it is why v1
converted at ~74% from preview to paid.

### Known gaps
- **No completion notification for videos.** The client poll is the only
  delivery mechanism; close the tab and nothing tells you, and retries stop.
  The only email sent is the card link, on the webhook path, if SMTP is set.
- `/api/jobs/:id/layers` has **no payment check** — the unwatermarked card is
  reachable pre-payment. Deliberate for conversion; the random job UUID is the
  de-facto capability token.
- Gemini **fails open**: if moderation errors, the upload proceeds.
- Retry counters live in memory, so they reset on deploy and break past one instance.
- No tests. No error tracking.

---

## Key files

| Path | Role |
|---|---|
| `server.ts` | Express app, fal/Gemini calls, Gumroad, all endpoints |
| `src/card-template.ts` | **Card artwork, single source of truth** |
| `src/db.ts` | SQLite schema, migrations, CRUD |
| `src/App.tsx` | Router plus the upload/preview/success flow; 3s poll |
| `src/components/InteractiveCard.tsx` | 3D parallax viewer, video download |
| `src/pages/LandingPage.tsx` | Marketing page and demo card |
| `src/pages/AnalyticsDashboard.tsx` | Self-hosted analytics at `/analytics` |
| `scripts/preview-card.ts` | Render the card to PNG, no API calls |

**Change card art in `src/card-template.ts` only.** Both the real pipeline and
the landing-page demo render through `buildCardSvgs`, so they cannot drift.
v1 had this duplicated in two places and they had already diverged.

---

## Running

```bash
npm install
npm run dev     # tsx server.ts, Vite middleware, http://localhost:3000
npm run lint    # tsc --noEmit, currently clean
npm run build   # vite build + esbuild server to dist/server.cjs
```

Preview the card design without spending any API credits:

```bash
npx tsx scripts/preview-card.ts out.png
```

`.env` needs `GEMINI_API_KEY`, `FAL_KEY`, Gumroad vars, and `ADMIN_SECRET`.
See `.env.example`.

Admin bypass (skips payment): visit `/?admin_mode=<ADMIN_SECRET>`.
The key is stashed in `sessionStorage` and stripped from the URL.

---

## Branding constraint

This rides a cultural moment but must not borrow anyone's trademarks. Do not
introduce "GTA", "Grand Theft Auto", "Vice City", "Leonida", Rockstar or
Take-Two names, logos, fonts or character likenesses anywhere in the product,
copy, metadata or ads. The sun-bleached neon crime-city *aesthetic* is a genre
and is fine. The names are not.

---

## Study documentation

Longer write-ups live in `docs/`, written against the real code:

| File | What it covers |
|---|---|
| `docs/ARCHITECTURE.md` | The request flow end to end, plus the known gaps stated plainly |
| `docs/LANDING-PAGE.md` | Why `/` is a separate document, the design deal, and the measurement behind every media query |
| `docs/DECISIONS.md` | Each decision with its reasoning and its cost |
| `docs/RUNBOOK.md` | Running it, env vars, regenerating demo assets, re-running the checkers |
| `docs/GLOSSARY.md` | Project terms and the stack pieces worth defining |
| `docs/HANDOFF.md` | Moving the project to a new folder: what to copy, credentials, routes, data, rules, deploy, open items |
| `docs/NEW-CHAT-PROMPT.md` | The block to paste when opening a fresh Claude session on this project |

The `ARCHITECTURE.md` at the repository root is stale v1 text (Veo, Multer,
Stripe, "Neon ID Card"). Use `docs/ARCHITECTURE.md`.
