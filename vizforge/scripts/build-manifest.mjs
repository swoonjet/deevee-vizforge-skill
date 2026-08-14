#!/usr/bin/env node
// scripts/build-manifest.mjs
//
// ATLAS-05 manifest fragment schema contract (docs/atlas-manifest.md).
// Exports validateFragment(fragment) — pure, returns a list of named
// problem strings (empty array = valid) — and buildManifest(fragmentsDir)
// — pure, reads one JSON file per technique (excluding underscore-prefixed
// framework files) plus that directory's _framework.json, validates every
// fragment, and returns the assembled manifest object.
//
// Per-technique fragment files (one file per slug) mean parallel Wave-2
// batch plans never edit one shared JSON — this is the whole point of the
// fragment/assembly split (03-02-PLAN.md's locked truth).
//
// CLI:
//   node scripts/build-manifest.mjs [--dir skill/manifest] [--out skill/manifest.json]
// Validates every fragment; on ANY problem, exits 1 listing every filename
// with its problems (never a partial/best-effort manifest). On success,
// writes byte-deterministic (sorted, no timestamps) JSON.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Controlled vocabularies (docs/atlas-manifest.md is the human-readable
// contract; these arrays are the single machine source of truth both
// validateFragment and this file's own tests import, so the two never
// drift apart).
export const FT_DATA_SHAPES = [
  'change-over-time',
  'magnitude',
  'distribution',
  'correlation',
  'ranking',
  'part-to-whole',
  'flow',
  'cyclical',
  'geospatial',
  'hierarchy',
  'network',
];

export const RUBRIC_FAMILIES = [
  'line-area',
  'bar-column',
  'scatter-distribution',
  'animated-reveal',
  'ambient-loop',
  'relational-flow',
];

export const EXPECTED_CHANNELS = ['position', 'length', 'area', 'angle', 'color'];

// BIND-01 dataBinding contract vocab (docs/atlas-manifest.md "dataBinding
// contract" section). REQUIRED on every fragment (flipped at Phase 7's
// final coverage plan, 07-14, once all 25 fragments carried the block) --
// see the validateFragment() branch below.
export const DATA_BINDING_SHAPES = ['table', 'edges', 'matrix', 'grid', 'series', 'tree', 'graph'];
export const FIELD_TYPES = ['quantitative', 'temporal', 'ordinal', 'nominal'];

// EXPR-07 register vocab (docs/atlas-manifest.md, 18-CONTEXT.md): a LABEL +
// surfacing hook, orthogonal to tier. Absent means 'house' (the default) --
// NEVER a 4th tier, and NEVER read by recommend.mjs's scoring (tierWeight/
// noveltyBonus stay the sole familiarity axis; a register-neutrality guard
// test proves this in scripts/tests/smoke/recommend-real-manifest.test.mjs).
export const REGISTER_VALUES = ['house', 'expressive'];

