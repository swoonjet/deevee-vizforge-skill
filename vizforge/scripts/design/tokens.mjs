// scripts/design/tokens.mjs
//
// SINGLE SOURCE OF TRUTH for every design token value in the VizForge craft
// system — type scale, color (paper/ink/emphasis/categorical/sequential/
// diverging), spacing, and motion. `scripts/build-tokens.mjs` imports this
// module to emit `assets/tokens.css` and `assets/ramps.json`;
// `scripts/qa/contrast-check.mjs` imports the same values it validates, so
// there is zero drift between what's checked and what ships.
//
// Edit values here, then re-run:
//   node scripts/build-tokens.mjs && node scripts/qa/contrast-check.mjs

import { formatHex, interpolate, samples, fixupHueShorter, converter } from 'culori';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

function oklchToCss({ l, c, h }) {
  return `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)})`;
}

function oklchToHex(spec) {
  return formatHex(oklchToCss(spec));
}

// ---------------------------------------------------------------------------
// Typography — CRAFT-01
//
// Role table: headline (Space Grotesk), dek/axisLabel/annotation (Inter),
// figures/source (IBM Plex Mono, tabular). Hard floor: no role below 11px
// CSS (22px at 2x export) — `source` sits exactly on that floor.
// ---------------------------------------------------------------------------

export const type = {
  headline: {
    fontFamily: '"Space Grotesk", sans-serif',
    fontWeight: 700,
    size: '2.25rem', // 36px
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    tabularNums: false,
    usage: 'The finding, stated as a sentence with a verb (FT/Economist style) — one per piece.',
  },
  dek: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: 400,
    size: '1.125rem', // 18px
    lineHeight: 1.45,
    letterSpacing: 'normal',
    tabularNums: false,
    usage: 'Context sentence beneath the headline.',
  },
  axisLabel: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: 400,
    size: '0.8125rem', // 13px
    lineHeight: 1.3,
    letterSpacing: 'normal',
    tabularNums: false,
    usage: 'Axis tick labels, legend labels.',
  },
  annotation: {
    fontFamily: '"Inter", sans-serif',
    fontWeight: [400, 600],
    size: '0.75rem', // 12px
    lineHeight: 1.3,
    letterSpacing: 'normal',
    tabularNums: false,
    usage: 'In-chart callouts and data labels. 600 for emphasis within an annotation.',
  },
  figures: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontWeight: 400,
    size: '0.8125rem', // 13px
    lineHeight: 1.3,
    letterSpacing: 'normal',
    tabularNums: true,
    usage: 'Numeric figures, units, table cells — always tabular-nums.',
  },
  source: {
    fontFamily: '"IBM Plex Mono", monospace',
    fontWeight: 400,
    size: '0.6875rem', // 11px — the hard floor
    lineHeight: 1.4,
    letterSpacing: 'normal',
    tabularNums: true,
    usage: 'Source + methodology footer line.',
  },
};

export const typeMinSizePx = { css: 11, exportAt2x: 22 };

// Poster-scale display steps (EXPR-01, Phase 15 — 15-CONTEXT.md: "check
// whether poster-scale display steps are needed beyond the current scale").
// The scale otherwise caps at `type.headline.size` (2.25rem/36px), with no
// step for Phase 17's dramatic-scale-contrast/typographic-bar pieces.
// Reuses --font-headline/--weight-headline (Space Grotesk 700) as-is —
// scale contrast comes from SIZE only, never a synthetic/fake-bold weight
// (the vendored variable font has no 900/Black axis).
export const posterSizes = {
  poster1: '4.5rem', // 72px — step 1
  poster2: '7rem', // 112px — step 2, the largest named size in the scale
};

// ---------------------------------------------------------------------------
// Color — CRAFT-02
//
// paper/ink/emphasis defined directly in OKLCH. Categorical base is
// Okabe-Ito (CVD-safe), re-tuned by uniformly darkening L (keeping each
// hue's original chroma/hue) so every swatch clears 3:1 against the paper
// canvas *while preserving the relative lightness separation between hues
// that CVD-distinguishability actually depends on* — retuning each hue
// independently to its own minimal darkening collapses lightness-adjacent
// hues (vermillion/amber) into indistinguishable luminance under
// protanopia/deuteranopia. A uniform L-offset avoids that trap.
// ---------------------------------------------------------------------------

const paperOklch = { l: 0.975, c: 0.01, h: 95 }; // warm paper-white
const inkOklch = { l: 0.22, c: 0.015, h: 265 }; // near-black, never #000
const emphasisOklch = { l: 0.48, c: 0.19, h: 35 }; // the ONE emphasis color per piece

