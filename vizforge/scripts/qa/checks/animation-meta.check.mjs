// scripts/qa/checks/animation-meta.check.mjs
//
// Remaining animated-piece assertions, each individually named in evidence:
//   (a) poster exists on disk AND SHA-256-equals renderFrame(totalFrames-1)
//       (pixelmatch % evidence on a dimension-matched mismatch);
//   (b) sanity: meta.fps/totalFrames mirror the live runtime, fps in the
//       house set, duration within [2s, 60s] (CAUTION, not VIOLATION, if
//       outside — a stylistic long/short duration is not a correctness bug);
//       ALSO (Phase 14, LIVE-01/02 — REQUIRED as of Plan 14-04 Task 2, was
//       staged when-present-only in Plans 14-01..03): every animated piece's
//       live.resolve must be SET ('loop'|'hold') and meta.resolve must
//       mirror it exactly. A missing live.resolve on an animated piece is
//       now itself a VIOLATION (the piece hasn't wired attachPlayer/passed
//       resolve to createViz), not silently skipped — this flip landed once
//       all 9 real animated pieces in the repo carried a live resolve value
//       (mirrors the BIND-01/07-14 when-present -> required-for-all staging
//       precedent).
//   (c) easing: meta.easing === "sine-in-out" AND the html contains the
//       sineInOut function name (assets/snippets/easing.js's inlined name).
//
// Reads window.__viz.kind/fps/totalFrames directly off ctx.page — 'page'
// already gives everything needed to read the live runtime contract,
// without a separate 'viz' ctx key.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const name = 'animation-meta';
export const needs = ['page', 'meta', 'html'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

const VALID_FPS = new Set([24, 30, 60]);
const MIN_DURATION_S = 2;
const MAX_DURATION_S = 60;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function renderFrameShot(page, i) {
  await page.evaluate((frame) => window.__viz.renderFrame(frame), i);
  return page.screenshot();
}

export async function run(ctx) {
  const { page, meta, html } = ctx;

  const live = await page.evaluate(() => ({
    kind: window.__viz.kind,
    fps: window.__viz.fps,
    totalFrames: window.__viz.totalFrames,
    resolve: window.__viz.resolve,
  }));

  if (live.kind !== 'animated') {
    return { name, severity: 'PASS', evidence: 'static piece — animation-meta not applicable' };
  }

  const problems = [];
  const cautions = [];

  // (a) poster.
  const posterRel = meta?.outputs?.poster;
  if (!posterRel) {
    problems.push('meta.outputs.poster is missing');
  } else {
    const posterPath = path.join(repoRoot, posterRel);
    let posterBuf = null;
    try {
      posterBuf = await readFile(posterPath);
    } catch {
      problems.push(`poster file not found on disk: ${posterRel}`);
    }

    if (posterBuf) {
      const finalShot = await renderFrameShot(page, live.totalFrames - 1);
      if (sha256(posterBuf) !== sha256(finalShot)) {
        const imgA = PNG.sync.read(posterBuf);
        const imgB = PNG.sync.read(finalShot);
        if (imgA.width === imgB.width && imgA.height === imgB.height) {
          const diff = new PNG({ width: imgA.width, height: imgA.height });
          const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, {
            threshold: 0.1,
          });
          const pct = (diffPixels / (imgA.width * imgA.height)) * 100;
          problems.push(
            `poster differs from renderFrame(${live.totalFrames - 1}) by ${pct.toFixed(2)}% of pixels`
          );
        } else {
          problems.push(
            `poster dimensions ${imgA.width}x${imgA.height} differ from rendered final frame ${imgB.width}x${imgB.height}`
          );
        }
      }
    }
  }

  // (b) sanity.
  if (meta?.fps !== live.fps) {
    problems.push(`meta.fps (${JSON.stringify(meta?.fps)}) !== runtime fps (${live.fps})`);
  }
  if (meta?.totalFrames !== live.totalFrames) {
    problems.push(`meta.totalFrames (${JSON.stringify(meta?.totalFrames)}) !== runtime totalFrames (${live.totalFrames})`);
  }
  if (!VALID_FPS.has(meta?.fps)) {
    problems.push(`fps ${JSON.stringify(meta?.fps)} not one of ${[...VALID_FPS].join('|')}`);
  }

  // resolve mirror (Phase 14, LIVE-01/02) — REQUIRED for every animated
  // piece as of Plan 14-04 Task 2 (was staged when-present-only in Plans
  // 14-01..03; see this file's header comment). A missing live.resolve on
  // an animated piece is now itself a named problem, not silently skipped.
  if (live.resolve === undefined) {
    problems.push('window.__viz.resolve is undefined on this animated piece (attachPlayer/createViz must set resolve: \'loop\'|\'hold\')');
  } else if (meta?.resolve !== live.resolve) {
    problems.push(`meta.resolve (${JSON.stringify(meta?.resolve)}) !== runtime resolve (${JSON.stringify(live.resolve)})`);
  }

  const durationS = live.totalFrames / (live.fps || 1);
  if (durationS < MIN_DURATION_S || durationS > MAX_DURATION_S) {
    cautions.push(`long/short duration: ${durationS.toFixed(1)}s (expected ${MIN_DURATION_S}-${MAX_DURATION_S}s)`);
  }

  // (c) easing.
  if (meta?.easing !== 'sine-in-out' || !/sineInOut/.test(html)) {
    problems.push('sine-easing declaration missing (meta.easing must be "sine-in-out" AND html must contain sineInOut)');
  }

  if (problems.length > 0) {
    return { name, severity: 'VIOLATION', evidence: [...problems, ...cautions].join(' | ') };
  }
  if (cautions.length > 0) {
    return { name, severity: 'CAUTION', evidence: cautions.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `poster hash-matches final frame; fps=${live.fps} totalFrames=${live.totalFrames} duration=${durationS.toFixed(1)}s; sine-easing declared`,
  };
}
