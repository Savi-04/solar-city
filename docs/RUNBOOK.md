# Runbook

Everything here was run during this build unless marked otherwise.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

That is `tsx server.ts` (`package.json`). Express starts, mounts Vite as
middleware, and serves on <http://localhost:3000>. The landing page is at `/`
and the app flow is at `/create`.

Type check:

```bash
npm run lint
```

That is `tsc --noEmit`. It was clean at the end of this build.

Production build:

```bash
npm run build
```

`vite build` plus esbuild bundling `server.ts` to `dist/server.cjs` as CommonJS
with `--packages=external`. Run the result with `npm start`.

Nothing is deployed. Railway is unpaid.

## Environment variables

Copy `.env.example` to `.env`. Required to get through the flow:

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | the photo safety check |
| `FAL_KEY` | stylisation and video |
| `ADMIN_SECRET` | payment bypass, `/analytics`, the admin endpoints |
| `VITE_GUMROAD_PRODUCT_URL` | the Pay button target, read at build time |

Optional: `GUMROAD_SELLER_ID`, `GUMROAD_ACCESS_TOKEN`, `DATA_DIR`, `SMTP_USER`,
`SMTP_PASS`, `LAUNCH_DATE`, `PORT`.

**One trap.** `.env.example` documents `BASE_URL`, but the code reads
`process.env.PUBLIC_URL` (`server.ts:78`). Set `PUBLIC_URL`, not `BASE_URL`, or
absolute URLs in emails and OG tags fall back.

`VITE_GUMROAD_PRODUCT_URL` is a Vite client variable, so it must be present
when `npm run build` runs, not only at runtime.

## Admin bypass

Visit `/?admin_mode=<ADMIN_SECRET>`. The key is stashed in `sessionStorage` and
stripped from the URL. It unlocks `POST /api/admin/bypass-payment`, which marks
a `PREVIEW_READY` job `DONE` and returns the public id and download token.

**It is not free.** It calls `triggerVideoIfReady`, which starts a paid Kling
generation. To test the delivery page without spend, mint a completed job
directly in SQLite instead.

## Preview the card with no API spend

```bash
npx tsx scripts/preview-card.ts card-preview.png
```

Renders the real template through `buildCardSvgs` with a stand-in portrait. No
network calls, no cost. Use this for any card artwork change.

## Regenerate the demo assets

Order matters, and the first two cost money.

```bash
npx tsx scripts/gen-standin-faces.ts
```

Generates three synthetic faces with `fal-ai/flux/schnell` into
`assets/standins/`. Costs fal credits. Only rerun if the faces need replacing.

```bash
npx tsx scripts/gen-demo-cards.ts
```

Runs those faces through the real pipeline and saves
`public/demo/card-{a,b,c}.webp`. Needs the dev server running. Costs fal
credits.

```bash
npx tsx scripts/gen-hero-board.ts
```

Composites the three cards into `public/demo/board.webp` at 1600 by 600. Free.

```bash
npx tsx scripts/gen-how-strip.ts
```

Cuts the three step pictures into `public/demo/step-{photo,relit,issued}.webp`
at 960 by 1280. Free.

The last two read the existing cards, so they are safe to rerun whenever the
page layout changes. The first two are the expensive ones.

## Re-run the design checkers

These need the dev server running on port 3000. They each drive a headless
Chrome, so run one at a time and expect a few minutes.

Copy lint, no browser needed:

```bash
node ~/.claude/skills/design-taste-frontend/scripts/copy-lint.mjs public/landing.html --kind software
```

Full consistency run across the widths used in this build:

```bash
node ~/.claude/skills/design-taste-frontend/scripts/consistency.mjs http://localhost:3000/ --widths 1440,1024,820,768,390 --rhythm-widths 1440,820,768,390 --profile .taste-skill/chrome-verify --page software --category "a MOST WANTED bulletin made from your selfie" --primary "Get on the bulletin"
```

The finish gate:

```bash
node ~/.claude/vendor/taste-skill/skills/taste-skill/scripts/gate.mjs
```

Gate state lives in `.taste-skill/`: `gate.json` holds the open findings,
`.taste-skill/gate/` holds screenshot crops, `plan.md` holds the page plan.
`waivers.json` was deleted and no findings are currently waived.

**Note on the gate.** Its default rhythm widths did not include 390 in this
build, so a gate pass is not the same as a clean phone layout. Run the
consistency script with `--rhythm-widths` including 390 to check phones.

## Measuring the page directly

Faster than re-running a checker when chasing a layout number. With the page
open in a browser, in the console:

```js
const H = innerHeight;
[...document.querySelectorAll('main > section, footer.closing')].map(s => {
  const b = s.getBoundingClientRect(); const top = Math.round(b.top + scrollY);
  return [s.id || 'hero', Math.round(b.height), +(b.height/H).toFixed(2), top % H];
});
```

Every section should be a whole number of screens and start at an offset of 0.
This is how the phone and tablet numbers in `LANDING-PAGE.md` were obtained.

## The database

`jobs.db` in the project root, or in `DATA_DIR` if set. WAL mode, so
`jobs.db-wal` and `jobs.db-shm` sit beside it.

It holds real customer data in the production copy. Do not copy it between
environments and do not print buyer details out of it. Aggregate counts only.
