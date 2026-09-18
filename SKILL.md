---
name: deevee
description: >
  Deevee — a library of 42 animated, interactive, portable chart forms that
  picks by measuring the data rather than guessing. Trigger on any request to
  visualize a dataset, choose or recommend a chart form, browse a gallery of
  chart options ("show me a gallery to pick from"), or build a high-fidelity
  animated data graphic — especially when it should be embeddable (iframe or
  snippet), needed at more than one size, or when "what fits this data" should
  be answered by measuring. Self-contained: everything ships inside the skill
  folder and runs on plain Node with no install and no network.
---

# Deevee

Deevee is not a freeform chart-drawer. It holds 42 built, animated chart forms,
each with a `fit()` function that reads a dataset's actual shape and says yes or
no with a reason. The library does the measuring; you read the verdict out loud
and build from it.

Everything lives inside this skill folder. Paths below are relative to it — call
it `$SKILL`. Nothing here reaches the network, at build time or at view time.

```
cd "$SKILL" && node scripts/deevee.mjs help
```

## 1. The four commands that matter

```
node scripts/deevee.mjs gallery --open        # every form, live and animated, one page
node scripts/deevee.mjs fit <data>            # what this data earns, and what it doesn't
node scripts/deevee.mjs make <data> [--form S] [--size KEY|all]
node scripts/deevee.mjs png  <data> [--form S] [--size KEY|all]
```

`<data>` is a `.csv`, `.tsv` or `.json` file, or `--sample <id>` for one of the
bundled datasets (`node scripts/deevee.mjs samples` lists them with provenance).

`doctor` reports what is installed. `forms` lists the library as text.

## 2. "Show me a gallery to pick from"

This is a first-class command, not a thing to hand-build:

```
cd "$SKILL" && node scripts/deevee.mjs gallery --open
```

It writes one self-contained HTML file (~1MB) into the current directory and
opens it. Every form is drawn **live and animated** on a dataset its own
fit-check accepted, with its question, the data shape it needs, its honesty
note, and the exact command to build it on the user's data. Filter by tier,
search, and switch the preview aspect between Card / Half-slide / Slide /
Square to see how each form behaves at a different shape.

Cards mount as they scroll into view, so the build animations are actually
watched rather than all firing before the reader arrives.

Pass `--out <path>` to put it somewhere specific. Hand back the full absolute
path plus `open "<path>"` — never a bare path.

## 3. The pipeline — measure, never guess

Three composable ESM pieces, all importable without a browser:

```js
import { profile } from './scripts/profile.mjs';
import { reviewLibrary } from './assets/modules/gallery-registry.mjs';
import { buildIframePage } from './scripts/build-embed.mjs';

const p = profile(csvText, { format: 'csv' });   // shape-detect
const verdicts = reviewLibrary(p);               // one verdict per form, always
const fits = verdicts.filter(v => v.fits);       // { slug, why, bindings, confidence, options }
const html = await buildIframePage(fits[0].module, {
  data: p.rows, bindings: fits[0].bindings, options: fits[0].options,
  copy: { headline, dek, source }, theme: 'light',
});
```

**Rules, non-negotiable:**

- `reviewLibrary()` returns a verdict for **every** form, fit or not. When one
  is ineligible, quote its `why` verbatim — it is already written as the honest,
  specific reason (a cardinality cap, a missing time axis, a rate that doesn't
  sum to a whole). Never soften a refusal, and never force a binding a form
  declined.
- **The same table pivoted differently gets different verdicts.** Long vs. wide
  is the usual split: a vendor×attribute battery unlocks dumbbell and parallel
  measures in wide form, and punchcard, treemap and sunburst in long form — not
  both from one pivot. If the data could reasonably be shaped two ways, profile
  both and say so rather than silently committing to whichever you built first.
- **State the shortlist out loud before building**, one line, including at least
  one notable refusal: `Fits: <slug> ("<why>")… Refused: <slug> ("<why>")`. The
  refusals are informative, not noise — they tell the user what their data is
  missing.
- If nothing fits, say so and say what shape would change the answer. Do not
  reach for a general-purpose charting library to fill the gap; a form this
  library refused is a form the data can't carry honestly.

