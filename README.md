# /deevee — the VizForge Gallery skill (lean bundle)

A Claude Code skill for VizForge: a library of 37 portable, animated,
interactive D3 chart modules (Conventional/Unconventional/Experimental/
Interactive tiers). This bundle carries only what's needed to actually
*generate* charts with it — no pre-built demo pages, no rendered thumbnails,
no example galleries.

## What's in this repo

- `skills/deevee/SKILL.md` — the full skill definition.
- `vizforge/` — the minimum slice of the VizForge repo the skill's
  documented pipeline needs:
  - `assets/modules/` — the 37 chart modules + shared runtime (`vf-core.js`)
    + registry (`gallery-registry.mjs`) — the actual generative code.
  - `scripts/` — `profile.mjs` (shape-detect a dataset), `build-embed.mjs`
    (render one module to standalone HTML), `render-module-png.mjs` (render
    to PNG at named sizes), and their shared `lib/`/`shapers/` helpers.
  - `package.json` / `package-lock.json` — run `npm install` inside
    `vizforge/` before using it.

  **~4.5MB**, vs. 1.9GB for the full working repo. Excluded: `node_modules`
  (restored by `npm install`), `exports/` (1.5GB of rendered output),
  `demo/`, `gallery/`, `gallery-fritz/`, `pieces/`, `gallery-candidates/`
  (pre-built example pages and thumbnails — outputs, not the generator),
  `.planning/`, `docs/`, `data/`, `fixtures/`, `scripts/tests/` (none needed
  to *use* the skill, only to develop or verify the modules themselves).

  **Also excluded: `app/`, the live browser studio.** Its routes reach into
  a separate system (the "Atlas," `/viz`) at module-load time — pulling
  in the studio would mean pulling in the Atlas too, which isn't part of
  this skill's job. Everything the skill actually documents (profile a
  dataset, get a verdict per module, render iframe/snippet/PNG) runs
  standalone via plain Node, verified working from this exact bundle.

## Install

```
cp -r skills/deevee ~/.claude/skills/deevee
cp -r vizforge ~/Creative-Projects/vizforge   # or wherever you keep it
cd ~/Creative-Projects/vizforge && npm install
```

If you put `vizforge` somewhere other than `~/Creative-Projects/vizforge`,
update the absolute paths throughout `skills/deevee/SKILL.md` to match.

## Quick smoke test

```js
import { profile } from './vizforge/scripts/profile.mjs';
import { reviewLibrary } from './vizforge/assets/modules/gallery-registry.mjs';
import { buildIframePage } from './vizforge/scripts/build-embed.mjs';

const p = profile('category,value\nA,40\nB,25\nC,20\nD,15', { format: 'csv' });
const fit = reviewLibrary(p).find(v => v.fits && v.slug === 'conv-bar');
const html = await buildIframePage(fit.module, { data: p.rows, bindings: fit.bindings, copy: { headline: 'Test' } });
// html is a complete, self-contained standalone chart page
```
