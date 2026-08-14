// scripts/qa/diversity-audit.mjs
//
// QA-03 anti-monoculture diversity audit. Reads every top-level
// `*.meta.json` file in a directory (schema v2, docs/qa-schemas.md contract
// #1) and reports spread across tier/technique/palette/composition/
// dataset.domain/kind/framePreset, plus near-duplicate (technique, palette,
// composition) tuples — the QA-03 locked near-duplicate definition
// (exact-match tuple; perceptual hashing deferred to Phase 5).
//
// Report, not blocker (locked decision) — exit code is ALWAYS 0 in this
// phase. Malformed/missing v2 fields are reported as warnings, never a crash.
//
// Usage:
//   node scripts/qa/diversity-audit.mjs <dir> [--json <outPath>]
//
// Library usage (what tests and Phase 5's threshold enforcement call):
//   import { auditDir } from './diversity-audit.mjs';

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SPREAD_AXES = ['tier', 'technique', 'palette', 'composition', 'domain', 'kind', 'framePreset', 'register'];
const REQUIRED_V2_FIELDS = ['tier', 'technique', 'palette', 'composition'];

async function listMetaFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.meta.json'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function relLabel(filePath) {
  const rel = path.relative(repoRoot, filePath);
  // Keep it readable even for paths outside repoRoot (e.g. test temp dirs).
  return rel.startsWith('..') ? filePath : rel;
}

function axisValues(meta) {
  return {
    tier: meta.tier !== undefined && meta.tier !== null ? String(meta.tier) : '(missing)',
    technique: meta.technique || '(missing)',
    palette: meta.palette || '(missing)',
    composition: meta.composition || '(missing)',
    domain: meta.dataset?.domain || '(missing)',
    kind: meta.kind || '(missing)',
    framePreset: meta.framePreset || '(none)',
    // Phase 18 (EXPR-08): register is a LABEL, not a required v2 field —
    // absent means house (mirrors build-gallery.mjs's buildProvenanceRecord
    // convention, register: meta.register ?? 'house'). Report-only spread,
    // never affects the near-duplicate tuple definition below.
    register: meta.register || 'house',
  };
}

function requiredFieldWarnings(meta, label) {
  const warnings = [];
  for (const field of REQUIRED_V2_FIELDS) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === '') {
      warnings.push(`${label}: missing v2 field "${field}"`);
    }
  }
  if (!meta.dataset || meta.dataset.domain === undefined || meta.dataset.domain === null || meta.dataset.domain === '') {
    warnings.push(`${label}: missing v2 field "dataset.domain"`);
  }
  if (!meta.kind) {
    warnings.push(`${label}: missing field "kind"`);
  }
  return warnings;
}

/**
 * Reads every *.meta.json in `dir`, computes spread tables, near-duplicate
 * (technique, palette, composition) tuples, and simple coverage stats.
 * Never throws on malformed/missing-v2-field metas — reports them as
 * warnings instead. Returns the full report object (auditVersion: 1).
 */