export class FragmentValidationError extends Error {
  constructor(details) {
    const summary = details.map((d) => `${d.file}: ${d.problems.join('; ')}`).join(' | ');
    super(`Fragment validation failed for ${details.length} file(s): ${summary}`);
    this.name = 'FragmentValidationError';
    this.details = details;
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Problems in an authored demo `copy` block (demoBinding.copy, or a
 * variant/animatable sibling's own override).
 *
 * Authored demo copy is how the 2026-07-31 subject retrofit kept all eighteen
 * retrofitted demos byte-identical: their dataset-specific prose moved OUT of
 * the scaffold fallback (where it was being rendered over other people's data)
 * and INTO the fragment, where it applies to the demo piece alone.
 *
 * Channel NAMES are deliberately not whitelisted here — each technique reads
 * its own set (`unit`, `methodNote`, `areaDisclosure`, `baselineDisclosure`,
 * ... alongside headline/dek/source/methodology/note/subject), so a fixed list
 * would be a false lock. That a channel is actually read by the scaffold it is
 * authored for is proved instead by scripts/tests/smoke/scaffold-subject.test.mjs,
 * which reads the src. What IS structural: an empty string is rejected, because
 * `copy.X || <default>` treats it as absent — a blank channel silently renders
 * the fallback, which is the very trap this retrofit exists to close.
 */
function demoCopyProblems(copy, label) {
  if (copy === undefined) return [];
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
    return [`${label}: must be an object mapping copy channel -> string when present`];
  }

  const problems = [];
  for (const [channel, value] of Object.entries(copy)) {
    if (!isNonEmptyString(value)) {
      problems.push(
        `${label}.${channel}: must be a non-empty string — an empty one does not suppress the scaffold's fallback`
      );
    }
  }
  return problems;
}

/**
 * validateFragment(fragment) -> string[]
 * Returns [] for a fully-valid fragment. Every problem is a specific, named
 * string (never generic) — mirrors docs/qa-schemas.md's "evidence must be
 * SPECIFIC and NAMED" convention for check modules.
 */
export function validateFragment(fragment) {
  const problems = [];
  const f = fragment && typeof fragment === 'object' ? fragment : {};

  if (!isNonEmptyString(f.slug)) {
    problems.push('slug: missing or invalid (must be a non-empty string)');
  }

  if (![1, 2, 3].includes(f.tier)) {
    problems.push(`tier: must be 1, 2, or 3 (got ${JSON.stringify(f.tier)})`);
  }

  if (!RUBRIC_FAMILIES.includes(f.family)) {
    problems.push(
      `family: "${f.family}" is not one of the ${RUBRIC_FAMILIES.length} rubric families (${RUBRIC_FAMILIES.join(', ')})`
    );
  }

  if (!Array.isArray(f.dataShapes) || f.dataShapes.length === 0) {
    problems.push('dataShapes: must be a non-empty array');
  } else {
    const invalid = f.dataShapes.filter((s) => !FT_DATA_SHAPES.includes(s));
    if (invalid.length > 0) {
      problems.push(`dataShapes: contains non-FT-vocabulary value(s): ${invalid.join(', ')}`);
    }
  }

  if (!Array.isArray(f.variationAxes) || f.variationAxes.length === 0) {
    problems.push('variationAxes: must be a non-empty array (ATLAS-06)');
  }

  if (!isNonEmptyString(f.scaffoldPath)) {
    problems.push('scaffoldPath: missing or invalid (must be a non-empty string)');
  }

  if (!isNonEmptyString(f.referencePath)) {
    problems.push('referencePath: missing or invalid (must be a non-empty string)');
  }

  if (!EXPECTED_CHANNELS.includes(f.expectedChannel)) {
    problems.push(
      `expectedChannel: must be one of ${EXPECTED_CHANNELS.join(', ')} (got ${JSON.stringify(f.expectedChannel)})`
    );
  }

  if (!f.animatable || typeof f.animatable !== 'object' || typeof f.animatable.value !== 'boolean') {
    problems.push('animatable: missing or malformed (must be { value: boolean, mode?: string })');
  } else if (f.animatable.value === true && !isNonEmptyString(f.animatable.mode)) {
    problems.push('animatable: value:true requires a non-empty "mode" string');
  }

  // register (EXPR-07): when present, must be exactly one of REGISTER_VALUES.
  // Absent is allowed and means 'house' -- house is never accidentally
  // expressive by omission. This is a LABEL only; it must never be read by
  // recommend.mjs's scoring (see the export comment above).
  if (f.register !== undefined && !REGISTER_VALUES.includes(f.register)) {
    problems.push(
      `register: must be one of ${REGISTER_VALUES.join(', ')} when present (got ${JSON.stringify(f.register)})`
    );
  }

  // demoOnly: the fragment's own admission that this technique CANNOT render a
  // foreign table -- its scaffold or its shaper is pinned to the demo dataset's
  // meaning, not merely tuned for it. A dataBinding contract describes what the
  // roles WOULD be; it cannot tell you the scaffold hardcodes the column names
  // behind them. Without this field the only source of truth was a render that
  // threw, so the recommender offered a piece that could never draw.
  //
  // Absent means "renders anyone's data", which is the normal case. Present, it
  // must carry a `reason` in READER-FACING prose, because that sentence is what
  // recommend() hands back as the refusal and what the Studio prints on the
  // card -- there is no second place to write it.
  if (f.demoOnly !== undefined) {
    if (!f.demoOnly || typeof f.demoOnly !== 'object' || Array.isArray(f.demoOnly)) {
      problems.push('demoOnly: must be an object with a "reason" string when present');
    } else if (!isNonEmptyString(f.demoOnly.reason)) {
      problems.push('demoOnly.reason: must be a non-empty, reader-facing sentence');
    }
  }

  // styleVariants (Phase-16 shape, previously unvalidated): when present,
  // must be a non-null non-array object whose every value is an object with
  // a non-empty string scaffold + srcPath -- mirrors the animatable block
  // above's per-field named-problem convention.
  if (f.styleVariants !== undefined) {
    if (typeof f.styleVariants !== 'object' || f.styleVariants === null || Array.isArray(f.styleVariants)) {
      problems.push('styleVariants: must be an object when present');
    } else {
      for (const [key, variant] of Object.entries(f.styleVariants)) {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
          problems.push(`styleVariants.${key}: must be an object with "scaffold" and "srcPath" strings`);
          continue;
        }
        if (!isNonEmptyString(variant.scaffold)) {
          problems.push(`styleVariants.${key}.scaffold: must be a non-empty string`);
        }
        if (!isNonEmptyString(variant.srcPath)) {
          problems.push(`styleVariants.${key}.srcPath: must be a non-empty string`);
        }
      }
    }
  }

  if (f.intents !== undefined && !isStringArray(f.intents)) {
    problems.push('intents: must be an array of strings when present');
  }

  if (f.honestyRisks !== undefined && !isStringArray(f.honestyRisks)) {
    problems.push('honestyRisks: must be an array of strings when present');
  }

  if (f.preconditions !== undefined && !isStringArray(f.preconditions)) {
    problems.push('preconditions: must be an array of strings when present');
  }

  if (f.qaGates !== undefined && !isStringArray(f.qaGates)) {
    problems.push('qaGates: must be an array of strings when present');
  }

  if (f.seriesLimits !== undefined) {
    if (typeof f.seriesLimits !== 'object' || f.seriesLimits === null || Array.isArray(f.seriesLimits)) {
      problems.push('seriesLimits: must be an object when present');
    } else {
      for (const key of ['maxCategories', 'maxPoints']) {
        if (f.seriesLimits[key] !== undefined && typeof f.seriesLimits[key] !== 'number') {
          problems.push(`seriesLimits.${key}: must be a number when present`);
        }
      }
    }
  }

  if (f.srcPath !== undefined && !isNonEmptyString(f.srcPath)) {
    problems.push('srcPath: must be a non-empty string when present');
  }

  if (f.tier === 3) {
    if (!Array.isArray(f.mapping) || f.mapping.length === 0) {
      problems.push('mapping: tier 3 requires a non-empty mapping array');
    } else {
      f.mapping.forEach((m, i) => {
        for (const key of ['visualParameter', 'dataField', 'transform']) {
          if (typeof m?.[key] !== 'string' || m[key].length === 0) {
            problems.push(`mapping[${i}].${key}: must be a non-empty string`);
          }
        }
      });
    }
  }

  // dataBinding (BIND-01): the machine-readable "which user columns map to
  // which channel" contract. REQUIRED on every fragment — flipped from
  // when-present now that all 25 real fragments carry the block (Phase 7's
  // final coverage plan, 07-14). This is the contract lock: a future
  // fragment landing without a dataBinding block now fails the build
  // immediately rather than silently regressing coverage. Mirrors the
  // tier-3 `mapping` block above: an unconditional branch that pushes every
  // specific named problem, never stopping at the first.
  if (f.dataBinding === undefined) {
    problems.push('dataBinding: required (missing) — every fragment must carry a dataBinding block');
  } else {
    if (!f.dataBinding || typeof f.dataBinding !== 'object' || Array.isArray(f.dataBinding)) {
      problems.push('dataBinding: must be an object');
    } else {
      if (!DATA_BINDING_SHAPES.includes(f.dataBinding.shape)) {
        problems.push(
          `dataBinding.shape: must be one of ${DATA_BINDING_SHAPES.join(', ')} (got ${JSON.stringify(f.dataBinding.shape)})`
        );
      }

      // A 'tree' shape (hierarchy family: treemap/sunburst/circle-packing) or
      // a 'graph' shape (networks family: arc-diagram/adjacency-matrix/
      // node-link) legitimately has ZERO per-column roles -- the entire
      // nested/graph JSON structure IS the binding, unlike a
      // table/edges/matrix/grid/series shape where individual columns map to
      // individual roles.
      if (f.dataBinding.shape === 'tree' || f.dataBinding.shape === 'graph') {
        if (!Array.isArray(f.dataBinding.roles)) {
          problems.push('dataBinding.roles: must be an array (may be empty when shape is "tree" or "graph")');
        }
      } else if (!Array.isArray(f.dataBinding.roles) || f.dataBinding.roles.length === 0) {
        problems.push('dataBinding.roles: must be a non-empty array');
      } else {
        f.dataBinding.roles.forEach((r, i) => {
          if (typeof r?.role !== 'string' || r.role.length === 0) {
            problems.push(`dataBinding.roles[${i}].role: must be a non-empty string`);
          }
          if (!Array.isArray(r?.types) || r.types.length === 0 || r.types.some((t) => !FIELD_TYPES.includes(t))) {
            problems.push(
              `dataBinding.roles[${i}].types: must be a non-empty array of ${FIELD_TYPES.join('|')}`
            );
          }
          if (typeof r?.required !== 'boolean') {
            problems.push(`dataBinding.roles[${i}].required: must be a boolean`);
          }
          if (typeof r?.label !== 'string' || r.label.length === 0) {
            problems.push(`dataBinding.roles[${i}].label: must be a non-empty string`);
          }
          if (r?.aggregation !== undefined) {
            if (!isStringArray(r.aggregation) || r.aggregation.length === 0) {
              problems.push(
                `dataBinding.roles[${i}].aggregation: must be a non-empty array of strings when present`
              );
            }
            if (!isNonEmptyString(r?.defaultAggregation)) {
              problems.push(
                `dataBinding.roles[${i}].defaultAggregation: required (non-empty string) when aggregation is present`
              );
            }
          }
          // `multiColumn: true` (Phase 7 Plan 12, streamgraph's `layers`
          // role) flags that this role's BOUND VALUE is an array of column
          // names, not a single column -- scripts/bind-data.mjs's own
          // normalizeRoleBinding() is what actually enforces that arity at
          // bind time; this schema only checks the flag's own type.
          if (r?.multiColumn !== undefined && typeof r.multiColumn !== 'boolean') {
            problems.push(`dataBinding.roles[${i}].multiColumn: must be a boolean when present`);
          }
        });
      }

      if (f.dataBinding.pivotTo !== undefined && f.dataBinding.pivotTo !== 'matrix') {
        problems.push(
          `dataBinding.pivotTo: only "matrix" is allowed when present (got ${JSON.stringify(f.dataBinding.pivotTo)})`
        );
      }
    }
  }

  // demoBinding (BIND-02 regression anchor): the per-fragment "which real
  // demo dataset + which literal columns reproduce today's shipped finding"
  // block. REQUIRED on every fragment — same contract-lock flip as
  // dataBinding above, same rationale (07-14).
  if (f.demoBinding === undefined) {
    problems.push('demoBinding: required (missing) — every fragment must carry a demoBinding block');
  } else {
    if (!f.demoBinding || typeof f.demoBinding !== 'object' || Array.isArray(f.demoBinding)) {
      problems.push('demoBinding: must be an object');
    } else {
      if (!isNonEmptyString(f.demoBinding.datasetPath)) {
        problems.push('demoBinding.datasetPath: must be a non-empty string');
      }

      if (f.demoBinding.format !== undefined && !['csv', 'tsv', 'json'].includes(f.demoBinding.format)) {
        problems.push(
          `demoBinding.format: must be one of csv, tsv, json when present (got ${JSON.stringify(f.demoBinding.format)})`
        );
      }

      if (
        !f.demoBinding.bindings ||
        typeof f.demoBinding.bindings !== 'object' ||
        Array.isArray(f.demoBinding.bindings)
      ) {
        problems.push('demoBinding.bindings: must be an object mapping role -> columnName');
      } else {
        for (const [role, columnName] of Object.entries(f.demoBinding.bindings)) {
          // A `multiColumn` role's demoBinding value (e.g. streamgraph's
          // `layers`, Phase 7 Plan 12) is a non-empty ARRAY of column-name
          // strings, not a single string -- the same string|string[] arity
          // scripts/bind-data.mjs's own bindingSpec already accepts.
          const isValidSingle = isNonEmptyString(columnName);
          const isValidMulti =
            Array.isArray(columnName) && columnName.length > 0 && columnName.every((c) => isNonEmptyString(c));
          if (!isValidSingle && !isValidMulti) {
            problems.push(
              `demoBinding.bindings.${role}: must be a non-empty string column name or a non-empty array of column names`
            );
          }
        }
      }

      if (
        f.demoBinding.aggregation !== undefined &&
        (typeof f.demoBinding.aggregation !== 'object' ||
          f.demoBinding.aggregation === null ||
          Array.isArray(f.demoBinding.aggregation))
      ) {
        problems.push('demoBinding.aggregation: must be an object when present');
      }

      problems.push(...demoCopyProblems(f.demoBinding.copy, 'demoBinding.copy'));
    }
  }

  // A variant/animatable sibling may author its OWN demo copy (it ships
  // different prose than its base — see resolveDemoCopy in
  // scripts/lib/regenerate-scaffold.mjs), so those blocks answer to the same
  // rules as the base's.
  if (f.animatable && typeof f.animatable === 'object' && f.animatable.copy !== undefined) {
    problems.push(...demoCopyProblems(f.animatable.copy, 'animatable.copy'));
  }
  for (const [name, variant] of Object.entries(f.styleVariants || {})) {
    if (variant && typeof variant === 'object' && variant.copy !== undefined) {
      problems.push(...demoCopyProblems(variant.copy, `styleVariants.${name}.copy`));
    }
  }

  return problems;
}

async function listFragmentFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

/**
 * buildManifest(fragmentsDir) -> Promise<manifest object>
 * Pure (besides reading the filesystem) — never writes anything. Reads
 * every non-underscore-prefixed *.json file in fragmentsDir as a fragment,
 * validates ALL of them before deciding anything (never a partial result),
 * and merges fragmentsDir/_framework.json's antiPatterns + defaults into
 * the assembled manifest's top-level keys.
 */
export async function buildManifest(fragmentsDir) {
  const fragmentFiles = await listFragmentFiles(fragmentsDir);

  const details = [];
  const fragments = [];

  for (const fileName of fragmentFiles) {
    const filePath = path.join(fragmentsDir, fileName);
    let fragment;
    try {
      fragment = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (err) {
      details.push({ file: fileName, problems: [`invalid JSON: ${err.message}`] });
      continue;
    }

    // A fragment's defining structural property is having a top-level
    // "slug" key AT ALL (even if that key's value later fails validation).
    // Files with no "slug" key are silently excluded from fragment
    // discovery rather than reported as a validation failure — this lets
    // an assembled manifest (e.g. a fixture's own manifest.fixture.json)
    // live alongside its source fragments in the same directory without
    // buildManifest() treating its own prior output as a malformed
    // fragment on the next run (found while wiring recommend.test.mjs's
    // fixture atlas, Plan 03-02 Task 3).
    if (!fragment || typeof fragment !== 'object' || !('slug' in fragment)) {
      continue;
    }

    const problems = validateFragment(fragment);
    if (problems.length > 0) {
      details.push({ file: fileName, problems });
    } else {
      fragments.push(fragment);
    }
  }

  if (details.length > 0) {
    throw new FragmentValidationError(details);
  }

  fragments.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const frameworkPath = path.join(fragmentsDir, '_framework.json');
  let framework;
  try {
    framework = JSON.parse(await readFile(frameworkPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `build-manifest: could not read framework data at ${frameworkPath} (${err.message})`
    );
  }

  return {
    manifestVersion: 1,
    techniques: fragments,
    antiPatterns: framework.antiPatterns || [],
    defaults: framework.defaults || {},
  };
}

// --- CLI ---
// node scripts/build-manifest.mjs [--dir skill/manifest] [--out skill/manifest.json]

function parseCliArgs(argv) {
  const flags = { dir: 'skill/manifest', out: 'skill/manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') flags.dir = argv[++i];
    else if (argv[i] === '--out') flags.out = argv[++i];
  }
  return flags;
}

async function main() {
  const { dir, out } = parseCliArgs(process.argv.slice(2));

  let manifest;
  try {
    manifest = await buildManifest(dir);
  } catch (err) {
    if (err instanceof FragmentValidationError) {
      console.error(`Fragment validation failed for ${err.details.length} file(s) in ${dir}:`);
      for (const { file, problems } of err.details) {
        console.error(`  ${file}:`);
        for (const p of problems) console.error(`    - ${p}`);
      }
      process.exitCode = 1;
      return;
    }
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  // Stable 2-space JSON + trailing newline, NO timestamps — byte-determinism
  // (verification: run this CLI twice, diff the two output files, expect
  // zero difference).
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(out, json, 'utf8');
  console.log(
    `Wrote ${out} (${manifest.techniques.length} technique(s), ${manifest.antiPatterns.length} anti-pattern(s))`
  );
}

// Only run the CLI when this file is executed directly (not when imported
// by tests/recommend.mjs) — mirrors gate.mjs/pattern-scan.mjs's guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
