// scripts/build-tokens.mjs
//
// Imports scripts/design/tokens.mjs (the single source of truth) and emits:
//   (a) assets/tokens.css — CSS custom properties for every token
//   (b) assets/ramps.json — { categorical, sequential, diverging, paper, ink, emphasis } as hex
//
// Run: node scripts/build-tokens.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  type,
  color,
  categoricalOrder,
  sequentialRamp,
  divergingRamp,
  spacing,
  motion,
  ambientDarkColor,
  ambientDarkDivergingRamp,
  posterSizes,
  expressiveInkPair,
  expressiveColor,
} from './design/tokens.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function weightList(w) {
  return Array.isArray(w) ? w.join('/') : String(w);
}

function buildTokensCss() {
  const lines = [];
  lines.push('/* GENERATED from scripts/design/tokens.mjs — edit that, not this. */');
  lines.push('/*');
  lines.push(' * Structural craft-law note: no divider/rule utility classes exist on');
  lines.push(' * purpose. Do not add `.divider`, `.hr`, or `border-top` "separator"');
  lines.push(' * utilities here — separation is by space, weight, and alignment only.');
  lines.push(' * See docs/craft-law.md.');
  lines.push(' */');
  lines.push(':root {');

  lines.push('  /* Typography — CRAFT-01 */');
  lines.push(`  --font-headline: ${type.headline.fontFamily};`);
  lines.push(`  --font-label: ${type.dek.fontFamily};`);
  lines.push(`  --font-figures: ${type.figures.fontFamily};`);
  lines.push(`  --size-headline: ${type.headline.size};`);
  lines.push(`  --size-dek: ${type.dek.size};`);
  lines.push(`  --size-axis: ${type.axisLabel.size};`);
  lines.push(`  --size-annotation: ${type.annotation.size};`);
  lines.push(`  --size-figures: ${type.figures.size};`);
  lines.push(`  --size-source: ${type.source.size};`);
  lines.push(`  --weight-headline: ${weightList(type.headline.fontWeight)};`);
  lines.push(`  --weight-dek: ${weightList(type.dek.fontWeight)};`);
  lines.push(`  --weight-axis: ${weightList(type.axisLabel.fontWeight)};`);
  lines.push(`  --weight-annotation: ${weightList(type.annotation.fontWeight)};`);
  lines.push(`  --weight-figures: ${weightList(type.figures.fontWeight)};`);
  lines.push(`  --weight-source: ${weightList(type.source.fontWeight)};`);
  lines.push(`  --line-headline: ${type.headline.lineHeight};`);
  lines.push(`  --line-dek: ${type.dek.lineHeight};`);
  lines.push(`  --line-axis: ${type.axisLabel.lineHeight};`);
  lines.push(`  --line-annotation: ${type.annotation.lineHeight};`);
  lines.push(`  --line-figures: ${type.figures.lineHeight};`);
  lines.push(`  --line-source: ${type.source.lineHeight};`);
  lines.push(`  --letter-headline: ${type.headline.letterSpacing};`);
  lines.push('');

  lines.push('  /* Poster-scale display steps — EXPR-01, Phase 15 (dramatic-scale-contrast/typographic-bar) */');
  lines.push(`  --size-poster-1: ${posterSizes.poster1};`);
  lines.push(`  --size-poster-2: ${posterSizes.poster2};`);
  lines.push('');

  lines.push('  /* Color — CRAFT-02: editorial-light canvas, warm paper + near-black ink */');
  lines.push(`  --color-paper: ${color.paper.oklch};`);
  lines.push(`  --color-ink: ${color.ink.oklch};`);
  lines.push(`  --color-emphasis: ${color.emphasis.oklch};`);
  categoricalOrder.forEach((name, i) => {
    lines.push(`  --cat-${i + 1}: ${color.categorical[name].oklch}; /* ${name} */`);
  });
  lines.push('');

  lines.push('  /* Sequential ramp — house OKLCH, 7 stops light -> dark */');
  sequentialRamp.forEach((hex, i) => {
    lines.push(`  --seq-${i + 1}: ${hex};`);
  });
  lines.push('');

  lines.push('  /* Diverging ramp — house OKLCH, 9 stops vermillion -> paper -> blue */');
  divergingRamp.forEach((hex, i) => {
    lines.push(`  --div-${i + 1}: ${hex};`);
  });
  lines.push('');

  lines.push('  /* Spacing — 8px base scale */');
  for (const [step, value] of Object.entries(spacing.scale)) {
    lines.push(`  --space-${step}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Motion — CRAFT-05 / MOTION-01: sine ease-in-out only, unhurried durations */');
  lines.push(`  --ease-sine-in-out: ${motion.easeSineInOut};`);
  lines.push(`  --duration-unhurried: ${motion.durations.unhurried}ms;`);
  lines.push(`  --duration-slow: ${motion.durations.slow}ms;`);

  lines.push('}');
  lines.push('');

  lines.push('/*');
  lines.push(' * Tier-3 "ambient-sculpture" family SCOPED dark variant (Phase 4,');
  lines.push(' * 04-03-PLAN.md) — NOT a general dark mode. Light stays the default');
  lines.push(' * everywhere else. Apply the `tier3-ambient` class to a piece\'s root');
  lines.push(' * element only; every descendant inherits the overridden custom');
  lines.push(' * properties normally.');
  lines.push(' */');
  lines.push('.tier3-ambient {');
  lines.push(`  --color-paper: ${ambientDarkColor.paper.oklch};`);
  lines.push(`  --color-ink: ${ambientDarkColor.ink.oklch};`);
  ambientDarkDivergingRamp.forEach((hex, i) => {
    lines.push(`  --div-${i + 1}: ${hex};`);
  });
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function buildRampsJson() {
  const categorical = categoricalOrder.map((name) => color.categorical[name].hex);
  return {
    paper: color.paper.hex,
    ink: color.ink.hex,
    emphasis: color.emphasis.hex,
    categorical,
    categoricalNames: categoricalOrder,
    sequential: sequentialRamp,
    diverging: divergingRamp,
    // Tier-3 "ambient-sculpture" family SCOPED dark variant — see the
    // `.tier3-ambient` CSS block above. scripts/qa/checks/palette.check.mjs
    // reads this to approve the ambient piece's rendered dark-ground pixels.
    ambientDark: {
      paper: ambientDarkColor.paper.hex,
      ink: ambientDarkColor.ink.hex,
      diverging: ambientDarkDivergingRamp,
    },
    // Expressive family — EXPR-01, Phase 15 (15-CONTEXT.md/ROADMAP SC1, see
    // scripts/design/tokens.mjs's `expressiveColor` comment for the full
    // reconciliation). Derived from house tokens, generated, never hand-
    // edited. `inks` documents the source pair; `multiply` is the one
    // genuinely-new composited color scripts/qa/checks/palette.check.mjs
    // and scripts/qa/pattern-scan.mjs need to recognize.
    expressive: {
      inks: expressiveInkPair,
      multiply: expressiveColor.multiply,
    },
  };
}

async function main() {
  const css = buildTokensCss();
  const cssPath = path.join(repoRoot, 'assets/tokens.css');
  await writeFile(cssPath, css);
  console.log(`Wrote ${path.relative(repoRoot, cssPath)}`);

  const ramps = buildRampsJson();
  const rampsPath = path.join(repoRoot, 'assets/ramps.json');
  await writeFile(rampsPath, JSON.stringify(ramps, null, 2) + '\n');
  console.log(`Wrote ${path.relative(repoRoot, rampsPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