export async function auditDir(dir) {
  const warnings = [];
  let metaFiles;

  try {
    metaFiles = await listMetaFiles(dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        auditVersion: 1,
        dir,
        generatedAt: new Date().toISOString(),
        totalPieces: 0,
        warnings: [`directory "${dir}" does not exist`],
        spread: Object.fromEntries(SPREAD_AXES.map((a) => [a, {}])),
        nearDuplicates: [],
        coverage: {
          distinctCounts: Object.fromEntries(SPREAD_AXES.map((a) => [a, 0])),
          tuple: { distinctTuples: 0, totalPieces: 0, ratio: 0 },
        },
      };
    }
    throw err;
  }

  const pieces = [];

  for (const filePath of metaFiles) {
    const label = relLabel(filePath);
    let meta;
    try {
      meta = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (err) {
      warnings.push(`${label}: failed to parse JSON (${err.message})`);
      continue;
    }

    if (meta.schemaVersion !== 2) {
      warnings.push(
        `${label}: schemaVersion is "${meta.schemaVersion}", not 2 — skipping from diversity analysis`
      );
      continue;
    }

    warnings.push(...requiredFieldWarnings(meta, label));

    const slug = meta.slug || path.basename(filePath).replace(/\.meta\.json$/, '');
    pieces.push({ slug, axes: axisValues(meta) });
  }

  // Spread tables: count + slugs per distinct value, per axis.
  const spread = {};
  for (const axis of SPREAD_AXES) {
    const buckets = {};
    for (const piece of pieces) {
      const value = piece.axes[axis];
      if (!buckets[value]) buckets[value] = { count: 0, slugs: [] };
      buckets[value].count += 1;
      buckets[value].slugs.push(piece.slug);
    }
    spread[axis] = buckets;
  }

  // Near-duplicates: identical (technique, palette, composition) tuple.
  const tupleGroups = {};
  for (const piece of pieces) {
    const key = `${piece.axes.technique}|${piece.axes.palette}|${piece.axes.composition}`;
    if (!tupleGroups[key]) tupleGroups[key] = [];
    tupleGroups[key].push(piece.slug);
  }

  const nearDuplicates = [];
  for (const [key, slugs] of Object.entries(tupleGroups)) {
    if (slugs.length < 2) continue;
    const [technique, palette, composition] = key.split('|');
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        nearDuplicates.push({
          slugs: [slugs[i], slugs[j]],
          tuple: { technique, palette, composition },
          caution: `near-duplicate: ${slugs[i]} and ${slugs[j]} share (${technique}, ${palette}, ${composition})`,
        });
      }
    }
  }

  const distinctCounts = {};
  for (const axis of SPREAD_AXES) {
    distinctCounts[axis] = Object.keys(spread[axis]).length;
  }
  const distinctTuples = Object.keys(tupleGroups).length;

  return {
    auditVersion: 1,
    dir,
    generatedAt: new Date().toISOString(),
    totalPieces: pieces.length,
    warnings,
    spread,
    nearDuplicates,
    coverage: {
      distinctCounts,
      tuple: {
        distinctTuples,
        totalPieces: pieces.length,
        ratio: distinctTuples > 0 ? pieces.length / distinctTuples : 0,
      },
    },
  };
}

function printReport(report) {
  console.log(`Diversity audit: ${report.dir}`);
  console.log(`Total pieces analyzed: ${report.totalPieces}`);

  if (report.warnings.length > 0) {
    console.log(`\nWarnings (${report.warnings.length}):`);
    for (const w of report.warnings) console.log(`  - ${w}`);
  }

  console.log('\nSpread:');
  for (const axis of SPREAD_AXES) {
    const buckets = report.spread[axis] || {};
    console.log(`  ${axis}:`);
    for (const [value, { count, slugs }] of Object.entries(buckets)) {
      console.log(`    ${value}: ${count} (${slugs.join(', ')})`);
    }
  }

  console.log(`\nNear-duplicates (${report.nearDuplicates.length}):`);
  for (const dup of report.nearDuplicates) {
    console.log(`  CAUTION: ${dup.caution}`);
  }

  console.log('\nCoverage:');
  for (const [axis, count] of Object.entries(report.coverage.distinctCounts)) {
    console.log(`  distinct ${axis}: ${count}`);
  }
  console.log(
    `  tuple spread: ${report.coverage.tuple.distinctTuples} distinct (technique,palette,composition) tuples across ${report.coverage.tuple.totalPieces} pieces (ratio ${report.coverage.tuple.ratio.toFixed(2)})`
  );
}

function parseArgs(argv) {
  let dir = 'pieces';
  let jsonOutPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') {
      jsonOutPath = argv[i + 1];
      i++;
    } else if (!argv[i].startsWith('--')) {
      dir = argv[i];
    }
  }
  return { dir, jsonOutPath };
}

async function main() {
  const { dir, jsonOutPath } = parseArgs(process.argv.slice(2));

  const report = await auditDir(dir);
  printReport(report);

  if (jsonOutPath) {
    await writeFile(jsonOutPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`\nWrote JSON report to ${jsonOutPath}`);
  }

  // Locked decision: report, not blocker. Always exit 0 in this phase.
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(0);
  });
}
