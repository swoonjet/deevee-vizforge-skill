#!/usr/bin/env node
// scripts/deevee.mjs — the one entry point.
//
//   node scripts/deevee.mjs gallery [--out F] [--open]
//   node scripts/deevee.mjs forms   [--tier T] [--json]
//   node scripts/deevee.mjs fit     <data-file | --sample ID> [--json] [--all]
//   node scripts/deevee.mjs make    <data-file | --sample ID> [--form SLUG]
//                                   [--out F] [--size KEY|all] [--theme light|dark|none]
//                                   [--headline S] [--dek S] [--source S] [--snippet]
//   node scripts/deevee.mjs png     <data-file | --sample ID> [--form SLUG] [--out F] [--size KEY|all]
//   node scripts/deevee.mjs samples
//   node scripts/deevee.mjs doctor
//
// Everything runs on plain Node with no install. `png` is the one exception —
// it rasterizes in a real browser, so it needs Playwright; `doctor` says so
// plainly rather than letting the command fail at the moment it is needed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { profile } from './profile.mjs';
import { buildIframePage, buildSnippet } from './build-embed.mjs';
import { SIZES, DEFAULT_SIZE, TIGHT_WIDTH, resolveSize, sizedShell } from './sizes.mjs';
import { loadSamples, loadSample } from './samples.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const registry = () => import(path.join(ROOT, 'assets/modules/gallery-registry.mjs'));

// --- argument parsing ------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const next = argv[i + 1];
      if (inline !== undefined) flags[k] = inline;
      else if (next === undefined || next.startsWith('--')) flags[k] = true;
      else { flags[k] = next; i += 1; }
    } else positional.push(a);
  }
  return { flags, positional };
}

/** A data file path, or `--sample <id>`, resolved to text + a format + a label. */
async function resolveInput(positional, flags) {
  if (flags.sample) {
    const s = await loadSample(String(flags.sample));
    return { text: s.text, format: s.format, label: s.label, source: s.source };
  }
  const file = positional[0];
  if (!file) {
    throw new Error('needs a data file (.csv, .tsv or .json) or --sample <id>. `deevee samples` lists the bundled ones.');
  }
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  const format = flags.format ? String(flags.format)
    : ext === '.json' ? 'json' : ext === '.tsv' ? 'tsv' : 'csv';
  return { text: await readFile(abs, 'utf8'), format, label: path.basename(abs), source: null };
}

// --- commands --------------------------------------------------------------

async function cmdForms(flags) {
  const { GALLERY, TIERS } = await registry();
  const wanted = flags.tier ? String(flags.tier).toLowerCase() : null;
  const list = GALLERY.filter((g) => !wanted || g.tier.toLowerCase() === wanted);
  if (flags.json) { console.log(JSON.stringify(list.map(({ fit, ...r }) => r), null, 2)); return; }
  if (!list.length) {
    console.error(`no tier "${flags.tier}" — known: ${TIERS.join(', ')}`);
    process.exit(1);
  }
  for (const tier of TIERS) {
    const rows = list.filter((g) => g.tier === tier);
    if (!rows.length) continue;
    console.log(`\n${tier} (${rows.length})`);
    for (const g of rows) {
      console.log(`  ${g.slug.padEnd(16)} ${g.title.padEnd(26)} ${g.answers}`);
    }
  }
  console.log(`\n${list.length} forms. \`deevee gallery\` draws every one of them, live.`);
}

async function cmdFit(positional, flags) {
  const { reviewLibrary } = await registry();
  const input = await resolveInput(positional, flags);
  const p = profile(input.text, { format: input.format });
  const verdicts = reviewLibrary(p);
  const fits = verdicts.filter((v) => v.fits);

  if (flags.json) {
    console.log(JSON.stringify({ profile: summarize(p), verdicts }, null, 2));
    return;
  }

  const s = summarize(p);
  console.log(`${input.label}: ${s.rowCount} rows, ${s.fields.length} fields`);
  for (const f of s.fields) console.log(`  ${f.name.padEnd(22)} ${f.type}${f.cardinality != null ? `  (${f.cardinality} distinct)` : ''}`);
  console.log(`\nFits (${fits.length} of ${verdicts.length}):`);
  for (const v of fits) console.log(`  ${v.slug.padEnd(16)} ${String(v.confidence).padEnd(9)} ${v.why}`);

  const refusals = verdicts.filter((v) => !v.fits);
  const show = flags.all ? refusals : refusals.slice(0, 5);
  console.log(`\nRefused (${refusals.length})${flags.all ? '' : ' — first 5, --all for every one'}:`);
  for (const v of show) console.log(`  ${v.slug.padEnd(16)} ${v.why}`);
  if (fits.length) console.log(`\nBuild the top fit:  deevee make ${positional[0] || `--sample ${flags.sample}`}`);
}

