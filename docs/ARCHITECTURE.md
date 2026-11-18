# Architecture

How a selfie becomes a MOST WANTED bulletin, verified against the code in this
repository. Every claim below was read out of the source, not recalled.

> There is a stale `ARCHITECTURE.md` at the repository root. It describes v1:
> React 18, Veo, Multer, Stripe and a "Neon ID Card". None of that is in this
> code any more. Read this file instead, and treat the root one as history.

## Stack, as the code actually uses it

| Layer | What | Where |
|---|---|---|
| Frontend | React 19, Vite 6, Tailwind v4, React Router 7, `motion/react` | `src/` |
| Backend | Express 4 in TypeScript, run by `tsx` in dev | `server.ts` |
| Database | SQLite through `better-sqlite3`, WAL mode, one `jobs.db` | `src/db.ts:9` |
| Moderation | Gemini 2.5 Flash | `server.ts:310` |
| Stylisation | fal.ai `nano-banana-2/edit` | `server.ts:350` |
| Video | fal.ai `kling-video/o3/standard/reference-to-video` | `server.ts:538`, `server.ts:663` |
| Compositing | `sharp` | throughout `buildCardInBackground` |
| Payments | Gumroad, hosted checkout | `server.ts:822`, `server.ts:852` |
| Build | `vite build` plus `esbuild` bundling the server to CJS | `package.json` |

Nothing is deployed. Railway is unpaid, so the only place this runs is a
developer machine.

## The flow, step by step

### 1. Upload

The browser uploads straight to fal storage, but not directly. The client is
configured with `proxyUrl: "/api/fal/proxy"`, so the bytes go to this server
first, which attaches `FAL_KEY` and forwards them on (`server.ts:213`).

This matters and is easy to get wrong in an interview: **the image bytes do
pass through this server.** They are not written to disk and not stored, but
"the server never sees the photo" is false. The proxy exists so the fal key
stays server side, not to keep the photo away from the server.

The proxy is mounted before `express.json()` on purpose (`server.ts:213` sits
above `server.ts:236`), because the raw body must not be consumed first.

### 2. Create the job, then moderate

`POST /api/upload` (`server.ts:266`) does this in order:

1. Validates the URL against an allowlist of `fal.media` and `storage.fal.ai`.
   This is an SSRF guard: without it you could ask the server to fetch anything.
2. Validates name, city and skill against `SAFE_TEXT_RE` and caps their length.
3. Requires the three consent flags.
4. Checks the registry still has numbers left.
5. **Creates the job row** (`createJob`, which assigns the player number).
6. **Then** asks Gemini whether the photo is a single adult human face.

Steps 5 and 6 are in the wrong order, and that is a real defect. See the gaps
section below.

### 3. Build the card, in the background

`buildCardInBackground` is called and deliberately **not awaited**
(`server.ts:330`). The HTTP response has already gone out, so the user sees the
preview screen while the work happens.

Inside it:

1. fal `nano-banana-2/edit` relights the portrait. The prompt is explicit that
   facial geometry and identity must not change, only the surface rendering.
2. If stylisation fails, it falls back to the original photograph rather than
   failing the job (`server.ts:370`).
3. `sharp` resizes the portrait to 520 by 600, brightens and sharpens it, and
   masks it to a rounded rectangle.
4. `buildCardSvgs` returns three SVG layers: background, frame and text.
5. The four layers are composited at 800 by 1066: the background is the base,
   then the portrait at `top: 100, left: 140`, then the frame, then the text
   (`server.ts:401`).
6. A watermarked JPEG copy is made for the preview.
7. All four layers are saved to SQLite as base64, and the job moves to
   `PREVIEW_READY`.

Measured end to end at **under 10 seconds** on a 1024 by 1024 JPEG. That is the
card only. The videos take minutes.

The card geometry is 2x a 400 by 533 SVG viewBox. The portrait window is 260 by
300 at x 70, y 50 in SVG coordinates, which is why the composite lands at 140,
100 at 2x.

