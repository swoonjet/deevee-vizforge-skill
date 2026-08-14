// scripts/qa/checks/loop-continuity.check.mjs
//
// Hash-first loop/hold closure check (02-RESEARCH.md Pattern 3). Uses
// random-access window.__viz.renderFrame(i) via the shared session page —
// renderFrame is pure/idempotent, so this never steps through all frames.
//
//   resolve: "loop" — renderFrame(0) vs renderFrame(totalFrames) must be
//   bit-identical (SHA-256). A correctly-built piece IS byte-identical
//   (Phase 1's determinism.test.mjs/loop-continuity.test.mjs already prove
//   this) — pixelmatch only runs when hashes differ, to produce a named,
//   quantified failure reason (02-RESEARCH.md Pitfall 2: pixelmatch's
//   `threshold` is per-pixel color sensitivity, NOT a percentage — the
//   percentage is diffPixels/totalPixels, computed separately).
//
//   resolve: "hold" — the last HOLD_WINDOW frames must be pairwise
//   byte-identical (a legitimate hold is motionless, hence exact).
//
// Reads window.__viz.kind/totalFrames directly off ctx.page rather than
// requiring a separate 'viz' ctx key — 'page' already gives us everything
// needed to read the live runtime contract.

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const name = 'loop-continuity';
export const needs = ['page', 'meta'];

// Starting cutoff (02-RESEARCH.md Pattern 3), confirmed against
// bad-broken-loop's measured 1.31% pixelmatch diff at frame 48 vs 0
// (02-01-SUMMARY.md) — wide margin above this cutoff on both sides: a
// correctly-built loop is exactly 0% (hash match, this line never runs),
// and the deliberately-broken fixture lands >13x over it.
const LOOP_DIFF_MAX_PCT = 0.001;
const HOLD_WINDOW = 5;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function renderFrameShot(page, i) {
  await page.evaluate((frame) => window.__viz.renderFrame(frame), i);
  return page.screenshot();
}

function diffPngPath(page) {
  const url = page.url();
  if (!url.startsWith('file://')) return null;
  return fileURLToPath(url).replace(/\.html$/i, '.loopdiff.png');
}

export async function run(ctx) {
  const { page, meta } = ctx;

  const live = await page.evaluate(() => ({
    kind: window.__viz.kind,
    totalFrames: window.__viz.totalFrames,
  }));

  if (live.kind !== 'animated') {
    return { name, severity: 'PASS', evidence: 'static piece — loop-continuity not applicable' };
  }

  const totalFrames = live.totalFrames;
  const resolve = meta?.resolve;

  if (resolve === 'loop') {
    const shotA = await renderFrameShot(page, 0);
    const shotB = await renderFrameShot(page, totalFrames);
    const hashA = sha256(shotA);
    const hashB = sha256(shotB);

    if (hashA === hashB) {
      return { name, severity: 'PASS', evidence: 'bit-identical (SHA-256 match)' };
    }

    const imgA = PNG.sync.read(shotA);
    const imgB = PNG.sync.read(shotB);
    const { width, height } = imgA;
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold: 0.1 });
    const totalPixels = width * height;
    const diffPct = diffPixels / totalPixels;

    const diffPath = diffPngPath(page);
    if (diffPath) {
      await writeFile(diffPath, PNG.sync.write(diff));
    }

    const evidence = `${(diffPct * 100).toFixed(2)}% of pixels differ (${diffPixels}/${totalPixels})${
      diffPath ? `, diff written to ${diffPath}` : ''
    }`;

    if (diffPct > LOOP_DIFF_MAX_PCT) {
      return { name, severity: 'VIOLATION', evidence };
    }
    return { name, severity: 'PASS', evidence: `near-identical (${evidence})` };
  }

  if (resolve === 'hold') {
    const startFrame = totalFrames - HOLD_WINDOW;
    const hashes = [];
    for (let i = startFrame; i < totalFrames; i++) {
      hashes.push(sha256(await renderFrameShot(page, i)));
    }

    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] !== hashes[0]) {
        return {
          name,
          severity: 'VIOLATION',
          evidence: `hold frames ${startFrame} and ${startFrame + i} differ (expected byte-identical hold across the last ${HOLD_WINDOW} frames)`,
        };
      }
    }
    return {
      name,
      severity: 'PASS',
      evidence: `last ${HOLD_WINDOW} frames (${startFrame}-${totalFrames - 1}) bit-identical (SHA-256 match)`,
    };
  }

  return { name, severity: 'VIOLATION', evidence: 'animated piece must declare resolve: loop|hold' };
}
