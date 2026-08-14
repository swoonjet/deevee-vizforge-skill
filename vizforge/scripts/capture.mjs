#!/usr/bin/env node
// scripts/capture.mjs — Playwright capture: static 2x screenshot + renderFrame(i)
// frame-stepped sequences. See docs/pipeline.md for the full contract this drives
// against (window.__viz) and the determinism/loop/resolve rules it enforces.
//
// Explicit renderFrame(i) stepping via page.evaluate is the ONLY animation driver
// (01-RESEARCH.md Pattern 1). page.clock.install({ time: 0 }) resets the STARTING
// virtual Date/performance.now value for any stray reads — it does NOT freeze them
// going forward (Phase 14 Plan 01 spike, docs/determinism.md: install({time:0})
// alone, with no pauseAt()/fastForward() call, lets Date/performance.now/rAF all
// continue ticking in real wall-clock time). renderFrame(i) itself is still the
// only thing that ever touches the canvas/DOM during capture — see LIVE-04's
// __VIZFORGE_CAPTURE__ init-script flag below, the actual isolation mechanism
// against a page-owned elapsed-time player loop (docs/determinism.md).

import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DETERMINISM_LAUNCH_ARGS } from './lib/browser-launch-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function loadPresets() {
  const raw = await readFile(path.join(repoRoot, 'assets/frame-presets.json'), 'utf8');
  return JSON.parse(raw);
}

async function resolveDimensions(opts) {
  if (opts.width && opts.height) {
    return {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: opts.deviceScaleFactor ?? 2,
    };
  }
  if (!opts.preset) {
    throw new Error('resolveDimensions: must supply either { preset } or { width, height }');
  }
  const presets = await loadPresets();
  const preset = presets[opts.preset];
  if (!preset) {
    throw new Error(`resolveDimensions: unknown preset "${opts.preset}" (known: ${Object.keys(presets).join(', ')})`);
  }
  return {
    width: opts.width ?? preset.width,
    height: opts.height ?? preset.height,
    deviceScaleFactor: opts.deviceScaleFactor ?? preset.deviceScaleFactor,
  };
}

function toFileUrl(htmlPath) {
  const abs = path.isAbsolute(htmlPath) ? htmlPath : path.resolve(process.cwd(), htmlPath);
  return `file://${abs}`;
}