### 4. Preview

The client polls `GET /api/jobs/:id` every 3000 ms (`src/App.tsx:96`) and swaps
the screen when `preview_url` appears. The user sees the watermarked JPEG.

### 5. Payment

Gumroad. On return, `GET /api/gumroad/complete` (`server.ts:822`):

- Refuses unless the job is `PREVIEW_READY`.
- Verifies a one time `complete_token` against the row. This is the payment
  bypass guard: without the token you cannot mark a job paid.
- Sets status `DONE`, mints a `public_id` and a `download_token`.
- Calls `triggerVideoIfReady`.

There is also a server to server webhook at `POST /api/gumroad/webhook`
(`server.ts:852`), which the comment calls the more reliable path, and which
checks `GUMROAD_SELLER_ID` when that is set.

### 6. Videos

Two different videos, and the function names are misleading:

| Function | Makes | Duration | Trigger |
|---|---|---|---|
| `generateCardVideo` (`server.ts:474`) | the **character** video | `"10"` | fires automatically at payment |
| `generateCardProductVideo` (`server.ts:622`) | the **card** video | `"8"` | on demand only |

`generateCardVideo` does not make a video of the card. It makes the video of
the person. The in-memory guard beside it is even commented "character video"
(`server.ts:23`). Expect to be asked about this if anyone reads the code.

Both call the same Kling model. The character video extracts the portrait back
out of the stored layer at the same 140, 100, 520 by 600 rectangle and feeds it
to Kling as an identity reference.

Retry ceilings: `VIDEO_MAX_ATTEMPTS = 5` (`server.ts:1087`) and
`CARD_VIDEO_MAX_ATTEMPTS = 3` (`server.ts:1160`).

Video generation has **not been tested** in this build. Triggering it costs a
paid Kling call, and that spend was not authorised.

## The registry

2000 bulletins, hard coded in `src/db.ts:172`. The player number is assigned
atomically inside the INSERT with
`(SELECT COALESCE(MAX(player_number), 0) + 1 FROM jobs)` (`src/db.ts:114`), so
two concurrent uploads cannot take the same number.

The bounty is derived from the player number and never stored:

```ts
const bountyAmount = Math.round((250000 + ((playerNumber * 738917) % 9250000)) / 10000) * 10000;
```

`src/card-template.ts:96`. Same input, same bounty, every time. That is why the
page can claim the office sets it and it never changes.

## Known gaps, stated plainly

These are real. Knowing them is worth more than pretending they are not there.

1. **The job row is inserted before moderation.** A photo that Gemini rejects
   has already consumed a sequential player number, and the row is left at
   `CREATED` forever. Rejected uploads permanently burn numbers out of a
   supply of 2000.

2. **`/api/jobs/:id/layers` has no payment check** (`server.ts:704`). Neither
   do the four per layer endpoints below it. Anyone holding the job UUID can
   fetch the unwatermarked card before paying. The random UUID is acting as a
   capability token. This is a deliberate conversion trade, not an oversight,
   but it is a trade.

3. **Gemini fails open.** The moderation call is wrapped in try/catch and the
   catch only logs (`server.ts:319`). `modResult` stays `"ACCEPT"`, so if the
   API errors or times out, the upload proceeds unmoderated.

4. **Retry and progress counters live in memory.** `videoGenInProgress`,
   `cardVideoGenInProgress` and `videoFailCounts` are a Set, a Set and a Map at
   module scope (`server.ts:23`, `:24`, `:27`). They reset on every deploy and
   they do not work across more than one instance.

5. **No completion notification for videos.** The client poll is the only
   delivery path. Close the tab and nothing tells you.

6. **No tests. No error tracking.** Neither exists in this repository.

7. **`.env.example` documents `BASE_URL`, but the code reads `PUBLIC_URL`**
   (`server.ts:78`). Following the example file leaves absolute URLs in emails
   and OG tags pointing at the fallback.
