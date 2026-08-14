// scripts/build-embed.mjs
//
// Builds the PORTABLE EMBED artifacts for a module: a self-contained HTML page
// (iframe-ready) and a copy-paste snippet for an existing page.
//
// WHY TWO ARTIFACTS. They serve destinations with genuinely different limits:
//
//   iframe .html  Notion, Confluence, reveal.js, PowerPoint's Web Viewer
//                 add-in, any CMS that allows an <iframe>. Total CSS
//                 isolation from the host; nothing to install.
//   snippet       An HTML page or dashboard you control. Inherits the host's
//                 CSS custom properties, so a module picks up the surrounding
//                 design system's colours and fonts.
//
//   And NEITHER works in Keynote or Google Slides, which cannot host live HTML
//   at all — those take the PNG from scripts/render-module-png.mjs, which
//   rasterizes the iframe page this file builds. Stated plainly here because
//   the honest answer to "can I put this in my deck?" is "as an image, unless
//   your deck is HTML".
//
// SELF-CONTAINMENT. Everything is inlined: module source, core runtime, data,
// copy. No CDN, no external font, no fetch. Fonts degrade through the house
// stack to system-ui rather than loading a webfont, because an embed cannot
// assume network access and a 400KB font subset is not neighbourly inside
// someone else's page.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MODULES_DIR = path.join(repoRoot, 'assets', 'modules');
const THEMES_DIR = path.join(MODULES_DIR, 'themes');
const FONTS_DIR = path.join(repoRoot, 'assets', 'fonts');

// Inlinable font packs built by scripts/build-fonts.mjs. Allow-listed by name
// so a caller's string never reaches the filesystem.
const FONT_PACKS = {
  house: 'fonts-inline.css',
  fritz: 'fritz-subset-inline.css',
};

/**
 * Loads a theme's tokens for inlining, so the BRAND TRAVELS WITH THE EXPORT.
 *
 * Without this, a snippet exported from the Fritz-branded Studio rendered in
 * the house paper-and-ink palette the moment it landed in someone's page —
 * the theme lived in a separate stylesheet the host would have had to know to
 * apply. A module stays theme-neutral by design; an EXPORT should not be.
 *
 * Returns {css, klass} or null when no theme is requested.
 */
async function loadTheme(name) {
  if (!name) return null;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`build-embed: bad theme name "${name}"`);
  const css = await readFile(path.join(THEMES_DIR, `${name}.css`), 'utf8');
  return { css, klass: `vf-theme-${name}` };
}

/**
 * Loads a base64-inlined @font-face pack, for the ONE case where a webfont
 * belongs in an artifact: a page that is about to be RASTERIZED.
 *
 * Deliberately opt-in and off by default. A snippet or iframe export ships no
 * webfont — 177KB of Inter is not neighbourly inside someone else's page, and
 * the house stack degrades to system-ui acceptably on screen. A PNG has no such
 * escape: whatever face Chromium resolves at render time is baked into the
 * pixels forever, so the render path asks for the real one and the weight never
 * leaves the server.
 */
async function loadFonts(pack) {
  if (!pack) return null;
  const file = FONT_PACKS[pack];
  if (!file) {
    throw new Error(`build-embed: unknown font pack "${pack}" (known: ${Object.keys(FONT_PACKS).join(', ')})`);
  }
  return readFile(path.join(FONTS_DIR, file), 'utf8');
}

/**
 * Inlines a module, the shared runtime it imports, and — for a ported gallery
 * piece — d3, into one self-contained ES-module body.
 *
 * TWO LINEAGES NOW. A hand-rolled module imports only ./vf-core.js and stays
 * dependency-free. A gallery port additionally imports ./d3-piece.js and reads
 * a global `d3`: keeping the gallery's own proven D3 drawing was the only way
 * to get all 32 animated forms without rewriting each from scratch, and the
 * cost is that d3.min.js rides along in the export. It is inlined from
 * node_modules, never a CDN, so the artifact still makes zero network requests.
 */
