// scripts/qa/checks/session.mjs
//
// Shared Playwright session for gate check modules (QA-01, Plan 02-02).
// Launches ONE browser + ONE page per session — every check module's
// `run(ctx)` shares it via gate.mjs (Plan 02-04); no check module launches
// its own browser (02-RESEARCH.md Anti-Pattern: "Re-launching Chromium per
// check" — Playwright launch is the dominant cost).
//
// Mirrors scripts/capture.mjs's conventions (capture-flag init script, clock
// install, request log, goto file://, await __viz.ready) without forking
// capture.mjs itself.

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DETERMINISM_LAUNCH_ARGS } from '../../lib/browser-launch-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

async function loadPresets() {
  const raw = await readFile(path.join(repoRoot, 'assets/frame-presets.json'), 'utf8');
  return JSON.parse(raw);
}

async function resolveDimensions(opts = {}) {
  if (opts.width && opts.height) {
    return {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: opts.deviceScaleFactor ?? 2,
    };
  }
  if (!opts.preset) {
    throw new Error('openPiece: must supply either { preset } or { width, height }');
  }
  const presets = await loadPresets();
  const preset = presets[opts.preset];
  if (!preset) {
    throw new Error(`openPiece: unknown preset "${opts.preset}" (known: ${Object.keys(presets).join(', ')})`);
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

/**
 * openPiece(htmlPath, { preset?, width?, height?, deviceScaleFactor? })
 *
 * Launches a Chromium session against one piece, applies the capture.mjs
 * conventions (capture-flag init script, clock install, non-file:// request log, goto
 * file://, await window.__viz.ready), reads the live `window.__viz`
 * contract, and returns a handle every gate check module's `run(ctx)` can
 * share:
 *
 *   { page, browser, requests, consoleErrors, viz, width, height,
 *     deviceScaleFactor, screenshotBuffer(), renderFrameShot(i), close() }
 *
 * - `requests`: non-file:// URLs observed during load (self-contained.check.mjs).
 * - `consoleErrors`: page.on('console') messages of type 'error', captured
 *   from before goto (negative-geometry.check.mjs's console-error class).
 * - `viz`: { kind, fps, totalFrames, encoding, resolve } read live via
 *   page.evaluate (`resolve` is undefined for static/unmigrated pieces).
 * - `screenshotBuffer()`: PNG Buffer of the CURRENT rendered state.
 * - `renderFrameShot(i)`: page.evaluate(() => window.__viz.renderFrame(i))
 *   then a screenshot Buffer — renderFrame is pure/idempotent, so random
 *   access to any frame index is legal (never step through all frames).
 */
export async function openPiece(htmlPath, opts = {}) {
  const { width, height, deviceScaleFactor } = await resolveDimensions(opts);

  // ownsBrowser pattern (09-RESEARCH.md, Phase 9 Plan 02 — mirrors
  // capture.mjs's identical extension): with no opts.browser this
  // self-launches exactly as before (DETERMINISM_LAUNCH_ARGS,
  // docs/determinism.md, RENDER-04 — the code path runDeterminismCheck's
  // CLI flake site actually runs); with an injected opts.browser (the
  // pooled render service) this uses a fresh CONTEXT on the shared browser
  // and close() below never closes the injected browser.
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch({ args: DETERMINISM_LAUNCH_ARGS }));
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
  // LIVE-04: sets the capture flag BEFORE any page script runs, on every
  // subsequent navigation in this context — a Playwright context init
  // script is the only mechanism that beats a piece's own synchronous
  // inline bootstrap. This is
  // the REAL isolation boundary against assets/snippets/player.js's
  // attachPlayer starting a real rAF loop during a gate session — the clock
  // freeze below is NOT a backstop for this (Phase 14 Plan 01 spike,
  // docs/determinism.md: install({time:0}) does not freeze
  // Date/performance.now/rAF going forward, only their starting value).
  await context.addInitScript(() => {
    window.__VIZFORGE_CAPTURE__ = true;
  });
  const page = await context.newPage();

  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('file://')) requests.push(url);
  });

  // consoleErrors (13-02, FIX-02): mirrors the requests capture above —
  // attached BEFORE goto so load-time console errors (e.g. Chromium's
  // negative SVG attribute parse errors) are captured. Consumed by
  // negative-geometry.check.mjs.
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Resets the STARTING virtual Date/performance.now value only — does NOT
  // freeze them going forward (Phase 14 Plan 01 spike, docs/determinism.md)
  // — mirrors capture.mjs's identical corrected comment.
  await page.clock.install({ time: 0 });

  await page.goto(toFileUrl(htmlPath));
  await page.evaluate(() => window.__viz.ready);

  const viz = await page.evaluate(() => {
    const v = window.__viz;
    // resolve (Phase 14, LIVE-01/02): undefined for static pieces and
    // not-yet-migrated animated pieces — surfaced as-is (never defaulted
    // here) so gate checks see the LIVE runtime value exactly.
    // `geo` and `density` carry only the DISCLOSURE SENTENCES a piece actually
    // rendered. The structural facts (projection, classification, bandwidth)
    // stay in the sidecar because they are properties of the FORM and do not
    // vary with the data; the sentences do vary, because they are
    // caller-overridable, and a sidecar cloned from the demo cannot speak for
    // this render. Same repair as encoding.disclosure — see
    // baseline-honesty.check.mjs (c).
    return {
      kind: v.kind,
      fps: v.fps,
      totalFrames: v.totalFrames,
      encoding: v.encoding,
      resolve: v.resolve,
      geo: v.geo,
      density: v.density,
    };
  });

  // THE RENDERED TEXT, which is what six checks have always claimed to read.
  //
  // baseline-honesty, geo-honesty, density-bandwidth, radial-baseline,
  // area-encoding and network-position all do `ctx.bodyText ?? ctx.html` and all
  // say "found verbatim in the rendered piece". Nothing ever set `bodyText`, so
  // every one of them fell through to the raw assembled HTML — and a scaffold's
  // HTML contains every string literal in its script, INCLUDING the untaken side
  // of each `copy.x || '<default>'`. So a disclosure was verified as being
  // present IN THE FILE, not as having been shown to anyone.
  //
  // innerText rather than textContent: it is the text as LAID OUT, so a sentence
  // hidden by `display:none` does not count as disclosed, which is exactly the
  // distinction these checks exist to make.
  const bodyText = await page.evaluate(() => document.body.innerText);

  // Double-requestAnimationFrame settle round-trip (docs/determinism.md,
  // RENDER-04 fallback): DETERMINISM_LAUNCH_ARGS alone did not fully
  // eliminate the compositor-timing race under deliberate concurrency —
  // this explicit two-rAF wait, immediately before every screenshot, gives
  // the compositor a confirmed opportunity to finish committing the just-
  // rendered frame before page.screenshot() reads it.
  async function settleBeforeScreenshot() {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  async function screenshotBuffer() {
    await settleBeforeScreenshot();
    return page.screenshot();
  }

  async function renderFrameShot(i) {
    await page.evaluate((frame) => window.__viz.renderFrame(frame), i);
    await settleBeforeScreenshot();
    return page.screenshot();
  }

  // Closes the CONTEXT always; the browser itself is only closed when this
  // call OWNED it (self-launched) — an injected pooled browser outlives any
  // one session and is reused by every subsequent caller.
  async function close() {
    await context.close();
    if (ownsBrowser) await browser.close();
  }

  return {
    page,
    browser,
    requests,
    consoleErrors,
    viz,
    bodyText,
    width,
    height,
    deviceScaleFactor,
    screenshotBuffer,
    renderFrameShot,
    close,
  };
}