// Original Okabe-Ito OKLCH values (hue/chroma preserved as-is; L uniformly
// darkened by CATEGORICAL_L_OFFSET below to clear the paper-contrast floor).
const categoricalOklchBase = {
  blue: { l: 0.5319, c: 0.1313, h: 244.05 }, // Okabe-Ito #0072B2
  vermillion: { l: 0.6213, c: 0.1705, h: 47.51 }, // Okabe-Ito #D55E00
  green: { l: 0.6198, c: 0.1295, h: 165.46 }, // Okabe-Ito #009E73
  sky: { l: 0.7345, c: 0.1174, h: 236.18 }, // Okabe-Ito #56B4E9
  mauve: { l: 0.6794, c: 0.1177, h: 346.32 }, // Okabe-Ito #CC79A7
  amber: { l: 0.7527, c: 0.1576, h: 76.77 }, // Okabe-Ito #E69F00
};
const CATEGORICAL_L_OFFSET = 0.12;

const categoricalOklch = Object.fromEntries(
  Object.entries(categoricalOklchBase).map(([name, spec]) => [
    name,
    { l: Math.max(0.15, spec.l - CATEGORICAL_L_OFFSET), c: spec.c, h: spec.h },
  ])
);

// Ordered so --cat-1..--cat-6 has a stable, deliberate sequence.
export const categoricalOrder = ['blue', 'vermillion', 'green', 'sky', 'mauve', 'amber'];

export const color = {
  paper: { oklch: oklchToCss(paperOklch), hex: oklchToHex(paperOklch) },
  ink: { oklch: oklchToCss(inkOklch), hex: oklchToHex(inkOklch) },
  emphasis: { oklch: oklchToCss(emphasisOklch), hex: oklchToHex(emphasisOklch) },
  categorical: Object.fromEntries(
    categoricalOrder.map((name) => [
      name,
      { oklch: oklchToCss(categoricalOklch[name]), hex: oklchToHex(categoricalOklch[name]) },
    ])
  ),
};

// ---------------------------------------------------------------------------
// Ramps — sequential + diverging, built in OKLCH via culori (house ramps,
// not viridis/cividis — those remain documented as validated fallbacks
// only, per docs/color.md).
// ---------------------------------------------------------------------------

// Sequential: paper-tinted light -> a teal-blue mid stop -> deep ink-blue.
// Three anchors (rather than a flat two-point interpolation) keep the ramp
// from desaturating into a muddy gray through the middle stops.
const seqLightHex = color.paper.hex;
const seqMidOklch = { l: 0.55, c: 0.075, h: 205 };
const seqDarkOklch = { l: 0.2, c: 0.05, h: 235 };
const sequentialInterpolator = interpolate(
  [seqLightHex, oklchToHex(seqMidOklch), oklchToHex(seqDarkOklch)],
  'oklch'
);
export const sequentialRamp = samples(7).map(sequentialInterpolator).map(formatHex);

// Diverging: retuned vermillion -> near-paper neutral -> retuned blue, with
// fixupHueShorter so the midpoint doesn't swing through an unrelated hue.
const divergingInterpolator = interpolate(
  [color.categorical.vermillion.hex, color.paper.hex, color.categorical.blue.hex],
  'oklch',
  { h: { fixup: fixupHueShorter } }
);
export const divergingRamp = samples(9).map(divergingInterpolator).map(formatHex);

export { toOklch };

// ---------------------------------------------------------------------------
// Expressive color — EXPR-01, Phase 15 (15-CONTEXT.md + ROADMAP SC1)
//
// Reconciliation: 15-CONTEXT.md says REUSE house tokens, no parallel
// expressive palette, adding to ramps.json ONLY if a check needs to
// recognize a genuinely-new color (the `ambientDark` precedent). ROADMAP
// SC1 separately requires "a new named expressive palette family... exists
// mirroring ambientDark". Both are satisfied by the SAME thing: this
// `expressive` family is DERIVED FROM house tokens (never a hand-picked
// parallel palette) and named/registered only because it's the one
// genuinely-new rendered color the texture vocabulary produces.
//
// assets/snippets/textures.js's risoInkLayers() defaults to a fixed
// documented ink pair (blue + vermillion). Where those two flat planes
// overlap under `mix-blend-mode: multiply`, the rendered pixel is the sRGB
// multiply composite of the two house hexes — a color that exists nowhere
// else in the house token set. Everywhere else the two ink planes DON'T
// overlap, the pixel is just the plain house categorical hex (already
// approved); paper-grain's low-opacity ink-over-paper overlay is ALSO
// already covered by palette.check.mjs's existing paper-blend loop. So the
// multiply composite is the ONLY addition actually required.
// ---------------------------------------------------------------------------

