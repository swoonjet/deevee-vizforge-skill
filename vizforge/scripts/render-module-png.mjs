#!/usr/bin/env node
// scripts/render-module-png.mjs
//
// Rasterizes a portable module to a PNG — the export for destinations that
// cannot host live HTML at all.
//
// WHY THIS EXISTS. Keynote and Google Slides accept an image and nothing else:
// no iframe, no script, no snippet. Until now the Studio's honest answer to
// "can I put this in my deck?" was "only if your deck is HTML", which covers
// neither of the two decks people actually build in. This closes that.
//
// WHY IT IS NOT scripts/capture.mjs. captureStatic() drives the 40 STATIC
// scaffolds and depends on their contract: it awaits `window.__viz.ready`, and
// it asserts that a piece fires no non-file:// request at all. A module has no
// __viz — it mounts synchronously from an inline script — and the render page
// legitimately loads base64 data: fonts. Same discipline (self-containment
// asserted, double-rAF settle before the shot), different readiness contract.
//
// TYPE FIDELITY IS THE WHOLE REASON THE FONT PACK EXISTS. A snippet may
// degrade through the host's font stack; a raster cannot degrade at all,
// because whatever Chromium resolves at render time is baked into the pixels.
// So the render page inlines the fritz pack (Instrument Sans / Inter / Geist
// Mono, subsetted, in-repo) and then VERIFIES each family resolved with
// document.fonts.check(). A silent fallback to system-ui would be a brand
// failure that nothing downstream could detect, so the result reports which
// families were real — the caller surfaces it rather than assuming.
//
// SIZES ARE NAMED FOR DESTINATIONS, not for pixel counts, because "1200x675"
// tells a user nothing about whether it will fit their slide. The CSS width is
// what sets type scale (the modules size themselves in cqw against their
// container), so a size's CSS box is chosen for how the piece should READ and
// deviceScaleFactor 2 then makes it crisp. Changing dsf alone never changes the
// composition, only the resolution.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildIframePage } from './build-embed.mjs';

/**
 * CSS box + scale per named size. `label` and `note` are the user-facing
 * strings — kept here so the route, the UI and the CLI cannot describe the
 * same size three different ways.
 */
export const PNG_SIZES = {
  'slide-16x9': {
    width: 1200,
    height: 675,
    deviceScaleFactor: 2,
    label: 'Slide, 16:9',
    note: 'Fills a widescreen Keynote or Google Slides page.',
  },
  'half-slide-4x3': {
    width: 900,
    height: 675,
    deviceScaleFactor: 2,
    label: 'Half slide, 4:3',
    note: 'Sits beside a column of text.',
  },
  square: {
    width: 1080,
    height: 1080,
    deviceScaleFactor: 2,
    label: 'Square',
    note: 'For a social post or a document inset.',
  },
};

export const DEFAULT_PNG_SIZE = 'slide-16x9';

// The three families the fritz theme maps --vf-font-* to. Checked, not assumed.
const EXPECTED_FAMILIES = [
  { role: 'headline', spec: '700 24px "Instrument Sans"', family: 'Instrument Sans' },
  { role: 'label', spec: '400 16px "Inter"', family: 'Inter' },
  { role: 'figures', spec: '400 12px "Geist Mono"', family: 'Geist Mono' },
];

export function resolveSize(name, overrides = {}) {
  const key = name || DEFAULT_PNG_SIZE;
  const preset = PNG_SIZES[key];
  if (!preset) {
    throw new Error(`render-module-png: unknown size "${key}" (known: ${Object.keys(PNG_SIZES).join(', ')})`);
  }
  return {
    size: key,
    width: overrides.width ?? preset.width,
    height: overrides.height ?? preset.height,
    deviceScaleFactor: overrides.deviceScaleFactor ?? preset.deviceScaleFactor,
  };
}

/**
 * The exact page that gets rasterized — an iframe export plus the two things
 * only a raster needs.
 *
 * Exported so a test can assert on the bytes that go INTO Chromium rather than
 * inferring them from the pixels that come out (a PNG carries no readable text,
 * so "did the caption drop its hover instruction?" is unanswerable downstream).
 */
export async function buildRenderPage(slug, payload = {}) {
  return buildIframePage(slug, {
    data: payload.data,
    copy: payload.copy,
    bindings: payload.bindings,
    // `static: true` is how a module learns it is being rasterized. Its one job
    // today is to drop the "Hover to…" clause from the dek — a caption cannot
    // instruct the reader of a PNG to hover (vf-core interactionNote()).
    options: { ...(payload.options || {}), static: true },
    theme: payload.theme || 'fritz-light',
    // The one place a webfont belongs in an artifact — see build-embed's
    // loadFonts() for why this is opt-in and why the raster is the exception.
    fonts: payload.fonts === null ? undefined : payload.fonts || 'fritz',
  });
}

