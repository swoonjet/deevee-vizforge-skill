// scripts/lib/regenerate-scaffold.mjs
//
// BIND-02 (Phase 7 Plan 03) -- the shared regression-anchor + final-sweep
// harness. Every proof/scaling/final plan in this phase calls
// `regenerateFromDemoBinding(slug)` to rebuild a technique's scaffold HTML
// straight from its manifest fragment's `demoBinding` block: read the demo
// dataset, profile it (scripts/profile.mjs), bind it through the technique's
// shaper (scripts/bind-data.mjs), and inject the shaped result into the
// fragment's `.src.html` via `assembleWithData` (this file's sibling).
//
// A demo binding MUST bind -- its failure is a real regression, never a
// silently-swallowed warning, so a failed bind throws with the structured
// errors rather than returning a partial result.

import { readFile as fsReadFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { profile } from '../profile.mjs';
import { bindData } from '../bind-data.mjs';
import { assembleWithData } from './assemble-with-data.mjs';

function formatFromPath(datasetPath) {
  if (datasetPath.endsWith('.json')) return 'json';
  if (datasetPath.endsWith('.tsv')) return 'tsv';
  return 'csv';
}

function formatBindingErrors(errors) {
  return errors.map((e) => `[${e.channel}] ${e.problem} -- ${e.remedy}`).join('; ');
}

// scripts/regenerate-scaffolds.mjs's own outPath -> srcPath convention, reused
// here so a target's authored demo copy can be found from the src being
// assembled (see resolveDemoCopy).
function srcForScaffold(outPath) {
  const base = path.basename(outPath).replace(/\.html$/, '');
  return `scaffolds/src/${base}.src.html`;
}

/**
 * The authored demo copy for the ONE target being assembled.
 *
 * A fragment can own several scaffolds -- its base, an `animatable` sibling,
 * and any `styleVariants` -- and those siblings ship DIFFERENT prose
 * (annotated-nightingale-rose's dek carries an annotation sentence
 * nightingale-rose's does not; waffle-isotype-glyph's methodology names the
 * glyph unit). One shared `demoBinding.copy` would overwrite a variant's
 * shipped prose with its base's, so a variant/animatable entry may declare
 * its own `copy` block, merged OVER the base's.
 *
 * Resolved from the src path rather than passed in by the caller: every
 * existing call site already says WHICH src it wants, and a caller that had to
 * remember to also pass the matching copy would silently regenerate a variant
 * with the wrong prose.
 */
function resolveDemoCopy(fragment, resolvedSrcRepoRelative) {
  const base = fragment.demoBinding.copy || {};

  const candidates = [];
  const animatable = fragment.animatable;
  if (animatable && typeof animatable === 'object' && animatable.scaffold) {
    candidates.push(animatable);
  }
  for (const variant of Object.values(fragment.styleVariants || {})) {
    if (variant && typeof variant === 'object' && variant.scaffold) candidates.push(variant);
  }

  for (const candidate of candidates) {
    // Match on the declared srcPath OR the outPath convention: scaffoldTargets
    // assembles the convention (`scaffolds/src/<basename>.src.html`) while most
    // variant entries also declare an identical `srcPath`, and a future entry
    // where the two diverge must not silently miss its own copy.
    const matches = candidate.srcPath === resolvedSrcRepoRelative
      || srcForScaffold(candidate.scaffold) === resolvedSrcRepoRelative;
    if (!matches) continue;
    if (!candidate.copy) return base;
    return { ...base, ...candidate.copy };
  }

  return base;
}

/**
 * regenerateFromDemoBinding(slug, opts) -> Promise<{ html: string, shapedData: object }>
 *
 * @param {string} slug - the technique's manifest slug (matches
 *   `skill/manifest/<slug>.json`'s own `slug` field)
 * @param {{
 *   repoRoot: string,
 *   srcPath?: string,
 *   outPath?: string,
 *   shapersDir?: string|URL,
 * }} opts
 *   `srcPath` (repo-relative), when given, is assembled INSTEAD of the
 *   fragment's own `srcPath` -- this is how a base+animated technique pair
 *   regenerates its ANIMATED sibling from the exact same shaped data (the
 *   shape is computed ONCE and reused for both the static and animated src).
 *   Animated-only techniques (flow-field/ambient-sculpture) simply have
 *   their fragment's own `srcPath` already pointing at `*-animated.src.html`,
 *   so the default (no override) already regenerates the right file.
 *   `outPath` (repo-relative), when given, writes the assembled HTML there.
 *   `shapersDir` is an optional override threaded straight through to
 *   `bindData` -- used ONLY by this project's own tests to point at a
 *   fixtures shaper directory instead of the real `scripts/shapers/`.
 * @returns {Promise<{html: string, shapedData: object}>}
 */
export async function regenerateFromDemoBinding(slug, { repoRoot, srcPath, outPath, shapersDir } = {}) {
  const manifestPath = path.join(repoRoot, 'skill', 'manifest', `${slug}.json`);
  const fragmentText = await fsReadFile(manifestPath, 'utf8');
  const fragment = JSON.parse(fragmentText);

  const demoBinding = fragment.demoBinding;
  if (!demoBinding) {
    throw new Error(`regenerateFromDemoBinding: fragment "${slug}" has no demoBinding block`);
  }

  const datasetText = await fsReadFile(path.join(repoRoot, demoBinding.datasetPath), 'utf8');
  const format = demoBinding.format || formatFromPath(demoBinding.datasetPath);
  const profiled = profile(datasetText, { format });

  // demoBinding.aggregation (top-level, sibling to `bindings`) forwards
  // into the bindingSpec's own `aggregation` field -- bindData/
  // validateBinding only ever read `bindingSpec.aggregation`, never a
  // sibling fragment field, so a demoBinding declaring a non-default
  // aggregation (e.g. chord/sankey-alluvial's `sum`, Phase 7 Plans 05/12)
  // must be merged in here, not silently dropped (previously-documented gap,
  // STATE.md Phase 7-04 decision -- fixed here since chord's real, non-{1s}
  // edge values are the first demo binding where silently defaulting to
  // 'count' actually changes the shipped finding).
  const bindingSpec = demoBinding.aggregation
    ? { ...demoBinding.bindings, aggregation: demoBinding.aggregation }
    : demoBinding.bindings;

  const result = await bindData(slug, profiled.rows, bindingSpec, {
    contract: fragment.dataBinding,
    profile: profiled,
    shapersDir,
  });

  if (!result.ok) {
    throw new Error(
      `regenerateFromDemoBinding: demoBinding for "${slug}" failed to bind: ${formatBindingErrors(result.errors)}`
    );
  }

  const shapedJson = JSON.stringify(result.data);

  const resolvedSrcRepoRelative = srcPath || fragment.srcPath;
  if (!resolvedSrcRepoRelative) {
    throw new Error(`regenerateFromDemoBinding: fragment "${slug}" has no srcPath and none was provided`);
  }
  const srcText = await fsReadFile(path.join(repoRoot, resolvedSrcRepoRelative), 'utf8');

  // copy.json (Phase 8 Plan 02, EDIT-03) -- registers the BOUND_COPY virtual
  // file every scaffold's `<!-- @inline-data __DATA__/copy.json AS
  // BOUND_COPY -->` directive resolves against. Registered unconditionally
  // (not only when a copy block is present) because assembleWithData throws on
  // ANY directive whose key isn't registered, and every reachable scaffold now
  // carries the directive.
  //
  // A fragment that declares NO copy passes `{}`, so every `copy.X || <default>`
  // falls through to the scaffold's own computed default -- the original
  // byte-identical demo regeneration. A fragment that DOES declare copy is
  // saying "this demo piece was authored": the 2026-07-31 subject retrofit put
  // eighteen demos' dataset-specific prose here so their scaffolds' fallbacks
  // could become neutral without changing a single rendered demo sentence.
  const copy = resolveDemoCopy(fragment, resolvedSrcRepoRelative);

  const html = await assembleWithData(srcText, {
    repoRoot,
    virtualFiles: { 'bound.json': shapedJson, 'copy.json': JSON.stringify(copy) },
  });

  if (outPath) {
    await writeFile(path.join(repoRoot, outPath), html, 'utf8');
  }

  return { html, shapedData: result.data };
}
