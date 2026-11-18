# The landing page

`public/landing.html` is the marketing page at `/`. It is a plain HTML
document, not a React route, and that is the first thing to be able to explain.

## Why it is a separate document

The page is built with a design kit (tasteskill) whose `public/assets/system.css`
styles bare elements: `h1`, `p`, `a`, `ul`, `body` and so on. A grep for rules
that start with a bare tag name finds about 33 of them.

Loading that stylesheet inside the React app would restyle every other route:
`/create`, `/analytics`, `/terms` and `/privacy`. So the landing page is its
own document with its own stylesheets, and nothing it loads can reach the app.

## How it is served

`server.ts:1254`:

```ts
app.get("/", (_req, res) => {
  const file = process.env.NODE_ENV === "production"
    ? path.join(process.cwd(), "dist", "landing.html")
    : path.join(process.cwd(), "public", "landing.html");
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(readFileSync(file, "utf8"));
});
```

It is registered **before** the Vite middleware and before
`express.static(distPath)`, so it wins `/` in both dev and production. Vite
copies `public/` into `dist/` at build time, which is why the production branch
reads from `dist`.

Everything else still falls through to the React app. `/create` is untouched.

## What the page does not get for free

Because it is outside React, three things had to be reimplemented as small
vanilla fetches in the page's own script block:

- the page view ping to `POST /api/analytics/pageview`
- the registry count from `GET /api/registry/count`
- the currency conversion, ported from `src/hooks/useCurrencyPrice.ts`

The currency logic is a direct port, including the timezone table and the
approximate marker. Gumroad charges in USD, so USD is the base and converted
figures are prefixed with the approximate sign.

## The design, as dealt

tasteskill deals design decisions rather than letting them be chosen by taste.
What came out, and what the page actually declares:

| Decision | Value |
|---|---|
| Page kind | software |
| Hero | centred (`hero hero--centred`) |
| Palette | candy-on-black: bg `#000000`, surface `#0d0d0d`, ink `#ffffff`, accent `#93f1f7` |
| Type | Funnel Display, Funnel Sans, DM Mono |
| Nav | nav-centre (`nav nav--centre`) |
| Footer | footer-dark (`footer closing footer--dark ground-inverse`) |
| Close | close-word (`closing__cta close--word`) |
| Moment | word-highlight on `#bounty` |

Five sections: the hero board, `#how`, `#bounty`, `#issued`, and the closing
footer `#contact`. The price lives inside `#issued`, not in a section of its
own.

### The moment that was removed

The deal originally included a second moment, `iris-opens`, on `#issued`. It is
gone. There is no `iris-opens/moment.css` link in the head any more and no
`data-moment="iris-opens"` on the section.

It was removed because it produced three separate checker failures on its own,
all from the stage element it injects at runtime, and it caused a real
accessibility bug: the moment sets inline `opacity: 0` on each block until the
scroll reveals it, so a keyboard user could tab to the price button while it
was invisible. Carrying waivers for a decorative scroll effect that also breaks
focus was the wrong trade. The deal permits one or two moments, so keeping only
`word-highlight` is still within it.

## The responsive rules, and the measurement behind each

Every media query in the page exists because something was measured at a
specific size. The numbers are in the comments in the file.

### `--h` is in the stylesheet, not in `style` attributes

```css
#how, #bounty, #issued { --h: 1; }
```

The section screen counts were originally written as `style="--h:1"` on each
section. That silently broke the tablet rules: **an inline custom property
beats a media query**, so a `@media` block trying to raise `--h` to 2 did
nothing at all. Moving the declarations into the stylesheet is what made the
cascade work.

This is the single most useful thing on this page to remember. Inline styles
win over media queries, including for custom properties.

### Tablet, 640 to 1199px

```css
@media (min-width: 640px) and (max-width: 1199px) {
  #how .grid.steps > article { grid-column: span 4; }
  #how .panel { --p-h: clamp(220px, 32vh, 420px); }
}
```