export async function inlineModule(slug) {
  const core = await readFile(path.join(MODULES_DIR, 'vf-core.js'), 'utf8');
  const mod = await readFile(path.join(MODULES_DIR, `${slug}.js`), 'utf8');

  // The three kinds of sibling a module may reach for. `*-shape.js` is the
  // FAMILY SHAPER — one file that binds the columns for every piece in a family
  // (ts-shape for the time series, hier-shape for the nested forms). Leaving it
  // out of this list made the export path the only place those ports failed:
  // they previewed correctly and then 500'd on Download, which is the worst
  // possible place to find out.
  const isShaper = (s) => /^\.\/[a-z0-9-]+-shape\.js$/.test(s);
  const allowed = (s) => s === './vf-core.js' || s === './d3-piece.js' || isShaper(s);
  const importsOf = (src) => [...src.matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);

  const foreign = importsOf(mod).filter((s) => !allowed(s));
  if (foreign.length) {
    throw new Error(
      `build-embed: ${slug}.js imports ${foreign.join(', ')} — a module may only import `
      + './vf-core.js, ./d3-piece.js or a ./<family>-shape.js so it stays inlinable'
    );
  }

  // AN ALIASED IMPORT IS A NAME THAT EXISTS ONLY IN THE IMPORTING FILE.
  // `import { ticks as niceTicks } from './vf-core.js'` used to be deleted
  // outright, and the flat scope only ever holds `ticks` — so every call to
  // niceTicks threw ReferenceError, AT RUNTIME, on whichever draw path reached it
  // first. The bundle COMPILES, so export-bundles-parse could not see it, and the
  // module previews perfectly because the preview loads real ES modules. Cost:
  // hexbin and contour drew ZERO marks in every raster and every downloaded HTML
  // (their axis ticks run on the first draw), and connected/linked/stream were
  // one code path away from the same. Five modules alias something.
  const aliasDecls = (stmt) => [...stmt.matchAll(/\b(\w+)\s+as\s+(\w+)\b/g)]
    .map(([, from, to]) => `const ${to} = ${from};`)
    .join('\n');

  const strip = (src) => src
    .replace(/^\s*import\s[\s\S]*?from\s+'\.\/[a-z0-9-]+\.js';\s*$/gm, (stmt) => aliasDecls(stmt))
    .replace(/^export\s+default\s/gm, 'const __default__ = ')
    .replace(/^export\s+(const|function|class|let)\s/gm, '$1 ');

  const usesD3 = /from\s+'\.\/d3-piece\.js'/.test(mod);
  const parts = [strip(core)];

  if (usesD3) {
    // d3 first and OUTSIDE the module body: it is a UMD bundle that installs
    // itself on the global, which is exactly what d3-piece reads.
    const d3 = await readFile(path.join(repoRoot, 'node_modules/d3/dist/d3.min.js'), 'utf8');
    parts.unshift(d3);
    // d3-sankey is NOT in the d3 bundle, and a piece that reaches for it in an
    // export would throw on mount having previewed perfectly — the same shape
    // of failure the family shapers had. 6KB, only for the pieces that use it.
    if (/\bd3\.sankey/.test(mod)) {
      const sankey = await readFile(path.join(repoRoot, 'node_modules/d3-sankey/dist/d3-sankey.min.js'), 'utf8');
      parts.splice(1, 0, sankey);
    }
    parts.push(strip(await readFile(path.join(MODULES_DIR, 'd3-piece.js'), 'utf8')));
  }

  // Shapers before the piece — they are plain function declarations and consts,
  // so source order is the whole of the dependency management here.
  for (const dep of importsOf(mod).filter(isShaper)) {
    const name = dep.replace(/^\.\//, '');
    const src = await readFile(path.join(MODULES_DIR, name), 'utf8');
    const nested = importsOf(src).filter((s) => !allowed(s));
    if (nested.length) {
      throw new Error(`build-embed: ${name} imports ${nested.join(', ')} — a shaper may not reach outside the module folder`);
    }
    parts.push(strip(src));
  }

  parts.push(strip(mod));
  // A default-exported piece still has to answer to mount().
  if (usesD3) parts.push('const mount = (el, cfg) => __default__.mount(el, cfg);');
  return parts.join('\n\n');
}

/**
 * The config object an embedded module boots from.
 *
 * `bindings` travels with the data on purpose. A module's shape() takes SOURCE
 * rows plus the column names to read, and its disclosures are computed from what
 * it sees — ranked-bar states "categories aggregate 5000 source rows" only
 * because it did the aggregating. Handing it pre-shaped rows instead made that
 * sentence quietly disappear, and for radar (whose shaped form is grouped, not
 * tabular) it produced no chart at all. So an export carries the real rows and
 * the real bindings, and the module does its own work.
 */
function payload(data, copy, options, bindings) {
  return JSON.stringify({
    data,
    copy: copy || {},
    ...(bindings ? { bindings } : {}),
    ...options,
  });
}

/**
 * A self-contained page. `height:100%` + a flex body so an iframe with a fixed
 * height fills correctly, and a postMessage height report so a host that wants
 * to auto-size can listen for it.
 */
export async function buildIframePage(slug, { data, copy, options = {}, bindings, title, theme, fonts } = {}) {
  const body = await inlineModule(slug);
  const themed = await loadTheme(theme);
  const fontCss = await loadFonts(fonts);
  // An iframe imposes a height, so the module must FILL it rather than derive
  // height from width x aspect — otherwise the plot overflows and the source
  // line collides with the chart. Callers may still override.
  const config = payload(data, copy, { fit: 'height', ...options }, bindings);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || copy?.headline || slug)}</title>
