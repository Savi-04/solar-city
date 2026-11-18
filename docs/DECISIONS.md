# Decisions and trade-offs

Each entry is a decision, why it was made, and what it costs. The cost half
matters: a decision without a stated cost is marketing, not engineering.

## The card is generated before payment

`buildCardInBackground` runs straight after upload (`server.ts:330`). The user
sees a finished, watermarked card before being asked for money. Payment buys
the permanent link, the download token and the videos.

**Why.** Showing the real result before asking is what makes people pay. The
preview is the pitch.

**What it costs.** Every upload spends a fal stylisation call, paid or not. The
conversion rate has to carry the cost of everyone who never pays. It also means
`/api/jobs/:id/layers` can serve the unwatermarked card before payment, with
the random job UUID as the only thing guarding it. That is a deliberate trade,
and it is worth saying so rather than describing it as a bug.

## One source of truth for the card artwork

All card art lives in `src/card-template.ts`, exported through `buildCardSvgs`.
Both the real pipeline and anything that renders a sample go through it.

**Why.** v1 had the card artwork duplicated in two places, and they had already
drifted apart: the landing page demo was still rendering in the old v1 teal
while real cards had moved on. Nobody noticed, because nothing forced them to
agree.

**What it costs.** Very little. Anything that wants a card has to go through
one function signature. That is the point.

## No borrowed trademarks

No GTA, Grand Theft Auto, Vice City, Leonida, Rockstar or Take-Two names,
logos, fonts or character likenesses appear anywhere: not in the product, the
copy, the metadata or the assets.

**Why.** The product rides a cultural moment. The aesthetic, a sun bleached
neon crime city, is a genre and is fine to work in. The names are somebody's
property and using them invites a takedown at exactly the moment traffic peaks.

**What it costs.** Less immediate search traffic, since the page cannot name
the thing people are searching for. That is the correct trade.

## Synthetic faces for the demo bulletins

The three demo bulletins use faces generated with `fal-ai/flux/schnell`
(`scripts/gen-standin-faces.ts`), not stock photography.

**Why.** The script says it plainly: a MOST WANTED bulletin built from a real,
identifiable person's photograph depicts them as a wanted criminal. A stock
licence does not make that acceptable, and neither does Wikimedia Commons.
These faces belong to nobody.

**What it costs.** One off generation spend, and the faces are only as good as
the model.

## Demo assets built from material already paid for

Three bulletins exist as `public/demo/card-{a,b,c}.webp`. Everything else shown
on the landing page is derived from them with `sharp` and no API calls:

- `scripts/gen-hero-board.ts` composites the three cards into one 1600 by 600
  board for the hero.
- `scripts/gen-how-strip.ts` cuts the three step pictures: the raw stand-in
  selfie, the relit portrait extracted from the finished card at the pipeline's
  own 140, 100, 520 by 600 rectangle, and the bulletin itself.

**Why.** The step pictures show the real before and after of the pipeline,
which is more honest than a diagram describing it, and it costs nothing.

**What it costs.** The pictures are tied to one demo card. Change the card
design and the step pictures must be regenerated or they will disagree with it.

## A diagram was tried and rejected

`#how` originally led with a tasteskill timeline diagram of the pipeline. It
was removed and replaced with the three real pictures.

**Why.** It produced four separate checker failures on its own: it rendered an
empty SVG, clipped all eight of its labels, put text at 1.9:1 contrast over its
own glow, and its node tiles registered as a third button style on the screen.
Beyond the failures, a diagram describing the pipeline is weaker than
photographs showing it.

**What it costs.** Nothing. The `assets/diagrams` folder was deleted again.

## The iris-opens moment was removed

The design deal included a second scroll moment on `#issued`. It is gone.

**Why.** It injected a stage element at runtime that failed the structural
checks at three widths, and it set inline `opacity: 0` on each block until
scroll revealed it, which meant a keyboard user could tab to the price button
while it was invisible. That is a genuine accessibility defect, not a checker
quibble.

**What it costs.** One less piece of motion on the page. The deal allows one or
two moments and `word-highlight` remains, so the page is still within it.

## The landing page is a separate document

Covered in full in `LANDING-PAGE.md`. Short version: the design kit styles bare
elements, so loading it inside the React app would restyle `/create`,
`/analytics`, `/terms` and `/privacy`.

**What it costs.** Analytics, the registry count and the currency conversion
had to be reimplemented as small vanilla fetches, so that logic now exists
twice: once in React and once in the page. If the pricing rules change, two
places need editing.

## SQLite rather than a hosted database

One `jobs.db` file, WAL mode (`src/db.ts:9`), card layers stored as base64
inside rows.

**Why.** One process, one box, no network hop, no monthly bill, and the whole
state is one file you can copy.

**What it costs.** It pins the app to a single instance with a persistent disk.
It rules out every serverless host, which is exactly why the hosting search
during this project kept coming back to a small always on box. Storing image
layers as base64 in rows also makes the database large quickly.

## Admin bypass exists and triggers real spend

`POST /api/admin/bypass-payment` (`server.ts:184`) marks a job `DONE` without
payment, behind `ADMIN_SECRET`.

**Why.** Testing the post payment delivery path without paying Gumroad.

**What it costs.** It calls `triggerVideoIfReady`, which starts a paid Kling
generation. It is not a free test path. During this build the delivery page was
tested instead by minting a completed job directly in SQLite, which costs
nothing. Video generation remains untested for this reason.
