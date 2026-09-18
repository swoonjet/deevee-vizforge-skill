# Deevee

42 animated, interactive chart forms that pick themselves by measuring your data.

Everything is in this folder. No `npm install`, no network, no config.
Node 18 or newer is the only requirement.

## Install it as a Claude Code skill

Copy this whole folder into your skills directory:

```
cp -R deevee ~/.claude/skills/deevee
```

Then ask Claude to visualize something, or type `/deevee`.

## Or use it directly

```
cd deevee

node scripts/deevee.mjs gallery --open     # every form, live and animated, one page
node scripts/deevee.mjs fit yourdata.csv   # what your data earns, and what it doesn't
node scripts/deevee.mjs make yourdata.csv  # build the best fit
node scripts/deevee.mjs help
```

### Show me a gallery to pick from

```
node scripts/deevee.mjs gallery --open
```

One self-contained HTML file, ~1.5MB. Every form drawn live on a dataset its own
fit-check accepted, with the question it answers, the data shape it needs, what
it does to stay honest, and the command to build it on yours. Filter by tier,
search, and switch the preview shape between card, half-slide, slide and square.

### Build one on your data

```
node scripts/deevee.mjs fit sales.csv
node scripts/deevee.mjs make sales.csv --form conv-bar --headline "Q4 by region"
node scripts/deevee.mjs make sales.csv --size all
node scripts/deevee.mjs make sales.csv --theme dark
node scripts/deevee.mjs make sales.csv --snippet     # to paste into a page you control
```

The output is one self-contained HTML file: the module, the runtime, d3 and your
data, all inlined. It makes zero network requests, so it works in an iframe, in
Notion or Confluence, from a thumb drive, or offline.

`--size` takes `slide-16x9`, `half-slide-4x3`, `square`, `story-9x16`, `banner`,
`card`, `email-600`, or `all`. The embed itself is always responsive; a sized
file is that same embed pinned to a known box, which is what the destination
imposes anyway.

### PNG, for decks that cannot host HTML

```
npm i playwright && npx playwright install chromium
node scripts/deevee.mjs png sales.csv --size square
```

The only part that needs an install. `node scripts/deevee.mjs doctor` tells you
what is and is not available.

## What "it picks by measuring" means

Every form carries a function that reads your data's actual shape — how many
columns, of what types, at what cardinality, with or without a time axis — and
answers yes or no with a specific reason. `fit` prints both the shortlist and
the refusals:

```
conv-line        needs a date column, or a numeric column that is genuinely an
                 ordering like a year
conv-dumbbell    needs two numeric columns, a before and an after (found 1)
conv-slope       "quarter" has 4 values in no particular order, and "the first
                 and last" of an unordered column is not a comparison
```

Those refusals are the useful half. A form that refuses your data is a form your
data cannot carry honestly, and the reason usually tells you what column is
missing.

The same table pivoted the other way gets different answers, so if yours could
reasonably be long or wide, run `fit` on both.

## Theming

No module contains a colour. Everything resolves CSS custom properties, so
re-skinning the whole library means editing one file:
`assets/modules/themes/light.css`.

The shipped light and dark themes are measured, not chosen by eye: every token
clears 4.5:1 as text against both the paper and the plot field, and no two
categorical colours land within a perceptual distance of 45 under protanopia,
deuteranopia or tritanopia.

`--theme none` inlines no theme at all, so a snippet inherits the host page's
own `--vf-*` properties.

## The bundled data

21 datasets under `samples/`, each with a provenance line
(`node scripts/deevee.mjs samples`). Some are real and cited — Palmer Penguins,
Gapminder, the USGS earthquake catalog. Some are illustrative teaching sets and
say so. Where a figure is approximate or hand-compiled, the line says that too.

The gallery draws on these. They are not your data — run `fit` on yours.

## Licence notes

d3 and d3-sankey (ISC), papaparse (MIT) and the three typefaces — Space Grotesk,
Inter and IBM Plex Mono, all SIL Open Font License — are vendored under
`assets/`. They are here so the tool works with no install and no CDN.
