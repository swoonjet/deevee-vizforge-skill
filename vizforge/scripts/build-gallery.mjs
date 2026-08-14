#!/usr/bin/env node
// scripts/build-gallery.mjs
//
// GALL-01 gallery build engine (05-01-PLAN.md). Reads the committed curation
// manifest (gallery/curation.json), resolves each selected piece across its
// declared sourceDir (pieces/ | gallery-candidates/ | scaffolds/), extracts a
// provenance record MECHANICALLY from that piece's meta.json (never
// hand-typed — docs/gallery.md is the interface contract), re-gates the
// piece with scripts/qa/gate.mjs's runGate (noSidecar:true — re-gating a
// scaffold must never churn scaffolds/*.gate.json, Phase 4 deferred-items),
// and (unless dataOnly) renders fresh 2x assets into gallery/assets/<slug>/.
// Writes gallery/gallery-data.json — byte-deterministic, no timestamps in
// the file's own bookkeeping — the provenance data model Plan 02's template
// renderer (scripts/gallery-template.mjs) consumes.
//
// GALL-02 (05-02-PLAN.md): on the full build path only (dataOnly === false),
// also inlines assets/tokens.css + assets/fonts/fonts-inline.css and emits
// gallery/index.html via renderGalleryIndex — the house-style, tier-grouped
// showcase shell. --data-only stays the fast metadata-only path (no asset
// render, no index emit) used by tests that render the index themselves.
//
// CLI:
//   node scripts/build-gallery.mjs [--data-only] [--only <slug>]
// On ANY failure (missing piece, gate not PASS): prints the named reason,
// exits 1, never writes a partial gallery-data.json (mirrors
// build-manifest.mjs's all-or-nothing contract).

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from './qa/gate.mjs';
import { captureStatic, captureFrames } from './capture.mjs';
import { renderGalleryIndex } from './gallery-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const encodeShPath = path.join(__dirname, 'encode.sh');

export class GalleryBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GalleryBuildError';
  }
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * resolvePiece({ slug, sourceDir }) -> { meta, htmlPath }
 * Reads `${sourceDir}/${slug}.meta.json`, confirms the sibling
 * `${sourceDir}/${slug}.html` exists. Throws a NAMED GalleryBuildError
 * (never a generic ENOENT) if either is missing/unparseable.
 */
