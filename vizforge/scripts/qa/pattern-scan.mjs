// scripts/qa/pattern-scan.mjs
//
// Banned-pattern scanner for piece HTML (CRAFT-01/03/05 spot-check —
// precursor to Phase 2's real QA-01 gate, not the gate itself).
//
// Usage:
//   node scripts/qa/pattern-scan.mjs [file1.html file2.html ...]
//   node scripts/qa/pattern-scan.mjs                 # defaults to pieces/*.html
//   node scripts/qa/pattern-scan.mjs --selftest       # proves the detector rejects

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Hard fail: patterns that are never acceptable per docs/craft-law.md.
const HARD_FAIL_PATTERNS = [
  { name: '<hr> element', regex: /<hr[\s/>]/i },
  { name: 'backdrop-filter (glassmorphism)', regex: /backdrop-filter\s*:/i },
  { name: 'text-shadow', regex: /text-shadow\s*:/i },
  { name: 'drop-shadow() filter', regex: /drop-shadow\(/i },
  { name: 'box-shadow', regex: /box-shadow\s*:/i },
  { name: 'filter: blur', regex: /filter\s*:\s*blur/i },
  { name: '"neon" literal', regex: /neon/i },
  { name: 'divider/rule utility class', regex: /class\s*=\s*["'][^"']*\b(divider|rule)\b[^"']*["']/i },
];

// Warn only: legitimate in narrow cases, flagged for human/verifier review.
const WARN_PATTERNS = [
  { name: 'linear-gradient(', regex: /linear-gradient\(/gi },
  { name: 'radial-gradient(', regex: /radial-gradient\(/gi },
];

// Require: fail if absent.
const REQUIRE_PATTERNS = [
  { name: 'Source: attribution string', regex: /Source:/ },
  { name: '<h1> headline element', regex: /<h1[\s>]/i },
];

const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;

// Isotype pictogram fixed-size discipline (EXPR-02, Phase 16 Plan 01 --
// docs/expressive-vocabulary.md's "Isotype pictograms" section). A pictogram
// unit is any <use> element referencing a `#pictogram-<name>` symbol (the
// convention assets/snippets/pictograms.js's pictogramUse() emits) via
// `href` or the legacy `xlink:href`. Quantity must be encoded by COUNT of
// repeated units, never by resizing a single glyph -- so more than one
// distinct (width,height) pair among a piece's pictogram <use> elements, OR
// any pictogram <use> carrying a scale transform, is the canonical dishonest
// pictogram (Neurath/Arntz Isotype discipline violated). Inert (zero
// matches, zero cost) when no pictogram <use> element is present at all --
// never false-positives on the 29 pre-existing non-pictogram scaffolds.
const PICTOGRAM_USE_REGEX = /<use\b[^>]*(?:href|xlink:href)\s*=\s*["']#pictogram-[^"']+["'][^>]*>/gi;
const ATTR_REGEX = (name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
const WIDTH_REGEX = ATTR_REGEX('width');
const HEIGHT_REGEX = ATTR_REGEX('height');
const TRANSFORM_SCALE_REGEX = /\btransform\s*=\s*["'][^"']*scale\s*\([^"']*["']/i;

function findResizedPictogramFail(html) {
  const uses = html.match(PICTOGRAM_USE_REGEX) || [];
  if (uses.length === 0) return null;

  const sizes = new Set();
  let anyScaleTransform = false;

  for (const use of uses) {
    const widthMatch = use.match(WIDTH_REGEX);
    const heightMatch = use.match(HEIGHT_REGEX);
    const width = widthMatch ? widthMatch[1] : '';
    const height = heightMatch ? heightMatch[1] : '';
    sizes.add(`${width}x${height}`);

    if (TRANSFORM_SCALE_REGEX.test(use)) anyScaleTransform = true;
  }

  if (sizes.size > 1 || anyScaleTransform) {
    return 'HARD FAIL: resized/size-scaled pictogram — Isotype units must repeat at ONE fixed size; count encodes quantity, never glyph size';
  }
  return null;
}

// Font-size-as-area / word-cloud rejection (EXPR-04, Phase 17 Plan 01 --
// docs/expressive-vocabulary.md's typographic-bar honesty boundary). A
// <text>/<tspan> element carrying an ISOTROPIC scale transform --
// `scale(k)` (SVG's single-argument shorthand, equivalent to `scale(k,k)`)
// or `scale(kx,ky)` where kx===ky and k!==1 -- scales that letterform's ink
// AREA (both width AND height) by the same factor: the canonical
// font-size-as-area / word-cloud lie (the same area-as-magnitude error
// docs/honesty-rules.md bans for bubbles -- radius must be sqrt(value),
// never value directly -- generalized here to type). A height-ONLY
// anisotropic scale (`scale(1,k)`, kx!==ky) is the honest one-dimension
// move typographic-bar itself uses (fixed width, height-only length
// encoding from a zero baseline) and must NOT match; nor does a bare
// `scale(1)`/`scale(1,1)` identity transform (k===1 is never a violation --
// no scaling actually happened). Inert (zero matches, zero cost) when no
// <text>/<tspan> carries any scale transform at all -- never
// false-positives on the pre-existing atlas.
const TEXT_OR_TSPAN_TAG_REGEX = /<(?:text|tspan)\b[^>]*>/gi;
const TRANSFORM_ATTR_VALUE_REGEX = /\btransform\s*=\s*["']([^"']*)["']/i;
const SCALE_CALL_REGEX = /\bscale\(\s*([-+\d.eE]+)\s*(?:,\s*([-+\d.eE]+)\s*)?\)/i;

function findFontSizeAsAreaFail(html) {
  const tags = html.match(TEXT_OR_TSPAN_TAG_REGEX) || [];

  for (const tag of tags) {
    const transformMatch = tag.match(TRANSFORM_ATTR_VALUE_REGEX);
    if (!transformMatch) continue;

    const scaleMatch = transformMatch[1].match(SCALE_CALL_REGEX);
    if (!scaleMatch) continue;

    const kx = parseFloat(scaleMatch[1]);
    // SVG's single-argument scale(k) shorthand scales BOTH axes by k --
    // equivalent to scale(k,k) -- so an absent second argument means
    // ky === kx, not "unscaled".
    const ky = scaleMatch[2] !== undefined ? parseFloat(scaleMatch[2]) : kx;
    if (!Number.isFinite(kx) || !Number.isFinite(ky)) continue;

    if (kx === ky && kx !== 1) {
      return 'HARD FAIL: font-size-as-area / word-cloud encoding — a letterform\'s AREA must never encode value; use one honest dimension (fixed-width height from a zero baseline)';
    }
  }

  return null;
}

export async function loadApprovedHexColors() {
  try {
    const rampsPath = path.join(repoRoot, 'assets/ramps.json');
    const raw = await readFile(rampsPath, 'utf8');
    const ramps = JSON.parse(raw);
    const all = [
      ramps.paper,
      ramps.ink,
      ramps.emphasis,
      ...(ramps.categorical || []),
      ...(ramps.sequential || []),
      ...(ramps.diverging || []),
      // Tier-3 "ambient-sculpture" family SCOPED dark variant (04-03-PLAN.md)
      // — these hex literals land in every piece's inlined assets/tokens.css
      // via the `.tier3-ambient` block, not just the ambient piece's own
      // source, so they must be approved project-wide.
      ramps.ambientDark?.paper,
      ramps.ambientDark?.ink,
      ...(ramps.ambientDark?.diverging || []),
      // Expressive family (EXPR-01, Phase 15) — the riso two-ink multiply
      // composite assets/snippets/textures.js's risoInkLayers() can render
      // where its default blue+vermillion planes overlap.
      ramps.expressive?.multiply,
    ].filter(Boolean);
    return new Set(all.map((h) => h.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Scans one HTML source string. Returns { fails: string[], warns: string[] }.
 */
export function scanHtml(html, approvedHexColors = new Set()) {
  const fails = [];
  const warns = [];

  for (const { name, regex } of HARD_FAIL_PATTERNS) {
    if (regex.test(html)) fails.push(`HARD FAIL: ${name}`);
  }

  for (const { name, regex } of REQUIRE_PATTERNS) {
    if (!regex.test(html)) fails.push(`MISSING (required): ${name}`);
  }

  for (const { name, regex } of WARN_PATTERNS) {
    if (regex.test(html)) warns.push(`WARN: ${name} present — review as a data-legend use only`);
  }

  const resizedPictogramFail = findResizedPictogramFail(html);
  if (resizedPictogramFail) fails.push(resizedPictogramFail);

  const fontSizeAsAreaFail = findFontSizeAsAreaFail(html);
  if (fontSizeAsAreaFail) fails.push(fontSizeAsAreaFail);

  const hexMatches = html.match(HEX_COLOR_REGEX) || [];
  const unapproved = [...new Set(hexMatches.map((h) => h.toLowerCase()))].filter(
    (h) => !approvedHexColors.has(h)
  );
  if (unapproved.length > 0) {
    warns.push(`WARN: hex color literal(s) not in ramps.json — use tokens instead: ${unapproved.join(', ')}`);
  }

  return { fails, warns };
}

async function defaultGlob() {
  const piecesDir = path.join(repoRoot, 'pieces');
  try {
    const entries = await readdir(piecesDir);
    return entries.filter((f) => f.endsWith('.html')).map((f) => path.join(piecesDir, f));
  } catch {
    return [];
  }
}

async function scanFiles(filePaths) {
  const approvedHexColors = await loadApprovedHexColors();
  let anyFail = false;

  for (const filePath of filePaths) {
    const html = await readFile(filePath, 'utf8');
    const { fails, warns } = scanHtml(html, approvedHexColors);
    const relPath = path.relative(repoRoot, filePath);

    if (fails.length === 0) {
      console.log(`PASS: ${relPath}`);
    } else {
      console.log(`FAIL: ${relPath}`);
      anyFail = true;
    }
    for (const f of fails) console.log(`  ${f}`);
    for (const w of warns) console.log(`  ${w}`);
  }

  return anyFail;
}

function runSelftest() {
  const cleanFixture = `<!doctype html>
<html><body>
<h1>CO2 has risen every decade since 1958</h1>
<p>A dek explaining context.</p>
<div class="viz-attribution">Source: NOAA Global Monitoring Laboratory</div>
</body></html>`;

  const dirtyFixture = `<!doctype html>
<html><head><style>
.card { box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
</style></head><body>
<h1>Some headline</h1>
<div class="card">no source line here</div>
</body></html>`;

  const clean = scanHtml(cleanFixture, new Set());
  const dirty = scanHtml(dirtyFixture, new Set());

  let ok = true;

  if (clean.fails.length !== 0) {
    console.error('SELFTEST FAILED: clean fixture was rejected:', clean.fails);
    ok = false;
  } else {
    console.log('SELFTEST: clean fixture correctly passed.');
  }

  const dirtyHasBoxShadow = dirty.fails.some((f) => f.includes('box-shadow'));
  const dirtyHasMissingSource = dirty.fails.some((f) => f.includes('Source:'));

  if (!dirtyHasBoxShadow || !dirtyHasMissingSource) {
    console.error('SELFTEST FAILED: dirty fixture was not correctly rejected:', dirty.fails);
    ok = false;
  } else {
    console.log('SELFTEST: dirty fixture correctly rejected (box-shadow + missing Source:).');
  }

  return ok;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--selftest')) {
    const ok = runSelftest();
    process.exit(ok ? 0 : 1);
  }

  const filePaths = args.length > 0 ? args : await defaultGlob();

  if (filePaths.length === 0) {
    console.log('No piece HTML files found to scan (pieces/*.html is empty) — nothing to do.');
    process.exit(0);
  }

  const anyFail = await scanFiles(filePaths);
  process.exit(anyFail ? 1 : 0);
}

// Only run the CLI when this file is executed directly (not when imported by
// pattern-scan.check.mjs / gate.mjs) — mirrors capture.mjs's guard. Without
// this, importing scanHtml/loadApprovedHexColors as a module would also
// trigger a full CLI scan + process.exit(), killing the importing process
// (found while wiring pattern-scan.check.mjs, Plan 02-02 Task 1).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
