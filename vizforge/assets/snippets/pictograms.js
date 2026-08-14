// assets/snippets/pictograms.js
//
// Isotype-style unit pictogram module (EXPR-01, Phase 15 — 15-CONTEXT.md).
// Ten hand-authored, single-color, geometrically-reduced glyphs sharing ONE
// fixed viewBox — the Isotype/Arntz "fixed-size discipline": a pictogram
// chart repeats the SAME glyph at the SAME size to encode quantity by COUNT,
// never by resizing a single glyph. This module supplies the glyphs only;
// the count-encodes-quantity discipline itself is enforced by whichever
// Phase-16 scaffold consumes it (docs/expressive-vocabulary.md documents the
// rule; the mechanical resized-pictogram guard is out of this phase's scope).
//
// Every glyph is hand-authored path data — deliberately NOT sourced from
// Heroicons/Feather/Font Awesome/the Noun Project (licensing + the generic
// "UI icon" look craft-law objects to, per research/STACK.md). Each path is
// a compact, geometrically-reduced silhouette (5-10 path commands),
// stylistically consistent with the others (straight-line-dominant bodies,
// one shared full-circle idiom for rounded heads/wheels/canopies/coins).
//
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01 — every piece is one self-contained file). Copy this
// module's PICTOGRAMS registry + pictogramSymbol/pictogramUse helpers
// directly into a piece's <script> block.
//
// Honesty boundary (docs/expressive-vocabulary.md): a pictogram glyph is
// NEVER color-only — always pair it with a direct count/quantity label
// (craft-law's "never color-only encoding" rule applies here too). Fill is
// resolved through a house token (never an eyeballed hex), single-color
// only — no per-glyph gradients/shading.

// Mirrors scripts/design/tokens.mjs's `categoricalOrder` — kept in sync by
// hand (this file is a runtime-inlined snippet, not a build-time consumer of
// tokens.mjs, so it cannot import that array directly). Identical duplicate
// of the same idiom in assets/snippets/textures.js's resolveTokenVar — this
// module is deliberately independent (zero cross-snippet imports at runtime,
// PIPE-01: every inlined snippet is self-contained).
const CATEGORICAL_ORDER = ['blue', 'vermillion', 'green', 'sky', 'mauve', 'amber'];

/**
 * Resolves a house token name to the CSS custom property that carries it.
 * Accepts 'paper' | 'ink' | 'emphasis', any categorical name in
 * CATEGORICAL_ORDER, or a raw `--custom-property` / `var(--x)` string for
 * anything else.
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

// Every glyph shares this EXACT viewBox — the fixed-size discipline that
// makes repeated units read identically at any grid position, regardless of
// which glyph is chosen.
const VIEW_BOX = '0 0 24 24';

/**
 * PICTOGRAMS — ten hand-authored Isotype-style unit glyphs, keyed by name.
 * Each entry is `{ path, viewBox }`; `viewBox` is identical across every
 * entry (VIEW_BOX above) — asserted mechanically by
 * scripts/tests/smoke/expressive-pictograms.test.mjs.
 */
export const PICTOGRAMS = {
  person: {
    viewBox: VIEW_BOX,
    path: 'M12 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z M9 14H15L17 22H7Z',
  },
  house: {
    viewBox: VIEW_BOX,
    path: 'M12 3L21 10V21H3V10Z',
  },
  car: {
    viewBox: VIEW_BOX,
    path: 'M2 16L3 11H7L9 8H15L17 11H22V16Z M6 15a2 2 0 1 0 0 4 2 2 0 1 0 0-4Z M16 15a2 2 0 1 0 0 4 2 2 0 1 0 0-4Z',
  },
  factory: {
    viewBox: VIEW_BOX,
    path: 'M2 21V14L6 10V14L10 10V14L14 10V14L18 10V14L22 10V21Z M16 10V6H19V10Z',
  },
  tree: {
    viewBox: VIEW_BOX,
    path: 'M12 2a6 6 0 1 0 0 12 6 6 0 1 0 0-12Z M11 14H13V22H11Z',
  },
  bolt: {
    viewBox: VIEW_BOX,
    path: 'M13 2L5 13H11L9 22L19 10H13Z',
  },
  droplet: {
    viewBox: VIEW_BOX,
    path: 'M12 2C7 8 3 13 3 17C3 20 7 23 12 23C17 23 21 20 21 17C21 13 17 8 12 2Z',
  },
  coin: {
    viewBox: VIEW_BOX,
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z',
  },
  book: {
    viewBox: VIEW_BOX,
    path: 'M2 5L12 7L22 5V20L12 18L2 20Z',
  },
  heart: {
    viewBox: VIEW_BOX,
    path: 'M12 21C4 14 2 10 2 7C2 4 4 2 7 2C9 2 11 3 12 5C13 3 15 2 17 2C20 2 22 4 22 7C22 10 20 14 12 21Z',
  },
};

/**
 * pictogramSymbol(name) -> an inlinable `<symbol>` string (place inside an
 * SVG `<defs>` block once per glyph actually used). Throws on an unknown
 * glyph name.
 */
export function pictogramSymbol(name) {
  const glyph = PICTOGRAMS[name];
  if (!glyph) {
    throw new Error(`pictogramSymbol: unknown glyph "${name}" (known: ${Object.keys(PICTOGRAMS).join(', ')})`);
  }
  return `<symbol id="pictogram-${name}" viewBox="${glyph.viewBox}"><path d="${glyph.path}"/></symbol>`;
}

/**
 * pictogramUse(name, { fill, size, x, y }) -> an inlinable `<use>` string
 * referencing the matching `pictogramSymbol(name)` def, tinted via a house
 * token (never a bare hex — resolved through resolveTokenVar, same idiom as
 * assets/snippets/textures.js). `fill` defaults to 'ink'; single-color only.
 * Throws on an unknown glyph name.
 */
export function pictogramUse(name, { fill = 'ink', size = 24, x = 0, y = 0 } = {}) {
  if (!PICTOGRAMS[name]) {
    throw new Error(`pictogramUse: unknown glyph "${name}" (known: ${Object.keys(PICTOGRAMS).join(', ')})`);
  }
  const fillVar = resolveTokenVar(fill);
  return `<use href="#pictogram-${name}" x="${x}" y="${y}" width="${size}" height="${size}" fill="${fillVar}"/>`;
}