async function cmdMake(positional, flags) {
  const { reviewLibrary, GALLERY } = await registry();
  const input = await resolveInput(positional, flags);
  const p = profile(input.text, { format: input.format });
  const verdicts = reviewLibrary(p);
  const pick = choose(verdicts, GALLERY, flags.form && String(flags.form));

  const entry = GALLERY.find((g) => g.slug === pick.slug);
  const theme = flags.theme === 'none' ? undefined : String(flags.theme || 'light');
  const copy = {
    headline: flags.headline ? String(flags.headline) : entry.title,
    dek: flags.dek ? String(flags.dek) : entry.gallery,
    source: flags.source ? String(flags.source) : (input.source || input.label),
  };

  const build = flags.snippet ? buildSnippet : buildIframePage;
  const html = await build(entry.module, {
    data: p.rows, bindings: pick.bindings, options: pick.options || {},
    copy, title: copy.headline, theme,
  });

  const stem = flags.out ? String(flags.out).replace(/\.html?$/i, '')
    : path.join(process.cwd(), `${pick.slug}`);
  const written = [];

  const base = flags.snippet ? `${stem}.snippet.html` : `${stem}.html`;
  await write(base, html);
  written.push({ file: base, what: flags.snippet ? 'snippet, inherits the host page CSS' : 'responsive embed — iframe or open directly' });

  const sizes = flags.size === 'all' || flags.size === true
    ? Object.keys(SIZES)
    : flags.size ? [String(flags.size)] : [];
  for (const key of sizes) {
    const s = resolveSize(key);
    const file = `${stem}.${key}.html`;
    await write(file, sizedShell(html, { width: s.width, height: s.height, label: s.label, title: copy.headline }));
    written.push({ file, what: `${s.label} — ${s.width}x${s.height}. ${s.note}` });
  }

  console.log(`${pick.slug} — ${entry.title}`);
  console.log(`  fit: ${pick.confidence}. ${pick.why}`);
  console.log(`  honesty: ${entry.honesty}`);
  console.log(`  animation: build "${entry.build}", rest "${entry.rest}"`);
  const others = verdicts.filter((v) => v.fits && v.slug !== pick.slug);
  if (others.length) console.log(`  also fits: ${others.map((v) => v.slug).join(', ')}`);
  console.log('');
  for (const w of written) console.log(`  ${w.file}\n      ${w.what}`);
  console.log(`\n  open "${written[0].file}"`);
  warnTight(sizes, entry);
}

async function cmdPng(positional, flags) {
  const { renderModulePng } = await import('./render-png.mjs');
  const { reviewLibrary, GALLERY } = await registry();
  const input = await resolveInput(positional, flags);
  const p = profile(input.text, { format: input.format });
  const verdicts = reviewLibrary(p);
  const pick = choose(verdicts, GALLERY, flags.form && String(flags.form));
  const entry = GALLERY.find((g) => g.slug === pick.slug);

  const sizes = flags.size === 'all' ? Object.keys(SIZES) : [String(flags.size || DEFAULT_SIZE)];
  const stem = flags.out ? String(flags.out).replace(/\.png$/i, '')
    : path.join(process.cwd(), pick.slug);

  console.log(`${pick.slug} — ${entry.title} (${pick.confidence} fit)`);
  await mkdir(path.dirname(path.resolve(stem)), { recursive: true });
  for (const key of sizes) {
    const file = sizes.length > 1 ? `${stem}.${key}.png` : `${stem}.png`;
    const res = await renderModulePng(entry.module, {
      data: p.rows, bindings: pick.bindings, options: pick.options || {},
      copy: {
        headline: flags.headline ? String(flags.headline) : entry.title,
        dek: flags.dek ? String(flags.dek) : entry.gallery,
        source: flags.source ? String(flags.source) : (input.source || input.label),
      },
    }, { size: key, out: file, theme: flags.theme === 'none' ? undefined : String(flags.theme || 'light') });
    console.log(`  ${file}  ${res.width}x${res.height}`);
  }
  warnTight(sizes, entry);
}

async function cmdSamples() {
  const all = await loadSamples();
  for (const s of all) {
    console.log(`${s.id.padEnd(24)} ${s.label}`);
    console.log(`  ${s.shows}`);
    console.log(`  source: ${s.source}\n`);
  }
  console.log(`${all.length} bundled datasets. Use any with --sample <id>.`);
}

async function cmdGallery(flags) {
  const { buildGallery } = await import('./gallery.mjs');
  const res = await buildGallery({ out: flags.out ? String(flags.out) : undefined });
  if (flags.open) execFile('open', [res.file], () => {});
}

