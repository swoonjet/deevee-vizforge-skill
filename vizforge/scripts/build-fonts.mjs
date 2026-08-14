// scripts/build-fonts.mjs
//
// Subsets house typefaces to embeddable woff2 files and generates one inline
// CSS file per PACK — each @font-face carrying a base64 data URI. Pieces paste
// a pack verbatim into their <style> so they make zero font network requests
// (PIPE-01).
//
// TWO PACKS, because the project now dresses in two type systems:
//
//   house  Space Grotesk / Inter / IBM Plex Mono -> assets/fonts/fonts-inline.css
//          The 40 scaffolds and the gallery. Unchanged.
//   fritz  Instrument Sans / Inter / Geist Mono  -> assets/fonts/fritz-subset-inline.css
//          The Intercept (/fritz) type system, for the Studio's PNG export.
//
// WHY THE FRITZ PACK EXISTS AT ALL. A PNG is where a module's type stops being
// negotiable: a snippet degrades gracefully through the host's font stack, but a
// raster either has Instrument Sans in it or is permanently wrong. Only the
// SERVER-SIDE renderer loads this pack — rasterizing bakes the glyphs, so the
// weight never travels to a host page. Snippets and iframe exports deliberately
// still ship no webfont (see scripts/build-embed.mjs).
//
// NOT assets/fonts/fritz-fonts-inline.css — that is the demo builders' full
// unsubsetted Inter (486KB, Inter only, no display or mono face) and is left
// alone.
//
// Run: node scripts/build-fonts.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import subsetFont from 'subset-font';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'assets/fonts/src');
const outDir = path.join(repoRoot, 'assets/fonts');

// Glyph set: full printable ASCII + typographic punctuation/units the craft
// system needs (em/en dash, curly quotes, ellipsis, middle dot, degree,
// plus-minus, multiplication, per-mille, currency, section, arrows, minus
// sign) + NBSP + subscript digits (CO₂ needs ₂) + superscript digits.
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCharCode(0x20 + i)
).join('');
const TYPOGRAPHIC_EXTRAS =
  '–—' + // – —
  '‘’' + // ‘ ’
  '“”' + // “ ”
  '…' + // …
  '·' + // ·
  '°' + // °
  '±' + // ±
  '×' + // ×
  '‰' + // ‰
  '€' + // €
  '£' + // £
  '¥' + // ¥
  '§' + // §
  '→↑↓' + // → ↑ ↓
  '−' + // −
  ' '; // NBSP
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const SUPERSCRIPT_DIGITS = '⁰¹²³';

const GLYPHS = PRINTABLE_ASCII + TYPOGRAPHIC_EXTRAS + SUBSCRIPT_DIGITS + SUPERSCRIPT_DIGITS;

const PER_FILE_BUDGET_BYTES = 80 * 1024; // 80KB raw woff2 per subset
const TOTAL_INFLATED_BUDGET_BYTES = 500 * 1024; // 500KB base64-inflated total
const BASE64_INFLATION = 4 / 3;

// Each entry: family name (as used in font-family/CSS), the weight it will
// be registered as, the source file to subset from, and (for variable
// fonts) the variationAxes to pin the weight to a static instance.
const HOUSE_SUBSETS = [
  {
    family: 'Space Grotesk',
    weight: 700,
    srcFile: 'SpaceGrotesk-Variable.ttf',
    variationAxes: { wght: 700 },
    slug: 'space-grotesk-700',
  },
  {
    family: 'Space Grotesk',
    weight: 500,
    srcFile: 'SpaceGrotesk-Variable.ttf',
    variationAxes: { wght: 500 },
    slug: 'space-grotesk-500',
  },
  {
    family: 'Inter',
    weight: 400,
    srcFile: 'Inter-Variable.ttf',
    variationAxes: { wght: 400 },
    slug: 'inter-400',
  },
  {
    family: 'Inter',
    weight: 600,
    srcFile: 'Inter-Variable.ttf',
    variationAxes: { wght: 600 },
    slug: 'inter-600',
  },
  {
    family: 'IBM Plex Mono',
    weight: 400,
    srcFile: 'IBMPlexMono-Regular.ttf',
    variationAxes: undefined, // static source, no instancing needed
    slug: 'ibm-plex-mono-400',
  },
];

