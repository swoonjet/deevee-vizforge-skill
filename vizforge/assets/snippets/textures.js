// assets/snippets/textures.js
//
// Expressive texture vocabulary (EXPR-01, Phase 15 — 15-CONTEXT.md): three
// pure, seeded, zero-dependency builders — paper-grain, data-honest
// halftone, and riso layered-ink. Every builder returns a plain string of
// inert SVG markup; none touch the DOM, none read global state, none carry
// hidden randomness.
//
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01 — every piece is one self-contained file). Copy this
// module's contents directly into a piece's <script type="module"> block,
// alongside assets/snippets/seeded-random.js (mulberry32) which this file
// imports for any seeded jitter.
//
// Honesty boundary (docs/craft-law.md addendum, 15-CONTEXT.md):
//   - Texture never carries data unless declared. halftoneGrid's dot
//     radius IS an honest encoding channel when used that way — it must
//     never be applied as a decorative photo-filter over marks that aren't
//     the bound data.
//   - Grain/misregistration jitter is ALWAYS seeded. A piece using these
//     builders must survive `gate --deep` double-render byte-identity.
//   - Low-opacity bounds keep contrast checks passing — paperGrainDefs
//     defaults to a near-invisible overlay; callers should not push
//     `opacity` high enough to fight the contrast-check thresholds.
//
// Seed-0 footgun (see scripts/tests/smoke/tier3-honesty.test.mjs for the
// project's other instance of this guard): `seed: 0` is FALSY in JS. Code
// that gates PRNG use behind `if (seed) { ... }` silently treats an
// explicit, meaningful seed of 0 as "no seed" and can fall through to
// non-deterministic behavior. Every seed parameter in this module is
// therefore validated explicitly (`Number.isInteger(seed) && seed !== 0`)
// rather than checked for truthiness — a falsy or non-integer seed THROWS,
// it is never silently replaced or ignored.

import { mulberry32 } from './seeded-random.js';

// Mirrors scripts/design/tokens.mjs's `categoricalOrder` — kept in sync by
// hand (this file is a runtime-inlined snippet, not a build-time consumer
// of tokens.mjs, so it cannot import that array directly). --cat-1.. is
// generated in this exact order by scripts/build-tokens.mjs.
const CATEGORICAL_ORDER = ['blue', 'vermillion', 'green', 'sky', 'mauve', 'amber'];

/**
 * Resolves a house token name to the CSS custom property that carries it.
 * Accepts 'paper' | 'ink' | 'emphasis', any categorical name in
 * CATEGORICAL_ORDER, or a raw `--custom-property` / `var(--x)` string for
 * anything else (sequential/diverging steps, ambient-dark tokens, etc.).
 */
function resolveTokenVar(token) {
  if (token === 'paper' || token === 'ink' || token === 'emphasis') {
    return `var(--color-${token})`;
  }
  const idx = CATEGORICAL_ORDER.indexOf(token);
  if (idx !== -1) return `var(--cat-${idx + 1})`;
  if (typeof token === 'string' && token.startsWith('--')) return `var(${token})`;
  if (typeof token === 'string' && token.startsWith('var(')) return token;
  throw new Error(`resolveTokenVar: unknown house token "${token}"`);
}

/**
 * Validates a required, explicit, non-zero integer seed. Throws rather than
 * silently substituting a default or falling back to Math.random() — see
 * the seed-0 footgun note at the top of this file.
 */
function requireSeed(seed, label) {
  if (!Number.isInteger(seed) || seed === 0) {
    throw new Error(
      `${label}: seed must be an explicit non-zero integer (got ${JSON.stringify(seed)}). ` +
        `seed:0/omitted is FALSY in JS — this builder never silently substitutes an ` +
        `unseeded/degraded fallback, per the project's seed-0 footgun guard.`
    );
  }
}

/**
 * paperGrainDefs({ seed, baseFrequency, numOctaves, opacity, id }) — an SVG
 * `<defs>`/`<filter>` string using `feTurbulence type="fractalNoise"` with
 * an EXPLICIT integer seed (never omitted, never silently 0), piped through
 * feColorMatrix + feComponentTransfer to a low-opacity grain overlay.
 *
 * Reference the returned filter from any element via
 * `filter="url(#paper-grain-<seed>)"` (or the custom `id` you passed).
 * Pure: identical arguments return a byte-identical string.
 *
 * Throws if `seed` is missing, zero, or non-integer.
 */
export function paperGrainDefs({ seed, baseFrequency = 0.9, numOctaves = 2, opacity = 0.05, id } = {}) {
  requireSeed(seed, 'paperGrainDefs');
  if (opacity <= 0 || opacity > 0.15) {
    throw new Error(
      `paperGrainDefs: opacity ${opacity} is out of the documented low-opacity grain range ` +
        `(0, 0.15] — texture must stay subordinate to contrast-check thresholds (craft-law).`
    );
  }
  const filterId = id || `paper-grain-${seed}`;

  return `<defs>
  <filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="${numOctaves}" seed="${seed}" stitchTiles="stitch" result="grainNoise"/>
    <feColorMatrix in="grainNoise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0.9 0.9 0 0" result="grainAlpha"/>
    <feComponentTransfer in="grainAlpha" result="grainOpacity">
      <feFuncA type="linear" slope="${opacity}" intercept="0"/>
    </feComponentTransfer>
    <feMerge>
      <feMergeNode in="SourceGraphic"/>
      <feMergeNode in="grainOpacity"/>
    </feMerge>
  </filter>
</defs>`;
}