## 4. The forms

Four tiers — **Conventional, Unconventional, Experimental, Interactive**. Never
hardcode the roster or the count in anything you tell the user; re-derive it:

```
cd "$SKILL" && node scripts/deevee.mjs forms
```

Each entry's full definition (`title`, one-liner, `answers`, `data` shape,
`honesty` note, `build`/`rest` animation, `fit()`) lives in
`assets/modules/gallery-registry.mjs`. Read the entry; don't reconstruct it from
memory — the `honesty` text is the shipped copy.

A module file with no registry entry is **invisible**, not optional: nothing can
recommend it and nothing can reach it. Add one, add both.

## 5. Animation

Every form has a named **build** (the entrance) and **rest** (the idle state).
They are registry fields, not improvised per request:

- `build`: `trace` (a line draws on) · `grow` (bars extend from the baseline) ·
  `ring` (radial sweep) · `stretch` (dumbbell dots separate) · `rain` (points
  fall in) · `sankey` (nodes then links, staged) · `swell` (streams grow from
  the centre line) · `petal` (wedges bloom) · `wave` (cells sweep) · `tiles`
  (big anchors land first) · `rise` (rows lift) · `emerge` (contours fade up) ·
  `count` (units tally in reading order).
- `rest`: `tracer` (a dot re-reads the line) · `walk` (a spotlight steps through
  categories) · `peak` (static — most forms) · `flow` (particles drift along
  links) · `timescan` (a cursor scans the time axis) · `wavebreathe` (a slow
  shimmer) · `ripple` (bands pulse outward) · `attract` (the interactive tier's
  hover preview, yields to a real cursor).

**Rest states are paint-only.** A rest animation may never change a mark's
geometry or position: the picture must be identical whether the viewer looks
mid-loop or paused, because the loop is decoration on a settled read, not the
read itself.

`prefers-reduced-motion` is honoured by the shared runtime — the chart arrives
drawn rather than not arriving.

## 6. Interactivity

Six forms (the `int-*` tier) are dedicated interactive remakes, not a plain form
with a tooltip bolted on: click-to-isolate (sankey, chord), click-to-drill
(sunburst, treemap), scrub-to-read (stream), hover-for-ego-network (network).
Any form can carry a hover tooltip; the `int-*` tier exists where the
interaction **is** the intended reading path.

**Hard rule.** A raster export carries zero instructions to interact. `deevee
png` sets `static: true`, which is how a module drops its "hover to…" clause —
a PNG cannot be hovered, and a caption telling its reader to try anyway is a
shipped bug. Before treating an exported image as done, check its copy for
"click" / "hover" / "drag" / "scrub" and confirm they only appear on the live
path.

## 7. Sizes — multi-size without lying

One set of named sizes serves both the live and raster paths, so "square" means
the same composition in both:

| key | box | for |
|---|---|---|
| `slide-16x9` | 1200×675 | a widescreen deck page |
| `half-slide-4x3` | 900×675 | beside a column of text |
| `square` | 1080×1080 | a social post or document inset |
| `story-9x16` | 1080×1920 | phone-tall |
| `banner` | 1600×500 | a page header strip |
| `card` | 560×420 | a dashboard tile |
| `email-600` | 600×480 | the 600px email column |

```
node scripts/deevee.mjs make sales.csv --size all      # every size, at once
node scripts/deevee.mjs make sales.csv --size square
```

The embed itself is always **responsive** — a fixed-pixel stage was a mistake
this library already made once and had to unwind. A sized artifact is that same
responsive embed viewed through a box of known dimensions, which is exactly what
the destination imposes anyway.

**What survives small, and what doesn't.** Low-cardinality categoricals (bar,
dumbbell, pie under ~6 slices, isotype units), a single big stat, anything whose
meaning survives with 3–5 marks — those translate. Anything whose reading
depends on comparing many small marks precisely — parallel measures past 3–4
axes, punchcard and marimekko grids, deep hierarchies, dense hexbin and contour
fields — needs real estate. Compressing those doesn't make them smaller, it
makes them wrong.

