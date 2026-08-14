#!/usr/bin/env node
// scripts/build-gallery-thumbs.mjs
//
// THE LIBRARY CARDS NEED THUMBNAILS, NOT THE FULL RENDERS.
//
// Every card on /gallery shows the gallery's own render of that form as its
// preview state, because seeing what a piece DOES is the only honest way to
// browse a library of forms you have never met. Those renders are the 2x
// delivery PNGs from demo/b2b — around 2000x1300 each, 6.31MB across the 32.
// The card paints them into a box about 217 CSS px wide.
//
// That is ~90x more pixels than the box can show, and on localhost the cost is
// NOT bandwidth: it is decode. 32 images at ~2.6M pixels is ~83M pixels to
// rasterize before the grid is populated, all of it on the main thread, so the
// cards arrive in a visible trickle and several sit blank while you scroll past
// them. Reading it as "lazy loading, working as intended" is how it survived —
// the files are all present and every request is a 200.
//
// So: one downscale per slug, ahead of time. WIDTH/HEIGHT ARE A COVER TARGET,
// NOT A FIT ONE, and the source aspect ratio is preserved, because the card
// crops with `object-fit:cover; object-position:top left`. A thumbnail smaller
// than the box in either dimension would be upscaled by the browser (blurry);
// one with a different aspect ratio would CROP TO A DIFFERENT PICTURE than the
// full render does, which would make the card lie about the piece.
//
// 640x400 covers the ~217px box at 3x, and the two-column mobile layout
// (grid collapses at 720px, so ~330 CSS px) at 2x.
//
// CLI:
//   node scripts/build-gallery-thumbs.mjs [--force] [--only <slug>]
// Idempotent: a thumbnail newer than its source is left alone unless --force.
// On a missing source or an ffmpeg failure: names the slug, exits 1.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GALLERY, reviewLibrary } from '../assets/modules/gallery-registry.mjs';
import { SAMPLES } from '../app/views/gallery-studio.mjs';
import { profile } from './profile.mjs';
import { renderModulePng } from './render-module-png.mjs';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = path.join(repoRoot, 'demo', 'b2b');
export const THUMBS_DIR = path.join(repoRoot, 'demo', 'b2b', 'thumbs');

// The cover target. Exported so the smoke test asserts against these numbers
// rather than a second copy of them.
export const THUMB_COVER = { width: 640, height: 400 };

const KB = (bytes) => Math.round(bytes / 1024);

async function mtimeOrNull(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Downscale one source PNG so it COVERS THUMB_COVER with its aspect ratio
 * intact. force_original_aspect_ratio=increase is the whole trick: it scales so
 * both dimensions are >= the target, letting the card's own cover-crop frame
 * the picture exactly as it frames the full render.
 */
async function renderThumb(src, out) {
  const { width, height } = THUMB_COVER;
  await execFileAsync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    '-frames:v', '1',
    out,
  ]);
}

/**
 * Renders an entry's preview from its own module, and writes it where the
 * downscaler expects to find a source. Returns false when no shipped sample
 * satisfies the entry's fit rule, which is a real answer: a form nothing can
 * feed has no honest preview to show.
 */
async function renderNativePreview(entry, outPath, log) {
  if (!entry.module) return false;
  for (const [key, sample] of Object.entries(SAMPLES)) {
    const profiled = profile(sample.text, { format: 'csv' });
    const verdict = (reviewLibrary(profiled) || []).find((r) => r.slug === entry.slug);
    if (!verdict || !verdict.fits) continue;
    // THE CARD'S OWN GEOMETRY, not an export preset.
    //
    // First attempt used `slide-16x9` (1200x675 logical) and the five new cards
    // came out visibly smaller than their 32 neighbours, with dead space down
    // one side. Two causes, both about matching the frame this render is FOR:
    //
    //   ASPECT. The card's image box is 16/10, and the shipped gallery renders
    //   are 1.55-1.66, so they cover it with a few pixels cropped. A 16:9 source
    //   is wider than the box, so `object-fit:cover` scales it to the box HEIGHT
    //   and throws away a quarter of the width — which is where the empty side
    //   came from.
    //
    //   LOGICAL WIDTH. The card paints into ~206 CSS px whatever the source, so
    //   the source's logical width sets how big the chart's type and marks end
    //   up. The shipped renders are ~1020-1065 logical; at 1200 everything
    //   inside was drawn ~15% smaller and then scaled by the same amount.
    //
    // So: 1020x638 logical (16/10, matching the thumb's 640x400 target exactly)
    // at 2x. Explicit dimensions rather than a new PNG_SIZES entry, because
    // PNG_SIZES is the list a reader picks an EXPORT from and "the size our own
    // card happens to be" is not a destination anyone is choosing.
    const result = await renderModulePng(entry.module, {
      data: profiled.rows,
      bindings: verdict.bindings,
      copy: { source: `${sample.label} (gallery sample)` },
      // UNDER `options`, not spread at the top level. The SCREEN flattens a
      // verdict's options into config (`Object.assign(config, entry.options)`),
      // so spreading them here looks right and reads right — but renderModulePng
      // takes `payload.options` and does the flattening itself, so a top-level
      // spread was dropped on the floor. Every option a registry fit returns was
      // therefore missing from the card previews: pie drew a PIE where the stage
      // draws a donut, and a stacked bar drew grouped. Both render correctly and
      // neither errors, which is why nothing caught it — the mismatch is only
      // visible by looking at a card beside its own stage.
      options: verdict.options || {},
    }, { size: 'slide-16x9', width: 1020, height: 638, deviceScaleFactor: 2 });
    await writeFile(outPath, result.png);
    log(`  ${entry.slug.padEnd(18)} rendered from its own module on "${key}"`);
    return true;
  }
  return false;
}