// The Intercept (/fritz) type system. Weights are not a guess — they are the
// ones assets/modules/vf-core.js actually asks for: 700 headline, 600 legend
// and tooltip lead-in, 500 axis/spoke labels, 400 dek and body, plus the
// figures face for the source line and numeric labels. A weight the modules
// never request is a weight not worth subsetting.
//
// Instrument Sans ships as a two-axis variable (wdth, wght), so wdth is pinned
// to 100 as well — leaving it unpinned risks instancing a condensed cut, and
// the kit's display face is the normal width.
//
// Sources vendored into assets/fonts/src/ from the local install, same as the
// house faces: InstrumentSans-VariableFont_wdth,wght.ttf and
// GeistMono-VariableFont_wght.ttf, both SIL Open Font License 1.1.
const FRITZ_SUBSETS = [
  {
    family: 'Instrument Sans',
    weight: 700,
    srcFile: 'InstrumentSans-Variable.ttf',
    variationAxes: { wght: 700, wdth: 100 },
    slug: 'instrument-sans-700',
  },
  {
    family: 'Inter',
    weight: 400,
    srcFile: 'Inter-Variable.ttf',
    variationAxes: { wght: 400 },
    slug: 'inter-400',
  },
  {
    family: 'Inter',
    weight: 500,
    srcFile: 'Inter-Variable.ttf',
    variationAxes: { wght: 500 },
    slug: 'inter-500',
  },
  {
    family: 'Inter',
    weight: 600,
    srcFile: 'Inter-Variable.ttf',
    variationAxes: { wght: 600 },
    slug: 'inter-600',
  },
  {
    family: 'Geist Mono',
    weight: 400,
    srcFile: 'GeistMono-Variable.ttf',
    variationAxes: { wght: 400 },
    slug: 'geist-mono-400',
  },
];

const PACKS = [
  { name: 'house', outFile: 'fonts-inline.css', subsets: HOUSE_SUBSETS },
  { name: 'fritz', outFile: 'fritz-subset-inline.css', subsets: FRITZ_SUBSETS },
];

async function buildSubset(spec) {
  const srcPath = path.join(srcDir, spec.srcFile);
  const buffer = await readFile(srcPath);
  const options = { targetFormat: 'woff2' };
  if (spec.variationAxes) options.variationAxes = spec.variationAxes;

  let subsetBuffer;
  try {
    subsetBuffer = await subsetFont(buffer, GLYPHS, options);
  } catch (err) {
    throw new Error(
      `Failed to subset ${spec.family} ${spec.weight} from ${spec.srcFile}: ${err.message}`
    );
  }

  const outPath = path.join(outDir, `${spec.slug}.woff2`);
  await writeFile(outPath, subsetBuffer);

  return { ...spec, outPath, bytes: subsetBuffer.byteLength, buffer: subsetBuffer };
}

function buildFontFaceCss({ family, weight, buffer }) {
  const base64 = buffer.toString('base64');
  return `@font-face {
  font-family: "${family}";
  font-weight: ${weight};
  font-style: normal;
  font-display: block;
  src: url(data:font/woff2;base64,${base64}) format('woff2');
}`;
}

async function buildPack(pack) {
  console.log(`Subsetting the ${pack.name} pack...\n`);
  const results = [];
  let totalBytes = 0;

  for (const spec of pack.subsets) {
    const result = await buildSubset(spec);
    results.push(result);
    totalBytes += result.bytes;

    const kb = (result.bytes / 1024).toFixed(1);
    console.log(`  ${spec.slug}.woff2 — ${kb}KB (${spec.family} ${spec.weight})`);

    if (result.bytes > PER_FILE_BUDGET_BYTES) {
      throw new Error(
        `${spec.slug}.woff2 is ${kb}KB, exceeding the ${PER_FILE_BUDGET_BYTES / 1024}KB per-file budget.`
      );
    }
  }

  const inflatedTotal = totalBytes * BASE64_INFLATION;
  console.log(
    `\n  ${pack.name} raw: ${(totalBytes / 1024).toFixed(1)}KB — base64-inflated: ${(inflatedTotal / 1024).toFixed(1)}KB`
  );

  // Budget is PER PACK, not across both: a piece loads one pack, never two, so
  // the number that matters to a piece's weight is its own pack's total.
  if (inflatedTotal > TOTAL_INFLATED_BUDGET_BYTES) {
    throw new Error(
      `The ${pack.name} pack's base64-inflated font payload is ${(inflatedTotal / 1024).toFixed(1)}KB, exceeding the ${TOTAL_INFLATED_BUDGET_BYTES / 1024}KB budget.`
    );
  }

  const cssBlocks = results.map(buildFontFaceCss);
  const families = [...new Set(pack.subsets.map((s) => s.family))].join(' / ');
  const css = `/* GENERATED by scripts/build-fonts.mjs — do not edit by hand.
 * Pack: ${pack.name} — ${families}
 * One @font-face per subsetted typeface weight, base64-inlined so pieces make
 * zero font network requests (PIPE-01). Paste this file's contents verbatim
 * into a piece's <style> block.
 */

${cssBlocks.join('\n\n')}
`;

  const cssPath = path.join(outDir, pack.outFile);
  await writeFile(cssPath, css);
  console.log(`  Wrote ${path.relative(repoRoot, cssPath)}\n`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const pack of PACKS) {
    await buildPack(pack);
  }

  console.log('Font build complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
