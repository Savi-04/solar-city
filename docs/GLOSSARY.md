# Glossary

Plain definitions for the terms in this project and the parts of the stack that
are not self explanatory.

## This project's own terms

**Bulletin.** The product. A MOST WANTED poster card, 800 by 1066 pixels,
carrying a portrait, an alias, charges, a jurisdiction, a case number and a
bounty.

**Player number.** The sequential registry number assigned at upload, from 1 up
to 2000. Assigned atomically inside the INSERT (`src/db.ts:114`) so two
uploads cannot collide. It appears on the card as the case number and it is the
seed for the bounty.

**Bounty.** The reward figure on the card. Derived from the player number by a
fixed formula (`src/card-template.ts:96`) and never stored. Same number in,
same bounty out, which is why the page can say the office sets it and it never
changes.

**The registry.** The cap of 2000 bulletins (`src/db.ts:172`). `issued` counts
rows, `remaining` is 2000 minus that.

**Character video.** The 10 second clip of the person on the Sunfall strip.
Made by `generateCardVideo`, despite the name. Fires automatically at payment.

**Card video.** The 8 second clip of the bulletin itself turning in the light.
Made by `generateCardProductVideo`. On demand only.

**Complete token.** A one time random token stored on the job row and checked
when Gumroad redirects back (`server.ts:838`). Without it you cannot mark a job
paid, so it is the payment bypass guard.

**Download token.** A separate random token minted at payment, used to gate
video and asset downloads so only the buyer can fetch them.

**Public id.** The short opaque id minted at payment and used in the shareable
`/id/:publicId` URL, so the internal job UUID is never exposed publicly.

**Stand-in face.** A synthetic portrait generated for the demo bulletins, used
so no real identifiable person appears on a wanted poster.

## The stack

**fal storage and fal models.** Two different services from the same vendor,
and confusing them is the most common mistake here. fal **storage** is a file
host: you upload an image and get a URL. fal **models** are the AI endpoints
you call with that URL. This app uses both.

**fal proxy.** `/api/fal/proxy` (`server.ts:213`). The browser is configured to
reach fal storage through this server rather than directly, so `FAL_KEY` never
reaches the browser. The consequence is that image bytes pass through this
server, streamed as a raw body. They are not stored.

**nano-banana-2/edit.** The fal image model that relights the portrait. It is
an edit model: it takes an existing image plus a prompt and modifies it, rather
than generating from text alone. The prompt insists facial geometry and
identity stay unchanged and only the surface rendering is upgraded.

**flux/schnell.** The fal text to image model used once to make the three
synthetic stand-in faces. "Schnell" is the fast, cheap variant.

**Kling reference-to-video.** `fal-ai/kling-video/o3/standard/reference-to-video`.
A video model that takes reference images, not just a text prompt, and keeps
the subject's identity consistent across the generated frames. That is why the
portrait is extracted back out of the stored card layer and handed to it.

**sharp.** The Node image library used for every resize, mask and composite.
It wraps libvips, which is why it is fast enough to build a card in under 10
seconds.

**better-sqlite3.** A synchronous SQLite driver. Synchronous is a feature here:
no callbacks, no connection pool, and the atomic player number INSERT is a
single statement.

**WAL mode.** Write Ahead Logging, set at `src/db.ts:9`. Instead of writing
changes over the main database file, SQLite appends them to a `-wal` file.
Readers do not block the writer and the writer does not block readers. It is
why `jobs.db-wal` and `jobs.db-shm` sit beside the database.

**esbuild CJS bundle.** The production build step. esbuild bundles `server.ts`
and its TypeScript into one CommonJS file, `dist/server.cjs`, so production
runs plain Node with no TypeScript toolchain. `--packages=external` leaves
`node_modules` out of the bundle, which matters for native modules like sharp
and better-sqlite3 that cannot be bundled.

**tsx.** Runs TypeScript directly in development without a build step. This is
what `npm run dev` uses.

**Vite middleware mode.** Rather than running Vite as its own server, Express
mounts it as middleware, so one process serves both the API and the frontend on
one port.

**Helmet and CSP.** `helmet` sets security headers including a Content Security
Policy. The policy needs explicit `style-src` and `font-src` entries for Google
Fonts, or the fonts are blocked and silently never render.

**SSRF guard.** Server Side Request Forgery: tricking a server into fetching a
URL of the attacker's choosing, often an internal address. The upload handler
allowlists `fal.media` and `storage.fal.ai` (`server.ts:274`) so it will only
fetch from those.

**Fails open.** An error path that lets the request continue rather than
blocking it. The Gemini moderation call fails open: if it errors, the upload
proceeds unmoderated. The opposite, fails closed, would reject on error.

## tasteskill terms

**tasteskill.** The design skill used to build the landing page. It supplies a
CSS kit, layout rules, and checkers that enforce them in a real browser.

**The deal.** tasteskill decides design choices by dealing them from weighted
lists rather than letting them be picked by taste: the hero shape, the palette,
the typeface pairing, the nav, the footer, the closing section, the moment.
Keeping a history file means successive pages differ.

**Moment.** A single piece of scripted motion given its own section, such as
words highlighting as they scroll (`word-highlight`) or a section revealed
through an opening circle (`iris-opens`). A page carries one or two. This page
carries one.

**Ground.** A background surface token. `ground-base`, `ground-surface`,
`ground-inverse`. The kit's default falls back to a sand colour, which is why
the page explicitly sets `--ground-bg` wherever a kit frame appears.

**The gate.** `gate.mjs`, the finish check. It drives a headless Chrome over
the page at several widths and blocks until the findings are fixed or waived.
It writes state to `.taste-skill/gate.json`.

**Waiver.** A recorded judgement that a specific finding is false, with a
reason, in `.taste-skill/waivers.json`. Five at most. This project currently
has none: the one waiver that existed was deleted along with the moment that
caused it.

**Screens.** The kit's unit of vertical rhythm. Every section after the hero
must be exactly one or two viewport heights tall and must start on a whole
screen boundary. `--h` sets the count, `--hm` sets it for phones.