Under a 300px-tall box the frame goes **compact on its own**: the dek drops and
the source note clamps to two lines, with the full text kept on the element's
`title` so nothing becomes unrecoverable. The headline, the plot and the source
all survive.

**When the form is right but the room is wrong, redesign — don't shrink.**
Building "a small version" is not "the same drawing at 40%". It is deciding what
the small version leaves out, and saying so in the copy.

**Measure it, don't eyeball it.** Render at the target size and look at the
result before calling it done — the same standard the fit-checks apply to data
shape, applied to physical size.

## 8. Theming

A module bakes no colour. Everything resolves CSS custom properties:
`--vf-paper --vf-ink --vf-muted --vf-hair --vf-accent --vf-mark --vf-cat-1..6
--vf-font-headline --vf-font-label --vf-font-figures`.

- `--theme light` (default) and `--theme dark` ship in
  `assets/modules/themes/`. Every colour in them is measured: text-safe at
  4.5:1 against both the paper and the plot field, and no two categorical
  entries land within a perceptual distance of 45 under protanopia,
  deuteranopia or tritanopia.
- `--theme none` inlines no theme, so the piece inherits the host page's own
  custom properties — the right choice for a snippet dropped into a design
  system. It also carries a `prefers-color-scheme` fallback so a themeless
  embed still reads on a dark page.
- **Colour carries state, not an enumeration.** `--vf-accent` marks what the
  chart is about — the peak, the selection, the series the headline names. One
  hue per category, by default, is what makes a picture look like confetti.
  Reach for the categorical ramp when the encoding is genuinely categorical.
- To re-skin for a brand: replace `assets/modules/themes/light.css`. No module
  code changes. Check the replacement's contrast rather than assuming it.

## 9. Output protocol

1. Profile the data. State the shape out loud — fields, cardinality, whether
   there is a time axis. Don't skip to a pick.
2. Run the fit check. State the shortlist **and** at least one notable refusal
   with its real reason.
3. Pick, with a stated reason. If a different pivot would unlock a different
   set, say which pivot you chose and why.
4. Build at the size the destination actually needs. If both a small and a large
   context matter, build both explicitly — don't hand over one and call it
   "responsive" without checking.
5. Before delivery: confirm no interaction copy leaked into a static export
   (§6), and that `headline` / `dek` / `source` are real and computed, never
   placeholders.
6. Hand back full absolute paths and how to open each one (`open "<path>"`),
   never a bare path.

## 10. Layout

```
$SKILL/
  scripts/deevee.mjs              the CLI — every command above
  scripts/gallery.mjs             builds the browsable gallery
  scripts/profile.mjs             shape-detects a CSV/TSV/JSON
  scripts/build-embed.mjs         inlines a form into portable HTML
  scripts/render-png.mjs          rasterizes (the one optional-dependency path)
  scripts/sizes.mjs               the named sizes, shared by both paths
  assets/modules/                 the 42 forms + the shared runtime + the registry
  assets/modules/themes/          light.css, dark.css
  assets/vendor/                  d3, d3-sankey, papaparse — vendored, no npm install
  assets/fonts/                   Space Grotesk / Inter / IBM Plex Mono (SIL OFL)
  samples/                        bundled datasets + index.json with provenance
```

## 11. Requirements

Node 18+. Nothing else, for everything except `png`.

`png` rasterizes in a real browser and needs Playwright:
`npm i playwright && npx playwright install chromium`. `doctor` says whether it
is there. Without it, `make` still produces live animated HTML, which a browser
can print to PDF or capture as an image.

## 12. When not to use this

- **A brand-governed asset** — the default theme is deliberately neutral, and a
  brand's own type, colour and geometry rules win over it. Re-theme first (§8),
  and don't ship the default theming into a client deliverable unmodified.
- **A one-off chart in a context with no access to this folder** — for example
  an Artifact built for someone else's data. Use a general-purpose charting
  approach there.
- **Motion-graphics storytelling beyond a single chart** — sequenced scenes,
  sound-synced reveals, a narrated build. Deevee is the chart-form and data-fit
  layer such a piece can draw a form from, not a video tool.