export async function resolvePiece({ slug, sourceDir }) {
  const metaPath = path.join(repoRoot, sourceDir, `${slug}.meta.json`);
  const htmlPath = path.join(repoRoot, sourceDir, `${slug}.html`);

  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch (err) {
    throw new GalleryBuildError(`resolvePiece: meta not found for "${slug}" at ${metaPath} (${err.message})`);
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (err) {
    throw new GalleryBuildError(`resolvePiece: meta unparseable for "${slug}" at ${metaPath} (${err.message})`);
  }

  if (!(await pathExists(htmlPath))) {
    throw new GalleryBuildError(`resolvePiece: html not found for "${slug}" at ${htmlPath}`);
  }

  return { meta, htmlPath };
}

/**
 * buildProvenanceRecord(meta, sourceDir) -> provenance record. PURE — every
 * field is copied verbatim from meta, never hand-typed (docs/gallery.md is
 * the interface Plan 02's template renderer consumes).
 */
export function buildProvenanceRecord(meta, sourceDir) {
  const { slug, kind } = meta;
  const pieceHref = `../${sourceDir}/${slug}.html`;

  const assets =
    kind === 'animated'
      ? {
          poster: `assets/${slug}/poster.png`,
          mp4: `assets/${slug}/delivery.mp4`,
          gif: `assets/${slug}/piece.gif`,
        }
      : {
          poster: `assets/${slug}/${slug}@2x.png`,
          mp4: null,
          gif: null,
        };

  return {
    slug,
    tier: meta.tier,
    technique: meta.technique,
    palette: meta.palette,
    composition: meta.composition,
    kind,
    // Phase 18 (EXPR-07/EXPR-08): register is copied verbatim from meta,
    // defaulting to 'house' when absent — never hand-typed, matching every
    // other field's convention in this function.
    register: meta.register ?? 'house',
    dataset: {
      id: meta.dataset?.id ?? null,
      source: meta.dataset?.source ?? null,
      url: meta.dataset?.url ?? null,
      domain: meta.dataset?.domain ?? null,
    },
    pieceHref,
    assets,
    gate: null,
  };
}

/**
 * renderAssets(meta, htmlPath, outDir) -> fresh 2x assets into outDir.
 * static: a single 2x PNG. animated: frames captured to a gitignored
 * exports/<slug>/frames dir, then encode.sh emits poster/delivery.mp4/gif
 * directly into outDir (gallery/assets/<slug>/). Frames are NEVER committed.
 */
export async function renderAssets(meta, htmlPath, outDir) {
  await mkdir(outDir, { recursive: true });

  if (meta.kind !== 'animated') {
    const outPng = path.join(outDir, `${meta.slug}@2x.png`);
    const opts = meta.framePreset
      ? { preset: meta.framePreset, deviceScaleFactor: 2 }
      : {
          width: meta.dimensions?.css?.[0],
          height: meta.dimensions?.css?.[1],
          deviceScaleFactor: 2,
        };
    await captureStatic(htmlPath, outPng, opts);
    return { outPng };
  }

  const framesDir = path.join(repoRoot, 'exports', meta.slug, 'frames');
  await captureFrames(htmlPath, framesDir, { preset: meta.framePreset });
  execFileSync('bash', [encodeShPath, framesDir, outDir, String(meta.fps)], { stdio: 'inherit' });
  return { outDir };
}

/**
 * gatePiece(htmlPath, slug, outDir) -> { verdict, mode, ranAt }
 * Re-gates with noSidecar:true — CRITICAL: never rewrites the piece's own
 * source-dir *.gate.json sidecar (would churn scaffolds/*.gate.json on
 * every gallery build, Phase 4 deferred-items). The fresh 2x gate evidence
 * is written instead to gallery/assets/<slug>/<slug>.gate.json.
 */
export async function gatePiece(htmlPath, slug, outDir) {
  const report = await runGate(htmlPath, { noSidecar: true });

  await mkdir(outDir, { recursive: true });
  const sidecarPath = path.join(outDir, `${slug}.gate.json`);
  await writeFile(sidecarPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return { verdict: report.verdict, mode: report.mode, ranAt: report.ranAt };
}

async function loadCuration() {
  const curationPath = path.join(repoRoot, 'gallery/curation.json');
  const raw = await readFile(curationPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * loadHouseStyleCss() -> { tokensCss, fontsCss } — raw file contents of
 * assets/tokens.css + assets/fonts/fonts-inline.css, inlined verbatim into
 * gallery/index.html so the shell opens offline via file:// with zero
 * font/token network requests (Plan 02's house-style contract).
 */
export async function loadHouseStyleCss() {
  const tokensCss = await readFile(path.join(repoRoot, 'assets/tokens.css'), 'utf8');
  const fontsCss = await readFile(path.join(repoRoot, 'assets/fonts/fonts-inline.css'), 'utf8');
  return { tokensCss, fontsCss };
}

/**
 * writeGalleryIndex(data) -> writes gallery/index.html from the assembled
 * gallery-data.json object via scripts/gallery-template.mjs's
 * renderGalleryIndex (GALL-02). Exported separately from buildGallery so
 * tests/tools can regenerate the index from an already-built data object
 * without re-running the resolve/gate/render pipeline.
 */
export async function writeGalleryIndex(data) {
  const { tokensCss, fontsCss } = await loadHouseStyleCss();
  const html = renderGalleryIndex(data, { tokensCss, fontsCss });
  const outPath = path.join(repoRoot, 'gallery/index.html');
  await writeFile(outPath, html, 'utf8');
  return outPath;
}

/**
 * buildGallery({ dataOnly, only }) -> the assembled gallery-data.json object.
 * Reads gallery/curation.json; for each selected piece (optionally filtered
 * to a single slug via `only`): resolve, build the provenance record, gate
 * (throws a NAMED GalleryBuildError naming the piece + violations if the
 * verdict isn't PASS), attach the verdict, and (unless dataOnly) render
 * fresh assets. Writes gallery/gallery-data.json only after EVERY selected
 * piece succeeds — never a partial file on failure.
 */
export async function buildGallery({ dataOnly = false, only = null } = {}) {
  const curation = await loadCuration();
  const selected = only ? curation.selected.filter((p) => p.slug === only) : curation.selected;

  if (only && selected.length === 0) {
    throw new GalleryBuildError(`buildGallery: --only "${only}" matches no selected piece in gallery/curation.json`);
  }

  const pieces = [];

  for (const { slug, sourceDir } of selected) {
    const { meta, htmlPath } = await resolvePiece({ slug, sourceDir });
    const record = buildProvenanceRecord(meta, sourceDir);

    const outDir = path.join(repoRoot, 'gallery/assets', slug);
    const gateResult = await gatePiece(htmlPath, slug, outDir);

    if (gateResult.verdict !== 'PASS') {
      throw new GalleryBuildError(
        `buildGallery: "${slug}" did not pass the gate (verdict ${gateResult.verdict}) — see gallery/assets/${slug}/${slug}.gate.json for violations`
      );
    }

    record.gate = gateResult;

    if (!dataOnly) {
      await renderAssets(meta, htmlPath, outDir);
    }

    pieces.push(record);
  }

  const data = {
    generatedFrom: 'gallery/curation.json',
    pieces,
    dropped: curation.dropped,
  };

  const outPath = path.join(repoRoot, 'gallery/gallery-data.json');
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  // gallery/index.html is emitted on the full build path only (mirrors
  // renderAssets above) — --data-only is the fast metadata-refresh path
  // used by tests, which render the index themselves via
  // renderGalleryIndex/writeGalleryIndex when they need it.
  if (!dataOnly) {
    await writeGalleryIndex(data);
  }

  return data;
}

// --- CLI ---
// node scripts/build-gallery.mjs [--data-only] [--only <slug>]

function parseCliArgs(argv) {
  const flags = { dataOnly: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-only') flags.dataOnly = true;
    else if (argv[i] === '--only') flags.only = argv[++i];
  }
  return flags;
}

async function main() {
  const { dataOnly, only } = parseCliArgs(process.argv.slice(2));

  try {
    const data = await buildGallery({ dataOnly, only });
    console.log(
      `Wrote gallery/gallery-data.json (${data.pieces.length} piece(s), ${data.dropped.length} drop(s) logged)${
        dataOnly ? ' [data-only]' : ' + gallery/index.html'
      }`
    );
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

// Only run the CLI when this file is executed directly (not when imported by
// tests) — mirrors build-manifest.mjs/gate.mjs's guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
