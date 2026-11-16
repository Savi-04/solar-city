# Sunfall City — page plan (tasteskill 2.5.1)

**Line 1 — kind:** software (page type `software`, site-kind `software`, kind `software`).
Not `gaming`: the gaming plan requires a trailer, a world, a screenshot strip, Steam/PlayStation/
Epic marks and a wishlist action. We have no game. Declaring gaming would build a page that
implies we are shipping one during the GTA 6 window, which is both untrue and the exact
confusion that creates trademark exposure.

**Line 2 — the deal:**
palette `candy-on-black` (bg #000000, surface #0d0d0d, ink #fff, accent #93f1f7) ·
type `funnel` (Funnel Display / Funnel Sans + DM Mono) · hero `centred` ·
moments `word-highlight` + `iris-opens` · nav `nav-centre` · footer `footer-dark` ·
close `close-word` · rhythm `dark-band` · buttons `tonal` · mark `ring` · radius `soft`

*Why the palette fits:* the first dealt palette (`soot-pale-lime`) was rejected under the
clash rule: a lime accent fights the card artwork, which is magenta, tangerine and gold, and
the card is the one thing every screen must sell. `candy-on-black` puts a pure black ground
under it so the card carries all the colour, and its teal accent sits opposite the card's
magenta rather than competing with it.

*Open issue:* this palette's inverse band is pale green (#9ae187). Validate the one
`dark-band` section against the card in the browser; if it fights, that section drops to
`space` rhythm.

---

## Sections (each 1 or 2 screens at 1440x900)

| # | id | one idea | picture | kind | screens | moment |
|---|---|---|---|---|---|---|
| 1 | `hero` | Your face on the wanted board | the card, rising from a lit frame | object | 1 | hero entrance (`data-enter`) |
| 2 | `how` | Three steps, about a minute | 3 feature cards + 1 pulsing diagram | diagram | 1 | — |
| 3 | `bounty` | Everyone on the board has a price | large statement, type-led | type | 1 | **word-highlight** |
| 4 | `what-you-get` | The bulletin, and two videos | card + 2 video frames, open cards | use | 2 | **iris-opens** |
| 5 | `price` | One payment, no account | type + the strikethrough price | type | 1 | — |
| 6 | `close` | close-word + footer-dark | — | — | 1 | — |

One effect only (software is tech): a low sunset-haze shader ground behind the hero card,
never on top of it. Zero other WebGL. Four live contexts is the cap; we use one.

## Copy spine (written before any markup)

- **h1** (36 chars max, names category + buyer): "Get your face on the wanted board"
- **news pill:** "2,000 bulletins. One per person."
- **lead, carries one hard fact:** the price and the time to first card.
- **buttons:** "Get on the bulletin" (primary) / "See a bulletin" (secondary)
- **statement for word-highlight:** one sentence where the accent word is the bounty.
- Voice: flat, procedural, sheriff's-office register. No hype adjectives, no "unleash",
  no "transform". The absurdity does the work, so the copy stays deadpan.

## What this plan does NOT do

- No GTA, Grand Theft Auto, Vice City, Leonida, Rockstar or Take-Two reference anywhere,
  including meta tags and ad copy.
- No invented reviews, user counts or testimonials.
- No claim that anything here is a game.