/**
 * renderModulePng(slug, payload, opts) -> { png, width, height, deviceScaleFactor, size, fonts }
 *
 * payload is the module config: { data, copy, options, theme }.
 * opts: { size, width, height, deviceScaleFactor, browser }
 *
 * `png` is a lossless PNG Buffer at width*dsf x height*dsf.
 * `fonts` is { ok, missing: [...] } — the render's own report on type fidelity.
 *
 * ownsBrowser pattern, same as scripts/capture.mjs: with no opts.browser this
 * self-launches and self-closes; with one injected (the app's pooled Chromium)
 * it takes a fresh context and never closes the caller's browser.
 */
export async function renderModulePng(slug, payload = {}, opts = {}) {
  const { size, width, height, deviceScaleFactor } = resolveSize(opts.size, opts);

  const html = await buildRenderPage(slug, payload);

  // A file:// page, not setContent(): the module's whole promise is that the
  // exported file is self-contained, and rendering the actual bytes from disk
  // is what makes the no-external-request assertion below mean something.
  const dir = await mkdtemp(path.join(tmpdir(), 'vf-png-'));
  const htmlPath = path.join(dir, `${slug}.html`);
  await writeFile(htmlPath, html, 'utf8');

  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchOwn());

  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
      // Modules honour prefers-reduced-motion; a still frame should be the
      // rest state, never a transition caught halfway.
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();

      // Self-containment assertion. data: is allowed and file:// is the page
      // itself; anything else means the export would break offline or leak a
      // request from inside someone's deck build.
      const offending = [];
      page.on('request', (request) => {
        const url = request.url();
        if (!url.startsWith('file://') && !url.startsWith('data:')) offending.push(url);
      });

      await page.goto(`file://${htmlPath}`);

      // Readiness, in the order the page actually becomes ready: fonts decoded,
      // then the module's SVG present (mount is synchronous, but the first
      // ResizeObserver-driven draw is not).
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector('#vf-root svg', { state: 'attached', timeout: 10000 });

      const fonts = await page.evaluate((families) => {
        const missing = families
          .filter((f) => !document.fonts.check(f.spec))
          .map((f) => `${f.family} (${f.role})`);
        return { ok: missing.length === 0, missing };
      }, EXPECTED_FAMILIES);

      if (offending.length) {
        throw new Error(
          `the ${slug} export fired ${offending.length} external request(s), so it is not self-contained:\n` +
            offending.map((u) => `  - ${u}`).join('\n')
        );
      }

      // Double-rAF settle before the shot — docs/determinism.md, RENDER-04.
      // Every other screenshot call site in this project carries it.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = await page.screenshot({ type: 'png' }); // no quality param => lossless

      return {
        png,
        size,
        width: width * deviceScaleFactor,
        height: height * deviceScaleFactor,
        cssWidth: width,
        cssHeight: height,
        deviceScaleFactor,
        fonts,
      };
    } finally {
      await context.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function launchOwn() {
  const [{ chromium }, { DETERMINISM_LAUNCH_ARGS }] = await Promise.all([
    import('playwright'),
    import('./lib/browser-launch-args.mjs'),
  ]);
  return chromium.launch({ args: DETERMINISM_LAUNCH_ARGS });
}

// --- CLI -------------------------------------------------------------------
// node scripts/render-module-png.mjs <slug> <payload.json> <out.png> [size]

async function main() {
  const [slug, dataPath, outPath, size = DEFAULT_PNG_SIZE] = process.argv.slice(2);
  if (!slug || !dataPath || !outPath) {
    console.error(
      `Usage: node scripts/render-module-png.mjs <slug> <payload.json> <out.png> [${Object.keys(PNG_SIZES).join('|')}]`
    );
    process.exit(1);
  }
  const { readFile } = await import('node:fs/promises');
  const payload = JSON.parse(await readFile(path.resolve(dataPath), 'utf8'));
  const result = await renderModulePng(slug, payload, { size });
  await writeFile(path.resolve(outPath), result.png);
  console.log(
    `Wrote ${outPath} — ${result.width}x${result.height} (${result.size} @${result.deviceScaleFactor}x)`
  );
  if (!result.fonts.ok) {
    console.warn(`  Type fell back to system faces for: ${result.fonts.missing.join(', ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}