export async function buildGalleryThumbs({ force = false, only = null, log = console.log } = {}) {
  const wanted = only ? GALLERY.filter((e) => e.slug === only) : GALLERY;
  if (only && wanted.length === 0) {
    throw new Error(`--only ${only} is not a slug in the gallery registry`);
  }

  await mkdir(THUMBS_DIR, { recursive: true });

  const built = [];
  const skipped = [];
  let srcBytes = 0;
  let outBytes = 0;

  for (const entry of wanted) {
    const src = path.join(SOURCE_DIR, `${entry.slug}.png`);
    const out = path.join(THUMBS_DIR, `${entry.slug}.png`);

    let srcStat = await stat(src).catch(() => null);
    if (!srcStat) {
      // TWO LINEAGES, TWO WAYS TO GET A PREVIEW.
      //
      // Most entries are ports of a bespoke gallery piece, so their full render
      // already exists in demo/b2b and the thumb is a downscale of it. The
      // conventional forms added in 2026-08 have no such ancestor — they were
      // written straight against this harness — so there is nothing to
      // downscale, and demanding one would mean faking a gallery render for a
      // piece that was never in the gallery.
      //
      // For those, the module renders its OWN preview, on the first shipped
      // sample its own fit rule accepts. That is the same picture the card
      // promises: this form, animated, on data that suits it.
      const made = await renderNativePreview(entry, src, log);
      if (!made) {
        throw new Error(`no source render for "${entry.slug}" — expected ${path.relative(repoRoot, src)}, `
          + 'and no shipped sample fits its own fit rule so it cannot render its own');
      }
      srcStat = await stat(src);
    }

    const outMtime = await mtimeOrNull(out);
    if (!force && outMtime !== null && outMtime >= srcStat.mtimeMs) {
      skipped.push(entry.slug);
      srcBytes += srcStat.size;
      outBytes += (await stat(out)).size;
      continue;
    }

    try {
      await renderThumb(src, out);
    } catch (err) {
      const detail = (err.stderr || err.message || '').trim().split('\n').slice(-1)[0];
      throw new Error(`ffmpeg failed on "${entry.slug}": ${detail}`);
    }

    const outStat = await stat(out);
    srcBytes += srcStat.size;
    outBytes += outStat.size;
    built.push({ slug: entry.slug, srcKB: KB(srcStat.size), outKB: KB(outStat.size) });
  }

  // A thumbnail whose slug has left the registry would keep being served and
  // never be rebuilt, so say so rather than letting it rot silently.
  const known = new Set(GALLERY.map((e) => e.slug));
  const stale = (await readdir(THUMBS_DIR))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .filter((slug) => !known.has(slug));

  log(`thumbs: ${built.length} built, ${skipped.length} already current · ` +
      `${(srcBytes / 1048576).toFixed(2)}MB of renders → ${(outBytes / 1048576).toFixed(2)}MB of thumbnails`);
  for (const b of built) log(`  ${b.slug.padEnd(18)} ${String(b.srcKB).padStart(4)}KB → ${String(b.outKB).padStart(3)}KB`);
  if (stale.length) log(`  stale (no longer in the registry): ${stale.join(', ')}`);

  return { built, skipped, stale, srcBytes, outBytes };
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const force = process.argv.includes('--force');
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt !== -1 ? process.argv[onlyAt + 1] : null;
  try {
    await buildGalleryThumbs({ force, only });
  } catch (err) {
    console.error(`build-gallery-thumbs: ${err.message}`);
    process.exit(1);
  }
}