async function cmdDoctor() {
  const { GALLERY } = await registry();
  const rows = [];
  rows.push(['node', process.version, process.version >= 'v18' ? 'ok' : 'needs 18+']);
  rows.push(['forms in the registry', String(GALLERY.length), GALLERY.length > 0 ? 'ok' : 'EMPTY']);

  const samples = await loadSamples().then((s) => s.length).catch((e) => `FAILED: ${e.message}`);
  rows.push(['bundled samples', String(samples), typeof samples === 'number' ? 'ok' : 'broken']);

  for (const f of ['assets/modules/vf-core.js', 'assets/modules/themes/light.css',
    'assets/vendor/d3.min.js', 'assets/vendor/d3-sankey.min.js', 'assets/vendor/papaparse.min.cjs']) {
    rows.push([f, existsSync(path.join(ROOT, f)) ? 'present' : 'MISSING',
      existsSync(path.join(ROOT, f)) ? 'ok' : 'bundle is incomplete']);
  }

  let pw = 'not installed';
  try { await import('playwright'); pw = 'installed'; } catch { /* optional */ }
  rows.push(['playwright (PNG export only)', pw,
    pw === 'installed' ? 'ok' : 'optional — `npm i playwright && npx playwright install chromium` to enable `deevee png`']);

  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [k, v, note] of rows) console.log(`${k.padEnd(w)}  ${String(v).padEnd(12)}  ${note}`);
}

// --- shared ----------------------------------------------------------------

/**
 * Picks a form, or explains why the requested one cannot be used.
 *
 * A refusal here is the tool working. Every entry in the registry carries a
 * fit() that reads the data's actual shape, and its `why` is written as the
 * specific reason — a cardinality cap, a missing time axis, a rate that does
 * not sum to a whole. Quote it rather than softening it, and never force a
 * binding the form declined.
 */
function choose(verdicts, GALLERY, wanted) {
  const fits = verdicts.filter((v) => v.fits);
  if (wanted) {
    const v = verdicts.find((x) => x.slug === wanted);
    if (!v) {
      throw new Error(`no form "${wanted}". \`deevee forms\` lists all ${GALLERY.length}.`);
    }
    if (!v.fits) {
      throw new Error(
        `${wanted} refuses this data: ${v.why}\n`
        + (fits.length
          ? `  It fits: ${fits.map((f) => f.slug).join(', ')}`
          : '  Nothing in the library fits this data as shaped. Try pivoting it (long vs. wide) and run `deevee fit` again.')
      );
    }
    return v;
  }
  if (!fits.length) {
    throw new Error(
      'nothing in the library fits this data as shaped.\n'
      + '  The same table pivoted the other way (long vs. wide) usually unlocks a different set —\n'
      + '  run `deevee fit` on both shapes before concluding there is no chart here.'
    );
  }
  const rank = { strong: 2, possible: 1 };
  return [...fits].sort((a, b) => (rank[b.confidence] || 0) - (rank[a.confidence] || 0))[0];
}

/**
 * A wide form in a narrow box does not get smaller, it gets wrong. Said out
 * loud rather than silently produced, because the render still succeeds — it
 * just crowds, and nothing in the file says so.
 */
function warnTight(sizes, entry) {
  const tight = sizes.filter((k) => SIZES[k] && SIZES[k].width < TIGHT_WIDTH);
  if (!tight.length) return;
  console.log(`\n  Check before you ship: ${tight.join(', ')} ${tight.length > 1 ? 'are' : 'is'} under ${TIGHT_WIDTH}px wide.`);
  console.log(`  "${entry.title}" may need a smaller version rather than the same drawing scaled down —`);
  console.log('  decide what the small one leaves out, and say so in the dek.');
}

function summarize(p) {
  return {
    rowCount: p.rowCount ?? p.rows.length,
    fields: (p.fields || []).map((f) => ({ name: f.name, type: f.type, cardinality: f.cardinality ?? f.distinct })),
  };
}

async function write(file, text) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(path.resolve(file), text, 'utf8');
}

const USAGE = `deevee — a library of ${'{n}'} animated, portable chart forms that picks by measuring your data.

  deevee gallery [--out F] [--open]     every form, live and animated, in one self-contained page
  deevee forms [--tier T] [--json]      list the forms as text
  deevee fit <data> [--all] [--json]    what your data does and does not earn, with reasons
  deevee make <data> [--form SLUG]      build it — responsive HTML, plus any --size you name
  deevee png  <data> [--form SLUG]      rasterize it (needs playwright; see \`deevee doctor\`)
  deevee samples                        the bundled datasets, with provenance
  deevee doctor                         what is installed and what is missing

  <data> is a .csv, .tsv or .json file, or --sample <id>.

  --size  ${Object.keys(SIZES).join(' | ')} | all
  --theme light (default) | dark | none (inherits the host page)

Examples
  deevee gallery --open
  deevee fit sales.csv
  deevee make sales.csv --form conv-bar --size all --headline "Q4 by region"
  deevee make --sample penguins --size square --theme dark
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);
  switch (cmd) {
    case 'gallery': return cmdGallery(flags);
    case 'forms': return cmdForms(flags);
    case 'fit': return cmdFit(positional, flags);
    case 'make': return cmdMake(positional, flags);
    case 'png': return cmdPng(positional, flags);
    case 'samples': return cmdSamples();
    case 'doctor': return cmdDoctor();
    case undefined: case '--help': case '-h': case 'help': {
      const { GALLERY } = await registry();
      console.log(USAGE.replace('{n}', String(GALLERY.length)));
      return;
    }
    default:
      console.error(`unknown command "${cmd}"\n`);
      console.error(USAGE.replace('{n}', '?'));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`deevee: ${err.message}`);
  process.exit(1);
});
