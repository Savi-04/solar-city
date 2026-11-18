# The prompt to open a new chat with

Point the session's working directory at this project folder, then paste the
block below. Everything in it is true of the code as of 18 Nov 2026; it exists
so the session does not have to guess or re-derive any of it.

---

```text
Read docs/HANDOFF.md and claude.md before doing anything. Together they cover
the architecture, the routes, the data, the standing rules and the open items,
so don't re-derive any of it.

What this is: a player ID card generator. Selfie in, safety check, portrait
restyled, card composited server side, paid through Gumroad, delivered at a
public URL. One Express process serves the API and the frontend. One SQLite
file, jobs.db, holds everything.

Five things that will trip you up if you don't know them:

1. / is NOT a React route. It is public/landing.html, a standalone document
   served by an Express handler at server.ts:1254 registered ahead of the Vite
   and static middleware. src/pages/LandingPage.tsx is dead code. Editing it
   changes nothing. The page is separate on purpose: the design kit's
   system.css has bare-element rules that would restyle /create, /analytics,
   /terms and /privacy.
2. PUBLIC_URL, never BASE_URL. server.ts:78 reads PUBLIC_URL and falls back to
   the hardcoded v1 domain. .env.example used to name the wrong one.
3. The root README.md, ARCHITECTURE.md and Staging-config.md are stale v1 text
   (Veo, Multer, Stripe, "Neon ID Card", the old repo name). Use docs/.
4. There are no tests. npm run lint is tsc --noEmit, a type check only.
5. Media is stored as base64 columns in jobs.db, which is why the file is large.

Rules, not preferences:

- Never print buyer data. jobs and consent_log hold emails, photos, IP hashes.
  Aggregate counts only, never rows, never in logs or in chat.
- Never copy jobs.db, jobs.db-shm, jobs.db-wal, videos/ or .env anywhere.
- No trademarks: no GTA, Grand Theft Auto, Vice City, Leonida, Rockstar or
  Take-Two names, logos, fonts or character likenesses in the product, copy,
  metadata, assets or ads. The neon crime-city aesthetic is fine, the names
  are not.
- Do not trigger video generation. Kling is a paid call per run and that path
  has never been tested end to end.
- Generation, payment and compositing work today. Do not break them. Changes
  go behind a new path or a flag until proven.
- Nothing deploys until Railway is paid.
- No personal photos of me on the site.

How to verify your own work: npm run lint, then npm run dev and check
http://localhost:3000. For a card without paying, use
http://localhost:3000/?admin_mode=<ADMIN_SECRET> (spends one Gemini call and one
fal call, no video). Before claiming anything about production, remember the
landing page is read from dist/ there, not public/, so run npm run build and
npm start too.

Working style: concise, first principles, no jargon, no glorifying. Don't
fabricate. If you haven't verified something, say so.

Then tell me what you found and wait. Don't start changing things.
```

---

Then say what you actually want done in your next message. Giving the session a
task in the same breath as the briefing makes it start editing before it has
read anything.