export const expressiveInkPair = ['blue', 'vermillion']; // mirrors risoInkLayers()'s default `inks`

function multiplyHex(hexA, hexB) {
  const a = toRgb(hexA);
  const b = toRgb(hexB);
  return formatHex({ mode: 'rgb', r: a.r * b.r, g: a.g * b.g, b: a.b * b.b });
}

export const expressiveColor = {
  // The riso two-ink multiply composite of the documented default pair,
  // derived from house categorical tokens via culori (sRGB multiply =
  // per-channel a*b, consistent with culori's normalized [0,1] rgb mode —
  // equivalent to the familiar 0-255-scale a*b/255 formula).
  multiply: multiplyHex(color.categorical[expressiveInkPair[0]].hex, color.categorical[expressiveInkPair[1]].hex),
};

// ---------------------------------------------------------------------------
// Spacing — 8px base scale + per-frame-preset margins
// ---------------------------------------------------------------------------

export const spacing = {
  scale: {
    1: '0.5rem', // 8px
    2: '1rem', // 16px
    3: '1.5rem', // 24px
    4: '2rem', // 32px
    5: '2.5rem', // 40px
    6: '3rem', // 48px
    7: '3.5rem', // 56px
    8: '4rem', // 64px
  },
  frameMargins: {
    // editorial 1200x750 — extra bottom room for the source line.
    editorial: { top: 56, right: 64, bottom: 72, left: 64 },
    // square 1080x1080 — symmetric social crop.
    square: { top: 64, right: 64, bottom: 64, left: 64 },
    // story 1080x1920 — tall format, generous top/bottom safe zones.
    story: { top: 96, right: 56, bottom: 120, left: 56 },
    // video 1920x1080 — 16:9 canvas.
    video: { top: 64, right: 80, bottom: 80, left: 80 },
  },
};

// ---------------------------------------------------------------------------
// Motion — CRAFT-05 / MOTION-01: sine ease-in-out only, unhurried durations.
// ---------------------------------------------------------------------------

export const motion = {
  easeSineInOut: 'cubic-bezier(0.37, 0, 0.63, 1)',
  durations: {
    unhurried: 1400, // ms
    slow: 2400, // ms
  },
};

// ---------------------------------------------------------------------------
// Ambient-dark tokens — Tier-3 "ambient-sculpture" family ONLY (Phase 4,
// 04-03-PLAN.md). A SCOPED dark variant, never a general dark mode: light
// remains the default everywhere else in the system (04-CONTEXT.md lock).
// Built from this same tokens.mjs source of truth so build-tokens.mjs's
// generated `.tier3-ambient` CSS block, assets/ramps.json's `ambientDark`
// entry, and scripts/qa/contrast-check.mjs's dark-pair validation can never
// drift from one another.
// ---------------------------------------------------------------------------

const ambientDarkPaperOklch = { l: 0.15, c: 0.02, h: 80 }; // near-black, warm-neutral
const ambientDarkInkOklch = { l: 0.93, c: 0.012, h: 80 }; // light warm-neutral ink, never pure white

export const ambientDarkColor = {
  paper: { oklch: oklchToCss(ambientDarkPaperOklch), hex: oklchToHex(ambientDarkPaperOklch) },
  ink: { oklch: oklchToCss(ambientDarkInkOklch), hex: oklchToHex(ambientDarkInkOklch) },
};

// Restrained diverging ramp tuned for the dark ground (southward Bz, warm
// <-> the dark paper's own neutral midpoint <-> northward Bz, cool).
// Moderate chroma only — no neon/oversaturated poles (craft-law).
const ambientDarkWarmPoleOklch = { l: 0.68, c: 0.15, h: 35 };
const ambientDarkCoolPoleOklch = { l: 0.72, c: 0.12, h: 230 };
const ambientDarkDivergingInterpolator = interpolate(
  [oklchToHex(ambientDarkWarmPoleOklch), ambientDarkColor.paper.hex, oklchToHex(ambientDarkCoolPoleOklch)],
  'oklch',
  { h: { fixup: fixupHueShorter } }
);
export const ambientDarkDivergingRamp = samples(9).map(ambientDarkDivergingInterpolator).map(formatHex);