The kit's 12 column grid collapses to one column in this range, so the three
step cards stacked and `#how` grew to 1.52 screens at 768 by 1024. Forcing the
section to two screens instead left 42 percent of it empty at 820, which was
worse, so the cards stay in a row.

The panel height keys off `vh`, not `vw`, because the step pictures are
portrait. At the kit's own `--p-h` the three steps left 406px empty under them
at 820 by 1180 while pushing the section to 1.51 screens at 1024 by 768. One
width based rule cannot serve both; a height based one can.

### Tablet, 640 to 1023px only

```css
@media (min-width: 640px) and (max-width: 1023px) {
  #issued .grid.get > article { grid-column: span 6; }
}
```

A separate, narrower range. Extending the two-up rule to 1199 broke 1024, where
the kit's own columns already fit.

### Phone, 639px and under

```css
@media (max-width: 639px) {
  #how { --hm: 2; }
  #issued .grid.get > article:nth-of-type(1) > .panel { display: none; }
  #contact .footer__col { grid-column: span 6; }
  #contact .closing__links { gap: var(--s-5); }
  #contact .footer__lede { font-size: var(--t-small); }
  #contact .footer__col:nth-of-type(2), #contact .footer__col:nth-of-type(3) { display: none; }
  .hero__c > .pill .muted { display: none; }
}
```

Measured at 390 by 844:

- `#how` ran 1.92 screens. Three picture cards genuinely need two screens on a
  phone, so `--hm: 2` gives it two. `--hm` is the kit's phone screen count.
- `#issued` ran 1.28 screens. The bulletin picture already appears twice on a
  phone, in the hero board and in step three, so the third copy is dropped and
  the section fits one screen.
- The footer ran 1.13 screens, 109px over. Two of its four columns hold only
  links the nav and the button above already carry, so a phone shows the card's
  links and the legal ones.
- The scarcity pill ran 222px wide against a 342px container, which is wider
  than half without sitting on the container's lines. Dropping its muted
  qualifier brings it to 123px.

### The hero board

```css
.hero--centred .hero__window { --ground-bg: #0d0d0d; }
.board { object-fit: contain; object-position: center top; }
@media (max-width: 639px) { .board { object-fit: cover; } }
```

Two separate problems solved here.

The kit's hero window falls back to a sand ground, `#d9ccb7`. Against a near
black palette that rendered as a beige slab with the bulletins floating tiny
inside it. No checker caught this; it was only found by looking at the page.
Setting `--ground-bg` is the clean fix, because the kit's rule is
`background: var(--ground-bg, #d9ccb7)`.

The board itself is one composited image, not three separate cards. Three tall
cards in a 288px window can only cover about 14 percent of the screen, and
shrinking them to fit cut them. `contain` keeps the card headers and bounty
figures whole where the window is wide; a phone's window is taller than it is
wide against a 2.67 aspect strip, so there `cover` fills it and the middle
bulletin reads whole.

### The panels

```css
.panel { --ground-bg: #0d0d0d; }
.steps article:nth-of-type(3) img { object-fit: contain; }
```

The same sand ground applies to card panels, which is why every panel sets it.

The kit's panels are portrait boxes sized by `--p-h`. The step pictures were
originally 4:3 landscape and were being cover-cropped into tall slivers: at 820
the third one had sliced "SUNFALL CITY" down to "NFALL CITY" and "VESPER" to
"ESPER". The pictures are now 3:4, and the third fits rather than crops, since
a 3:4 crop of the card's foot cannot exist without cutting the charges off at
the sides.

## Checker status at the time of writing

The gate passed, with one waiver that has since been deleted along with the
moment that caused it. The last full run still had open findings at some
widths, and one finding, an `off-grid` claim that 40 elements sit at 29px
against a 24px margin, could never be reproduced: those elements measure
exactly 24 when queried on the live page. It was not fixed and was not waived.
Do not claim the page is certified clean at every width.
