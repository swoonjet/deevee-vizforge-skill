// scripts/render-png.mjs
//
// Rasterizes a form to a PNG — the export for destinations that cannot host
// live HTML at all.
//
// WHY THIS EXISTS. Keynote and Google Slides accept an image and nothing else:
// no iframe, no script, no snippet. The honest answer to "can I put this in my
// deck?" is otherwise "only if your deck is HTML", which covers neither of the
// two decks people actually build in.
//
// WHAT A RASTER GIVES UP. The build animation and every interaction. A PNG is
// the rest state, once — which is why `static: true` goes in below, so a
// module drops any "hover to…" clause from its own caption. A caption that
// tells the reader of an image to hover is a shipped bug, not a style choice.
//
// TYPE FIDELITY IS WHY THE FONT PACK EXISTS. A live embed may degrade through
// the host's stack; a raster cannot degrade at all, because whatever Chromium
// resolves at render time is baked into the pixels forever. So the render page
// inlines the three open-licensed faces the theme names and then VERIFIES each
// one resolved with document.fonts.check(). A silent fallback to system-ui is
// something nothing downstream could detect, so the result REPORTS which
// families were real and the caller surfaces it.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildIframePage } from './build-embed.mjs';
import { resolveSize } from './sizes.mjs';

const EXPECTED_FAMILIES = [
  { role: 'headline', spec: '700 24px "Space Grotesk"', family: 'Space Grotesk' },
  { role: 'label', spec: '400 16px "Inter"', family: 'Inter' },
  { role: 'figures', spec: '400 12px "IBM Plex Mono"', family: 'IBM Plex Mono' },
];

// Chromium's own async compositor scheduling can present a still-settling frame
// to page.screenshot() under host CPU contention. These flags force the full
// commit/raster/activate pipeline per draw and take animation off the
// compositor thread, so the same inputs give the same pixels.
const DETERMINISM_LAUNCH_ARGS = [
  '--run-all-compositor-stages-before-draw',
  '--disable-features=CheckerImaging',
  '--disable-image-animation-resync',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
];

export async function buildRenderPage(slug, payload = {}, { theme = 'light' } = {}) {
  return buildIframePage(slug, {
    data: payload.data,
    copy: payload.copy,
    bindings: payload.bindings,
    // How a module learns it is being rasterized: it drops the interaction
    // clause from its dek (see ifLive() in vf-core.js).
    options: { ...(payload.options || {}), static: true },
    theme,
    fonts: 'house',
  });
}

/**
 * renderModulePng(slug, payload, opts) -> { png, width, height, size, fonts }
 *
 * opts: { size, out, theme, width, height, deviceScaleFactor, browser }
 *
 * With no opts.browser this launches and closes its own Chromium; with one
 * injected it takes a fresh context and never closes the caller's browser.
 */
export async function renderModulePng(slug, payload = {}, opts = {}) {
  const { size, width, height, deviceScaleFactor } = resolveSize(opts.size, opts);
  const html = await buildRenderPage(slug, payload, { theme: opts.theme });

  // A file:// page, not setContent(): the export's whole promise is
  // self-containment, and rendering the actual bytes from disk is what makes
  // the no-external-request assertion below mean anything.
  const dir = await mkdtemp(path.join(tmpdir(), 'deevee-png-'));
  const htmlPath = path.join(dir, `${slug}.html`);
  await writeFile(htmlPath, html, 'utf8');

  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchOwn());

  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
      // A still frame should be the rest state, never a transition caught
      // halfway. Modules honour prefers-reduced-motion.
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();

      const offending = [];
      page.on('request', (r) => {
        const url = r.url();
        if (!url.startsWith('file://') && !url.startsWith('data:')) offending.push(url);
      });

      await page.goto(`file://${htmlPath}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector('#vf-root svg', { state: 'attached', timeout: 15000 });

      const fonts = await page.evaluate((families) => {
        const missing = families.filter((f) => !document.fonts.check(f.spec))
          .map((f) => `${f.family} (${f.role})`);
        return { ok: missing.length === 0, missing };
      }, EXPECTED_FAMILIES);

      if (offending.length) {
        throw new Error(
          `the ${slug} export fired ${offending.length} external request(s), so it is not self-contained:\n`
          + offending.map((u) => `  - ${u}`).join('\n')
        );
      }

      // Double-rAF settle before the shot.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = await page.screenshot({ type: 'png' }); // lossless

      if (opts.out) await writeFile(path.resolve(opts.out), png);
      if (!fonts.ok) {
        console.warn(`  type fell back to system faces for: ${fonts.missing.join(', ')}`);
      }

      return {
        png, size, fonts,
        width: width * deviceScaleFactor,
        height: height * deviceScaleFactor,
        cssWidth: width, cssHeight: height, deviceScaleFactor,
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
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'PNG export needs Playwright, which is not installed.\n'
      + '  npm i playwright && npx playwright install chromium\n'
      + '  Everything else in this skill runs on plain Node — `deevee make` gives you live,\n'
      + '  animated HTML with no install at all, and a browser can print that to PDF or image.'
    );
  }
  return chromium.launch({ args: DETERMINISM_LAUNCH_ARGS });
}