// Double-requestAnimationFrame settle round-trip (docs/determinism.md,
// RENDER-04 fallback): DETERMINISM_LAUNCH_ARGS alone did not fully
// eliminate the compositor-timing race under deliberate concurrency — this
// explicit two-rAF wait, immediately before every screenshot, gives the
// compositor a confirmed opportunity to finish committing the just-rendered
// frame before page.screenshot() reads it. Mirrors scripts/qa/checks/session.mjs's
// identical settle.
async function settleBeforeScreenshot(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * captureStatic(htmlPath, outPng, { preset, width, height, deviceScaleFactor })
 *
 * Launches Chromium with DETERMINISM_LAUNCH_ARGS (scripts/lib/browser-launch-args.mjs —
 * see docs/determinism.md). The SwiftShader software rasterization backend was already
 * bit-for-bit deterministic; these flags close a SEPARATE async compositor-scheduling
 * race that page.screenshot() can otherwise lose under host contention. Navigates to
 * htmlPath, asserts zero non-file:// network requests
 * fired (PIPE-01), awaits window.__viz.ready (font + first-paint gate), and takes a
 * lossless PNG screenshot at the resolved viewport/deviceScaleFactor (CRAFT-04/PIPE-02).
 *
 * Throws — listing offending URLs — if any network request fired.
 */
export async function captureStatic(htmlPath, outPng, opts = {}) {
  const { width, height, deviceScaleFactor } = await resolveDimensions(opts);

  // ownsBrowser pattern (09-RESEARCH.md, Phase 9 Plan 02): with no
  // opts.browser this self-launches and self-closes exactly as before
  // (the v1.0 CLI path, UNCHANGED); with an injected opts.browser (the
  // pooled render service) it uses a fresh CONTEXT on the shared browser
  // and NEVER closes the injected browser.
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch({ args: DETERMINISM_LAUNCH_ARGS }));
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
    // LIVE-04: sets the capture flag BEFORE any page script runs, on every
    // subsequent navigation in this context — a Playwright context init
    // script is the only mechanism that beats a piece's own synchronous
    // inline bootstrap (Phase 14 Plan 01; docs/determinism.md — the
    // frozen-clock spike proved this flag, not the clock, is the real
    // isolation boundary against assets/snippets/player.js's attachPlayer
    // starting a real rAF loop).
    await context.addInitScript(() => {
      window.__VIZFORGE_CAPTURE__ = true;
    });
    try {
      const page = await context.newPage();

      const offendingUrls = [];
      page.on('request', (request) => {
        const url = request.url();
        if (!url.startsWith('file://')) {
          offendingUrls.push(url);
        }
      });

      await page.goto(toFileUrl(htmlPath));
      await page.evaluate(() => window.__viz.ready);

      if (offendingUrls.length > 0) {
        throw new Error(
          `${htmlPath} fired ${offendingUrls.length} non-file:// network request(s), not self-contained (PIPE-01):\n` +
            offendingUrls.map((u) => `  - ${u}`).join('\n')
        );
      }

      await mkdir(path.dirname(path.resolve(outPng)), { recursive: true });
      // Double-rAF settle (docs/determinism.md, RENDER-04) — captureFrames
      // and session.mjs already carried this before every screenshot;
      // captureStatic was missing it (a pre-existing gap found while
      // wiring Phase 14 Plan 01's capture-flag test). Applied here for
      // consistency with every other screenshot call site in the project.
      await settleBeforeScreenshot(page);
      await page.screenshot({ path: outPng }); // no `quality` param => lossless PNG

      if (offendingUrls.length > 0) {
        throw new Error(
          `${htmlPath} fired ${offendingUrls.length} non-file:// network request(s) after screenshot, not self-contained (PIPE-01):\n` +
            offendingUrls.map((u) => `  - ${u}`).join('\n')
        );
      }

      return { outPng, width, height, deviceScaleFactor };
    } finally {
      await context.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

/**
 * captureFrames(htmlPath, framesDir, { preset, width, height, deviceScaleFactor, extraFrames })
 *
 * Same self-containment + readiness gating as captureStatic, plus explicit
 * renderFrame(i) stepping from 0..totalFrames-1, screenshotting each frame to
 * frames/frame_NNNNN.png. extraFrames (e.g. [totalFrames]) are captured to
 * extra_<i>.png for loop-closure checks (PIPE-04).
 *
 * Returns { totalFrames, framesDir }.
 */
export async function captureFrames(htmlPath, framesDir, opts = {}) {
  const { width, height, deviceScaleFactor } = await resolveDimensions(opts);
  const extraFrames = opts.extraFrames ?? [];

  // ownsBrowser pattern — see captureStatic's identical comment above.
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch({ args: DETERMINISM_LAUNCH_ARGS }));
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
    // LIVE-04 — see captureStatic's identical comment above: this is the
    // real isolation mechanism, not the clock install below.
    await context.addInitScript(() => {
      window.__VIZFORGE_CAPTURE__ = true;
    });
    try {
      const page = await context.newPage();

      const offendingUrls = [];
      page.on('request', (request) => {
        const url = request.url();
        if (!url.startsWith('file://')) {
          offendingUrls.push(url);
        }
      });

      // Resets the STARTING virtual Date/performance.now value only — does
      // NOT freeze them going forward (Phase 14 Plan 01 spike,
      // docs/determinism.md). renderFrame(i) below is still the only thing
      // that ever touches the canvas/DOM during capture; the init-script
      // flag above is what actually keeps a page-owned player loop from
      // ever starting in the first place.
      await page.clock.install({ time: 0 });

      await page.goto(toFileUrl(htmlPath));
      await page.evaluate(() => window.__viz.ready);

      if (offendingUrls.length > 0) {
        throw new Error(
          `${htmlPath} fired ${offendingUrls.length} non-file:// network request(s), not self-contained (PIPE-01):\n` +
            offendingUrls.map((u) => `  - ${u}`).join('\n')
        );
      }

      const { totalFrames } = await page.evaluate(() => ({
        totalFrames: window.__viz.totalFrames,
      }));

      await mkdir(framesDir, { recursive: true });

      for (let i = 0; i < totalFrames; i++) {
        await page.evaluate((frame) => window.__viz.renderFrame(frame), i);
        await settleBeforeScreenshot(page);
        await page.screenshot({ path: path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`) });
      }

      for (const extra of extraFrames) {
        await page.evaluate((frame) => window.__viz.renderFrame(frame), extra);
        await settleBeforeScreenshot(page);
        await page.screenshot({ path: path.join(framesDir, `extra_${extra}.png`) });
      }

      if (offendingUrls.length > 0) {
        throw new Error(
          `${htmlPath} fired ${offendingUrls.length} non-file:// network request(s) during capture, not self-contained (PIPE-01):\n` +
            offendingUrls.map((u) => `  - ${u}`).join('\n')
        );
      }

      return { totalFrames, framesDir };
    } finally {
      await context.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

// --- CLI ---
// node scripts/capture.mjs static <html> <outPng> --preset editorial [--width N --height N --dsf N]
// node scripts/capture.mjs frames <html> <framesDir> --preset video [--width N --height N --dsf N] [--extra N]

function parseArgs(argv) {
  const positional = [];
  const flags = { extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--preset') flags.preset = argv[++i];
    else if (arg === '--width') flags.width = Number(argv[++i]);
    else if (arg === '--height') flags.height = Number(argv[++i]);
    else if (arg === '--dsf') flags.deviceScaleFactor = Number(argv[++i]);
    else if (arg === '--extra') flags.extra.push(Number(argv[++i]));
    else positional.push(arg);
  }
  return { positional, flags };
}

async function main() {
  const argv = process.argv.slice(2);
  const [mode, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  if (mode === 'static') {
    const [htmlPath, outPng] = positional;
    if (!htmlPath || !outPng) {
      console.error('Usage: node scripts/capture.mjs static <html> <outPng> --preset <name> [--width N --height N --dsf N]');
      process.exitCode = 1;
      return;
    }
    const result = await captureStatic(htmlPath, outPng, {
      preset: flags.preset,
      width: flags.width,
      height: flags.height,
      deviceScaleFactor: flags.deviceScaleFactor,
    });
    console.log(`Wrote ${result.outPng} (${result.width}x${result.height} @${result.deviceScaleFactor}x)`);
  } else if (mode === 'frames') {
    const [htmlPath, framesDir] = positional;
    if (!htmlPath || !framesDir) {
      console.error('Usage: node scripts/capture.mjs frames <html> <framesDir> --preset <name> [--width N --height N --dsf N] [--extra N]');
      process.exitCode = 1;
      return;
    }
    const result = await captureFrames(htmlPath, framesDir, {
      preset: flags.preset,
      width: flags.width,
      height: flags.height,
      deviceScaleFactor: flags.deviceScaleFactor,
      extraFrames: flags.extra,
    });
    console.log(`Wrote ${result.totalFrames} frames to ${result.framesDir}`);
  } else {
    console.error('Usage: node scripts/capture.mjs <static|frames> ...');
    process.exitCode = 1;
  }
}

// Only run the CLI when this file is executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
