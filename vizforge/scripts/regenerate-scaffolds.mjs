// scripts/regenerate-scaffolds.mjs
//
// Regenerates every shipped scaffolds/*.html from its scaffolds/src/*.src.html
// via regenerateFromDemoBinding, so the shipped files always match their
// sources + the current shared snippets in assets/snippets/.
//
// Why this exists: before 2026-07-30 there was no entry point for this, and
// no test compared a regenerated scaffold against its shipped counterpart.
// Two shared-snippet updates (Phase 14's createViz `resolve` plumbing in
// assets/snippets/harness.js, Phase 15's --size-poster-* tokens) were
// therefore never re-inlined into ~40 scaffolds. The drift was uniform
// (+2128 bytes, 38 diff lines) and visually inert -- additive CSS custom
// properties nothing referenced, plus a param static pieces never pass --
// which is exactly why nothing surfaced it.
//
// Usage:
//   node scripts/regenerate-scaffolds.mjs           # write changes
//   node scripts/regenerate-scaffolds.mjs --check    # report only, exit 1 if stale
//   node scripts/regenerate-scaffolds.mjs --only bar,line
//
// OUTPUT MAPPING. Three kinds of fragment field name a scaffold output, and
// all three regenerate from the OWNING fragment's demoBinding (the variant
// shares the parent technique's demo dataset):
//   scaffoldPath            -> the base technique
//   animatable.scaffold     -> the animated sibling
//   styleVariants[k].scaffold -> an expressive/hand-drawn variant
// Every output's source is scaffolds/src/<basename>.src.html (asserted 1:1).

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { regenerateFromDemoBinding } from './lib/regenerate-scaffold.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Walks skill/manifest/*.json and returns every scaffold output paired with
 * the fragment slug whose demoBinding produces it, plus its src path.
 *
 * @returns {Promise<Array<{outPath:string, slug:string, srcPath:string, kind:string}>>}
 */
export async function scaffoldTargets() {
  const dir = path.join(repoRoot, 'skill', 'manifest');
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'));

  const targets = [];
  const seen = new Set();

  const push = (outPath, slug, kind) => {
    if (!outPath || seen.has(outPath)) return;
    seen.add(outPath);
    const base = path.basename(outPath).replace(/\.html$/, '');
    targets.push({ outPath, slug, kind, srcPath: `scaffolds/src/${base}.src.html` });
  };

  for (const name of names.sort()) {
    const fragment = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    const slug = fragment.slug;

    push(fragment.scaffoldPath, slug, 'base');

    const animatable = fragment.animatable;
    if (animatable && typeof animatable === 'object' && animatable.scaffold) {
      push(animatable.scaffold, slug, 'animated');
    }

    for (const [variantName, variant] of Object.entries(fragment.styleVariants || {})) {
      if (variant && typeof variant === 'object' && variant.scaffold) {
        push(variant.scaffold, slug, `variant:${variantName}`);
      }
    }
  }

  return targets.sort((a, b) => a.outPath.localeCompare(b.outPath));
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const onlyArg = argv.find((a) => a.startsWith('--only'));
  const only = onlyArg
    ? new Set((onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean))
    : null;

  const targets = await scaffoldTargets();
  const stale = [];
  const failed = [];
  let unchanged = 0;

  for (const target of targets) {
    const base = path.basename(target.outPath).replace(/\.html$/, '');
    if (only && !only.has(base) && !only.has(target.slug)) continue;

    let shipped = null;
    try {
      shipped = await readFile(path.join(repoRoot, target.outPath), 'utf8');
    } catch {
      shipped = null;
    }

    let html;
    try {
      ({ html } = await regenerateFromDemoBinding(target.slug, {
        repoRoot,
        srcPath: target.srcPath,
        outPath: checkOnly ? undefined : target.outPath,
      }));
    } catch (err) {
      failed.push(`${base}: ${err.message}`);
      continue;
    }

    if (shipped === html) {
      unchanged += 1;
    } else {
      const delta = shipped === null ? html.length : html.length - shipped.length;
      stale.push(`${base} (${target.kind}) ${delta >= 0 ? '+' : ''}${delta} bytes`);
    }
  }

  const verb = checkOnly ? 'stale' : 'rewritten';
  console.log(`scaffolds checked: ${unchanged + stale.length + failed.length}`);
  console.log(`  up to date: ${unchanged}`);
  console.log(`  ${verb}:    ${stale.length}`);
  for (const line of stale) console.log(`    ${line}`);

  if (failed.length) {
    console.error(`  FAILED:     ${failed.length}`);
    for (const line of failed) console.error(`    ${line}`);
  }

  if (failed.length) process.exit(2);
  if (checkOnly && stale.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