<style>
${fontCss ? fontCss + '\n' : ''}${themed ? themed.css + '\n' : ''}  html, body { margin: 0; padding: 0; height: 100%; background: var(--vf-paper, #f9f7ef); }
  body { display: flex; }
  #vf-root { flex: 1 1 auto; min-width: 0; height: 100%; }
${themed ? '' : `  @media (prefers-color-scheme: dark) {
    :root { --vf-paper: #14141c; --vf-ink: #f4f2ea; --vf-muted: #b9b7ae;
            --vf-hair: rgba(244,242,234,.18); --vf-hair2: rgba(244,242,234,.09);
            --vf-accent: #ff8f6a; }
  }`}
</style>
</head>
<body>
<div id="vf-root"${themed ? ` class="${themed.klass}"` : ''}></div>
<script>
${body}

var __cfg = ${config};
var __api = mount(document.getElementById('vf-root'), __cfg);

// Report height so an embedding host can size the iframe without guessing.
function __report() {
  var h = document.documentElement.scrollHeight;
  try { parent.postMessage({ type: 'vf-embed-height', slug: ${JSON.stringify(slug)}, height: h }, '*'); } catch (e) {}
}
if (typeof ResizeObserver === 'function') new ResizeObserver(__report).observe(document.body);
addEventListener('load', __report);
</script>
</body>
</html>
`;
}

/**
 * A copy-paste snippet: one container plus one inline module script. Uses a
 * unique id so several snippets can coexist on a page.
 */
export async function buildSnippet(slug, { data, copy, options = {}, bindings, domId, theme } = {}) {
  const body = await inlineModule(slug);
  const themed = await loadTheme(theme);
  const config = payload(data, copy, options, bindings);
  const id = domId || `vf-${slug}-${Math.abs(hash(config)).toString(36).slice(0, 6)}`;

  return `<!-- VizForge ${slug} — self-contained, no external requests.
     Retheme by setting CSS custom properties on #${id} or any ancestor:
     --vf-paper --vf-ink --vf-accent --vf-cat-1..6
     --vf-font-headline --vf-font-label --vf-font-figures -->
${themed ? `<style>\n${themed.css}\n</style>\n` : ''}<div id="${id}"${themed ? ` class="${themed.klass}"` : ''}></div>
<script>
(function(){
${body}

mount(document.getElementById(${JSON.stringify(id)}), ${config});
})();
</script>
`;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- CLI -------------------------------------------------------------------

async function main() {
  const [slug, dataPath, outPath, kind = 'iframe'] = process.argv.slice(2);
  if (!slug || !dataPath || !outPath) {
    console.error('Usage: node scripts/build-embed.mjs <slug> <data.json> <out.html> [iframe|snippet]');
    process.exit(1);
  }
  const raw = JSON.parse(await readFile(path.resolve(dataPath), 'utf8'));
  const build = kind === 'snippet' ? buildSnippet : buildIframePage;
  const html = await build(slug, raw);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.resolve(outPath), html, 'utf8');
  console.log(`Wrote ${outPath} (${kind}, ${html.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