/**
 * halftoneGrid({ values, cols, cell, maxRadius, token, jitterSeed }) — an
 * SVG `<g>` of `<circle>` dots laid out on a regular grid, where each dot's
 * RADIUS is a pure function of the bound `values[i]` (normalized against
 * the array's own max absolute value). Dot size IS the honest encoding
 * channel — this is not a decorative photo-halftone filter.
 *
 * `values` (required, non-empty array of numbers) drives layout count and
 * per-dot radius. `cols` defaults to ceil(sqrt(values.length)). No PRNG is
 * used unless `jitterSeed` is supplied, in which case mulberry32(jitterSeed)
 * drives a small (<=15% of cell) position jitter per dot — purely
 * cosmetic, never affecting radius/encoding.
 *
 * Pure: the same `values` (and same `jitterSeed`, if any) return a
 * byte-identical string on every call.
 *
 * Throws if `jitterSeed` is explicitly passed but zero/non-integer.
 */
export function halftoneGrid({ values, cols, cell = 24, maxRadius = 10, token = 'ink', jitterSeed } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('halftoneGrid: values must be a non-empty array of numbers');
  }

  let rand = null;
  if (jitterSeed !== undefined) {
    requireSeed(jitterSeed, 'halftoneGrid(jitterSeed)');
    rand = mulberry32(jitterSeed);
  }

  const gridCols = cols || Math.ceil(Math.sqrt(values.length));
  const domainMax = Math.max(...values.map((v) => Math.abs(v)), 0) || 1;
  const fillVar = resolveTokenVar(token);

  const circles = values.map((value, i) => {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const cx0 = col * cell + cell / 2;
    const cy0 = row * cell + cell / 2;
    const jitterX = rand ? (rand() - 0.5) * cell * 0.15 : 0;
    const jitterY = rand ? (rand() - 0.5) * cell * 0.15 : 0;

    const normalized = Math.max(0, Math.min(1, Math.abs(value) / domainMax));
    const radius = normalized * maxRadius;

    const cx = (cx0 + jitterX).toFixed(2);
    const cy = (cy0 + jitterY).toFixed(2);

    return `<circle cx="${cx}" cy="${cy}" r="${radius.toFixed(3)}" fill="${fillVar}" data-value="${value}"/>`;
  });

  const rows = Math.ceil(values.length / gridCols);
  const width = gridCols * cell;
  const height = rows * cell;

  return `<g class="halftone-grid" data-encoding="dot-radius" data-grid-width="${width}" data-grid-height="${height}">
${circles.join('\n')}
</g>`;
}

/**
 * risoInkLayers({ inks, offset, seed, width, height }) — 2-3 flat house-
 * color `<rect>` planes, each wrapped in its own `<g style="mix-blend-mode:
 * multiply">`, offset by a fixed (or mulberry32(seed)-seeded) few-px
 * misregistration — the riso/letterpress overprint look.
 *
 * `inks` (default `['blue', 'vermillion']` — the DOCUMENTED fixed pair this
 * builder defaults to; scripts/design/tokens.mjs's `expressiveColor.multiply`
 * is the composited color those two specific inks produce where they
 * overlap) must be an array of 2-3 house token names resolvable by
 * `resolveTokenVar`.
 *
 * With no `seed`, the misregistration is a fixed cumulative offset (plane 0
 * unshifted, each subsequent plane shifted `offset` px further). With an
 * explicit non-zero integer `seed`, mulberry32(seed) drives each plane's
 * (dx, dy) instead — still fully deterministic.
 *
 * Pure: identical arguments return a byte-identical string.
 *
 * Throws if `inks` isn't a 2-3 element array, or `seed` is explicitly
 * passed but zero/non-integer.
 */
export function risoInkLayers({ inks = ['blue', 'vermillion'], offset = 3, seed, width = 400, height = 300 } = {}) {
  if (!Array.isArray(inks) || inks.length < 2 || inks.length > 3) {
    throw new Error(`risoInkLayers: inks must be an array of 2-3 house token names (got ${JSON.stringify(inks)})`);
  }

  let rand = null;
  if (seed !== undefined) {
    requireSeed(seed, 'risoInkLayers(seed)');
    rand = mulberry32(seed);
  }

  const planes = inks.map((token, i) => {
    const fillVar = resolveTokenVar(token);
    let dx;
    let dy;
    if (rand) {
      dx = (rand() - 0.5) * 2 * offset;
      dy = (rand() - 0.5) * 2 * offset;
    } else {
      dx = i === 0 ? 0 : offset * i;
      dy = i === 0 ? 0 : -offset * i;
    }

    return `<g class="riso-ink-plane" data-ink="${token}" style="mix-blend-mode: multiply" transform="translate(${dx.toFixed(2)}, ${dy.toFixed(2)})">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${fillVar}"/>
  </g>`;
  });

  return `<g class="riso-ink-layers" data-inks="${inks.join(',')}">
${planes.join('\n')}
</g>`;
}
