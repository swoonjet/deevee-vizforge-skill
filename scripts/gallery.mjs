// scripts/gallery.mjs
//
// Builds the BROWSABLE GALLERY — one self-contained page showing every form in
// the library, live and animated, each on a dataset its own fit() accepted.
//
//   node scripts/deevee.mjs gallery [--out <file>] [--open]
//
// This is the answer to "show me a gallery to pick from". It is a single HTML
// file with no network requests at all, so it survives being emailed, dropped
// in a Slack DM, or opened from a thumb drive on a machine with no Node.
//
// WHY ONE PAGE AND NOT FORTY. Each embed built by `deevee make` is
// self-sufficient — it carries its own copy of d3 and the runtime, which is
// exactly right for a file that travels alone and exactly wrong for a page with
// forty of them (89KB of runtime x 42 = 3.5MB before a chart is drawn). So the
// gallery emits d3, the runtime, the D3 helper layer and every family shaper
// ONCE, then each module body inside its own IIFE so that forty `mount`
// declarations cannot collide. ~1MB total.
//
// PREVIEWS MOUNT LAZILY. Forty animated D3 charts building at once on load
// pins a CPU and the build animations all finish unseen while the reader is
// still at the top of the page. An IntersectionObserver mounts each card as it
// scrolls into view, so every build animation is actually watched, which is the
// point of an animated gallery.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inlineModule, sharedPrelude, SHAREABLE } from './build-embed.mjs';
import { profile } from './profile.mjs';
import { SIZES } from './sizes.mjs';
import { loadSamples } from './samples.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * Which dataset each form is DEMONSTRATED on. A curatorial decision, written
 * down rather than scored.
 *
 * WHY THIS TABLE EXISTS. A fit() answers "may this form draw this data", which
 * is not the same question as "is this a good example of the form". Left to
 * scoring alone the gallery produced, all technically-fitting: a waterfall of
 * earthquake latitudes, a histogram of month numbers (uniform by construction),
 * a network of 891 passenger names each joined to exactly one other node, and a
 * line chart of major version numbers that came out as a zigzag. Each one was a
 * legal binding and a useless picture.
 *
 * So the eligible set stays machine-decided and the EXAMPLE is chosen by hand,
 * with the reason recorded. Every pin is still checked against the form's own
 * fit() at build time — a pin cannot smuggle in a binding the form refused.
 */
const PINS = {
  'conv-line': ['chase', 'two series over twelve quarters read as lines; a thousand daily points read as a smear'],
  'conv-bump': ['language_ranks', 'a rank per category per year is the shape bump exists for'],
  'conv-connected': ['cloud_share', 'one path through eight years — a connected scatter is unreadable once the paths overlap'],
  'conv-dumbbell': ['budget', 'plan against actual per category is a genuine before/after'],
  'conv-slope': ['penguins', 'one intermediate period, so "first and last" really is the comparison'],
  'conv-multiples': ['seats', 'three products over six months — one small panel each'],
  'conv-waterfall': ['bridge', 'signed steps that must reconcile a start figure to an end figure'],
  'conv-bar': ['acquisitions', 'nineteen named things with one value each'],
  'conv-pie': ['seats', 'three products dividing one total — a pie should never need a key'],
  'conv-gauge': ['accounts', 'four segments, each a share of the same total'],
  'conv-scatter': ['accounts', '420 points over two measures, coloured by segment'],
  'conv-histogram': ['penguins', 'body mass has a real, visibly bimodal distribution'],
  'conv-area': ['seats', 'three products stacked over six months; a thousand daily points fill the band with noise'],
  'unc-sankey': ['funnel', 'a flow that conserves quantity from stage to stage'],
  'unc-stream': ['acquisitions', 'sectors over fourteen years — a stream needs a composition that actually shifts'],
  'unc-nightingale': ['rhythm', 'weekday is genuinely cyclical, which is the whole premise'],
  'unc-calendar': ['daily', 'a full year with a value on every day — a calendar with gaps is mostly blank'],
  'unc-punchcard': ['rhythm', 'weekday crossed with hour is literally what a punchcard is'],
  'unc-marimekko': ['company_hq', 'countries of different widths, split into sectors'],
  'unc-strip': ['releases', 'every release as its own tick on a row per framework'],
  'unc-beeswarm': ['penguins', '344 birds over three species — enough points to need a swarm'],
  'unc-raincloud': ['accounts', 'about 105 values per segment, so the cloud has a real shape'],
  'unc-boxviolin': ['penguins', 'three species with visibly different spreads'],
  'unc-parallel': ['saas_growth_margin', 'three measures per company, few enough threads to follow'],
  'unc-radar': ['capabilities', 'the same five capabilities scored for each vendor'],
  'unc-circlepack': ['company_hq', 'companies nested in countries, sized by an approximate cap'],
  'unc-sunburst': ['budget', 'category then line item — two real levels'],
  'unc-treemap': ['saas_growth_margin', 'companies tiled inside sectors, areas from revenue'],
  'unc-chord': ['funnel', 'bonds between two sets of stages, weighted by flow'],
  'unc-horizon': ['gapminder', 'five continent series folded into the same band height'],
  'unc-hexbin': ['quakes', '512 epicentres is a real density field, not a scatter with dots hidden'],
  'unc-contour': ['accounts', 'a dense cluster with a second, sparser population outside it'],
  'unc-units': ['budget', 'money in whole millions, so a tile means one unit of something'],
  'exp-arcs': ['models', 'a small bipartite graph, readable as arcs on one axis'],
  'exp-cube': ['penguins', 'three body measures that genuinely trade off against each other'],
  'exp-linked': ['accounts', 'brushing a dense field and watching the breakdown answer'],
  'int-sankey': ['funnel', 'every path through the flow worth isolating'],
  'int-chord': ['funnel', 'bonds worth untangling one at a time'],
  'int-sunburst': ['acquisitions', 'sector then acquirer — a branch worth zooming into'],
  'int-treemap': ['budget', 'drill from a category into its line items'],
  'int-stream': ['gapminder', 'a continent worth isolating from the stack'],
  'int-network': ['funnel', 'a graph small enough that an ego network means something'],
};

/**
 * Chooses which dataset each form is shown on.
 *
 * Every card must be a form drawn on data its OWN fit() accepted — a gallery
 * that shows a chart its own recommender would have refused is advertising
 * something the tool will not do. Scarcest-first for anything unpinned: a form
 * that only two datasets can feed picks before a bar chart that everything
 * feeds, so the rare forms are not left with nothing.
 */
export async function chooseDatasets({ reviewLibrary, GALLERY }) {
  const samples = await loadSamples();
  const profiles = [];
  for (const s of samples) {
    try {
      const pr = profile(s.text, { format: s.format });
      if ((pr.rowCount ?? pr.rows.length) > 1) profiles.push({ ...s, pr, verdicts: null });
    } catch { /* a sample that will not profile is a packaging bug, caught by the gate */ }
  }
  for (const p of profiles) p.verdicts = reviewLibrary(p.pr);

  const eligible = (slug) => profiles.filter((d) => (d.verdicts.find((v) => v.slug === slug) || {}).fits);
  const order = [...GALLERY]
    .map((e) => ({ e, n: eligible(e.slug).length }))
    .sort((a, b) => a.n - b.n)
    .map((o) => o.e);

  const rank = { strong: 2, possible: 1 };
  const used = new Map();
  const chosen = {};
  for (const entry of order) {
    const pinned = PINS[entry.slug];
    let best = null;
    for (const d of eligible(entry.slug)) {
      const v = d.verdicts.find((x) => x.slug === entry.slug);
      // A pin still has to pass the form's own fit(): `eligible()` is what this
      // loop iterates, so a pin to data the form refuses simply finds nothing,
      // and the check below turns that into a build failure rather than a
      // silent fallback to whatever scored next.
      if (pinned && d.id !== pinned[0]) continue;
      const rows = d.pr.rowCount ?? d.pr.rows.length;
      const score = (rank[v.confidence] || 0) * 1000
        // a few hundred rows reads as a real chart; 8 rows reads as a stub and
        // 20,000 reads as a smear
        - Math.abs(Math.log10(Math.max(rows, 1)) - 2) * 40
        // A column name long enough to wrap crowds every label in the piece.
        // Not a data-honesty question — a legibility one, and it only ever
        // affects which EXAMPLE is shown.
        - Math.max(0, longestBinding(v.bindings) - 24) * 12
        // spread the unpinned forms across the sample set rather than drawing
        // every remaining card from whichever dataset fits everything
        - (used.get(d.id) || 0) * 260;
      if (!best || score > best.score) best = { score, d, v, rows, pinned: !!pinned };
    }
    if (pinned && !best) {
      throw new Error(
        `gallery: ${entry.slug} is pinned to "${pinned[0]}", but that sample's shape no longer passes its fit(). `
        + 'Re-pin it from `deevee fit --sample <id>` rather than deleting the pin.'
      );
    }
    chosen[entry.slug] = best;
    if (best) used.set(best.d.id, (used.get(best.d.id) || 0) + 1);
  }
  return chosen;
}

/** The longest column name a binding actually names. */
function longestBinding(bindings) {
  const names = Object.values(bindings || {}).flat().filter((x) => typeof x === 'string');
  return names.reduce((m, s) => Math.max(m, s.length), 0);
}

/** The curator's reason this form is shown on this data, for the card. */
export const pinReason = (slug) => (PINS[slug] ? PINS[slug][1] : null);

export async function buildGallery({ out, quiet = false } = {}) {
  const registry = await import(path.join(ROOT, 'assets/modules/gallery-registry.mjs'));
  const { GALLERY, TIERS } = registry;
  const chosen = await chooseDatasets(registry);

  const prelude = await sharedPrelude();
  const theme = await readFile(path.join(ROOT, 'assets/modules/themes/light.css'), 'utf8');

  const bodies = [];
  const cards = [];
  const missing = [];

  for (const entry of GALLERY) {
    const pick = chosen[entry.slug];
    if (!pick) { missing.push(entry.slug); continue; }

    // Carry only the columns the binding actually names. The whole row object
    // would put a 20-column table in the page forty times over for no gain.
    const cols = [...new Set(Object.values(pick.v.bindings).flat().filter((x) => typeof x === 'string'))];
    const rows = pick.d.pr.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));

    const body = await inlineModule(entry.module, { vendor: false, shared: SHAREABLE });
    bodies.push(`__VF.mods[${JSON.stringify(entry.slug)}] = (function(){\n${body}\n;return mount;})();`);

    cards.push({
      slug: entry.slug,
      tier: entry.tier,
      title: entry.title,
      gallery: entry.gallery,
      answers: entry.answers,
      data: entry.data,
      honesty: entry.honesty,
      build: entry.build,
      rest: entry.rest,
      module: entry.module,
      source: pick.d.label,
      rows: pick.rows,
      confidence: pick.v.confidence,
      why: pick.v.why,
      shown: pinReason(entry.slug),
      config: {
        data: rows,
        bindings: pick.v.bindings,
        ...(pick.v.options || {}),
        // The preview's own copy describes THE DATA, never the form — the card
        // below already names the form, and the registry's stock one-liners
        // were written against specific datasets ("The AI SDK boom — weekly npm
        // downloads"), so reusing one here would caption a chart with a finding
        // it did not compute. The dek is the binding the fit-check actually
        // resolved, which is true by construction.
        copy: {
          headline: pick.d.label,
          dek: upperFirst(pick.v.why),
          source: pick.d.source,
        },
      },
    });
  }

  if (missing.length) {
    throw new Error(
      `gallery: no bundled sample fits ${missing.join(', ')} — a form with no honest dataset `
      + 'cannot be shown. Add a sample to samples/ whose shape its fit() accepts.'
    );
  }

  const html = page({ cards, tiers: TIERS, prelude, bodies, theme });
  const file = path.resolve(out || path.join(process.cwd(), 'deevee-gallery.html'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, 'utf8');
  if (!quiet) {
    console.log(`Gallery: ${cards.length} forms, ${(html.length / 1e6).toFixed(2)}MB, self-contained`);
    console.log(file);
  }
  return { file, count: cards.length, bytes: html.length };
}

// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function page({ cards, tiers, prelude, bodies, theme }) {
  const byTier = {};
  for (const c of cards) (byTier[c.tier] ||= []).push(c);
  const previewSizes = ['card', 'half-slide-4x3', 'slide-16x9', 'square'];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deevee — the chart gallery</title>
<style>
${theme}
:root{
  --pg-bg:#f2f3f7; --pg-card:#ffffff; --pg-ink:#101318; --pg-muted:#4c5565;
  --pg-hair:#dfe3eb; --pg-accent:#a82d18; --pg-chip:#eceff5;
}
:root:not([data-theme="light"]){ color-scheme: light; }
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --pg-bg:#0b0d11; --pg-card:#14181f; --pg-ink:#f2f5fa; --pg-muted:#a3adbe;
    --pg-hair:#252b35; --pg-accent:#f2795a; --pg-chip:#1c222b;
    color-scheme: dark;
  }
}
*,*::before,*::after{ box-sizing:border-box; }
body{ margin:0; background:var(--pg-bg); color:var(--pg-ink);
  font:15px/1.5 'Inter',system-ui,-apple-system,sans-serif; }
.wrap{ max-width:1500px; margin:0 auto; padding-block:40px; padding-inline:20px; }
header h1{ margin:0 0 6px; font-size:clamp(1.6rem,3.4vw,2.5rem); letter-spacing:-.02em;
  font-family:'Space Grotesk','Instrument Sans',system-ui,sans-serif; }
header p{ margin:0; max-width:62ch; color:var(--pg-muted); }
.bar{ position:sticky; top:0; z-index:20; margin:26px 0 8px; padding:12px 0;
  background:color-mix(in srgb, var(--pg-bg) 92%, transparent);
  backdrop-filter:blur(8px); border-bottom:1px solid var(--pg-hair);
  display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.chip{ font:inherit; font-size:13px; padding:6px 12px; border-radius:999px; cursor:pointer;
  border:1px solid var(--pg-hair); background:var(--pg-chip); color:var(--pg-ink); }
.chip[aria-pressed="true"]{ background:var(--pg-ink); color:var(--pg-bg); border-color:var(--pg-ink); }
input[type="search"]{ font:inherit; font-size:13px; padding:7px 12px; min-width:190px; flex:1 1 190px;
  border:1px solid var(--pg-hair); border-radius:8px; background:var(--pg-card); color:var(--pg-ink); }
.spacer{ flex:1 1 20px; }
label.sz{ font-size:13px; color:var(--pg-muted); display:flex; gap:7px; align-items:center; }
select{ font:inherit; font-size:13px; padding:6px 10px; border:1px solid var(--pg-hair);
  border-radius:8px; background:var(--pg-card); color:var(--pg-ink); }
#count{ font-size:13px; color:var(--pg-muted); }
h2.tier{ margin:40px 0 4px; font-size:1.1rem; letter-spacing:.06em; text-transform:uppercase;
  font-family:'Space Grotesk','Instrument Sans',system-ui,sans-serif; }
h2.tier + p{ margin:0 0 18px; color:var(--pg-muted); max-width:70ch; font-size:14px; }
.grid{ display:grid; gap:18px; align-items:start;
  grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr)); }
.card{ background:var(--pg-card); border:1px solid var(--pg-hair); border-radius:12px;
  overflow:hidden; display:flex; flex-direction:column; }
.card[hidden]{ display:none; }
.stage{ background:var(--vf-paper,#fff); border-bottom:1px solid var(--pg-hair);
  position:relative; container-type:inline-size; }
.stage .mount{ width:100%; }
.stage .ph{ position:absolute; inset:0; display:grid; place-items:center;
  color:var(--pg-muted); font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
.meta{ padding:14px 16px 16px; display:flex; flex-direction:column; gap:9px; }
.hd{ display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.hd h3{ margin:0; font-size:1.02rem; font-family:'Space Grotesk','Instrument Sans',system-ui,sans-serif; }
code.slug{ font:12px/1 'IBM Plex Mono',ui-monospace,monospace; color:var(--pg-accent);
  background:var(--pg-chip); padding:4px 7px; border-radius:5px; }
.card dl{ margin:0; display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:13px; }
.card dt{ color:var(--pg-muted); white-space:nowrap; }
.card dd{ margin:0; }
.note{ font-size:12.5px; color:var(--pg-muted); border-left:2px solid var(--pg-hair);
  padding-left:10px; margin:0; }
.tag{ font:11px/1 'IBM Plex Mono',ui-monospace,monospace; color:var(--pg-muted);
  border:1px solid var(--pg-hair); border-radius:4px; padding:3px 6px; }
.cmd{ font:11.5px/1.5 'IBM Plex Mono',ui-monospace,monospace; background:var(--pg-chip);
  border-radius:6px; padding:8px 10px; overflow-x:auto; white-space:pre; margin:0; }
button.replay{ font:inherit; font-size:12px; padding:5px 10px; align-self:flex-start;
  border:1px solid var(--pg-hair); border-radius:7px; background:transparent;
  color:var(--pg-ink); cursor:pointer; }
footer{ margin:56px 0 0; padding-top:20px; border-top:1px solid var(--pg-hair);
  color:var(--pg-muted); font-size:13px; max-width:70ch; }
@media (prefers-reduced-motion: reduce){ *{ animation-duration:.001ms !important; } }
</style>
</head>
<body class="vf-theme-light">
<div class="wrap">
<header>
  <h1>The chart gallery</h1>
  <p>Every form in the library, live and animated, each drawn on a dataset its own
  fit-check accepted. Pick one by its <code>slug</code> and build it on your data with the
  command on the card. Nothing here loads from the network.</p>
</header>

<div class="bar" role="group" aria-label="Filter the gallery">
  <button class="chip" data-tier="*" aria-pressed="true">All</button>
  ${tiers.map((t) => `<button class="chip" data-tier="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('\n  ')}
  <input type="search" id="q" placeholder="Search form, question or data shape…" aria-label="Search the gallery" />
  <span class="spacer"></span>
  <label class="sz">Preview at
    <select id="size">
      ${previewSizes.map((s, i) => `<option value="${esc(s)}"${i === 1 ? ' selected' : ''}>${esc(SIZES[s].label)} — ${SIZES[s].width}×${SIZES[s].height}</option>`).join('\n      ')}
    </select>
  </label>
  <span id="count"></span>
</div>

${tiers.map((t) => tierSection(t, byTier[t] || [])).join('\n')}

<footer>
  <p><strong>Reading a card.</strong> <em>Answers</em> is the question the form is for.
  <em>Needs</em> is the data shape it will accept — hand it anything else and the
  recommender refuses rather than forcing a fit. <em>Honesty</em> is what the form
  does to stay truthful, and it is the sentence worth reading before you commit.</p>
  <p><strong>The previews are not your data.</strong> Each one uses a bundled sample
  chosen because this form's own fit-check accepted it. Run
  <code>deevee fit &lt;your-file&gt;</code> to see which forms your data actually earns.</p>
</footer>
</div>

<script>
${prelude}
var __VF = { mods: {} };
${bodies.join('\n')}
__VF.cards = ${JSON.stringify(cards.map((c) => ({ slug: c.slug, config: c.config })))};
</script>
<script>
(function(){
  var SIZES = ${JSON.stringify(Object.fromEntries(previewSizes.map((s) => [s, { w: SIZES[s].width, h: SIZES[s].height }])))};
  var cfgBySlug = {};
  __VF.cards.forEach(function(c){ cfgBySlug[c.slug] = c.config; });

  var stages = [].slice.call(document.querySelectorAll('.stage'));

  // The stage keeps the chosen preset's ASPECT, not its pixel width: a card is
  // ~420px wide in the grid, and forcing 1200px would just add a scrollbar. The
  // modules size their type in cqw, so the aspect is what actually changes the
  // composition — which is the thing a reader is comparing between presets.
  function applySize(){
    var s = SIZES[document.getElementById('size').value];
    stages.forEach(function(st){ st.style.aspectRatio = s.w + ' / ' + s.h; });
    mounted.forEach(function(slug){ draw(document.querySelector('[data-slug="' + slug + '"] .stage')); });
  }

  var mounted = [];
  function draw(stage){
    if (!stage) return;
    var slug = stage.closest('.card').dataset.slug;
    var mount = __VF.mods[slug];
    var host = stage.querySelector('.mount');
    host.innerHTML = '';
    var ph = stage.querySelector('.ph');
    try {
      mount(host, Object.assign({ fit: 'height' }, cfgBySlug[slug]));
      if (ph) ph.remove();
      if (mounted.indexOf(slug) === -1) mounted.push(slug);
    } catch (err) {
      if (ph) ph.textContent = 'preview failed: ' + err.message;
      // Surfaced, never swallowed — a card that silently shows nothing is the
      // exact failure the build gate exists to catch.
      console.error('[deevee] ' + slug + ': ' + err.message);
    }
  }

  // Mount on scroll-in so every build animation is actually watched, and so the
  // page does not run forty D3 enter-transitions at once on load.
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      draw(e.target);
    });
  }, { rootMargin: '250px 0px' });
  stages.forEach(function(st){ io.observe(st); });

  document.addEventListener('click', function(e){
    var b = e.target.closest('button.replay');
    if (b) draw(b.closest('.card').querySelector('.stage'));
  });

  // --- filtering ---
  var tier = '*', q = '';
  var cards = [].slice.call(document.querySelectorAll('.card'));
  function apply(){
    var shown = 0;
    cards.forEach(function(c){
      var okTier = tier === '*' || c.dataset.tier === tier;
      var okQ = !q || c.dataset.search.indexOf(q) !== -1;
      c.hidden = !(okTier && okQ);
      if (!c.hidden) shown++;
    });
    [].forEach.call(document.querySelectorAll('h2.tier'), function(h){
      var sec = h.nextElementSibling.nextElementSibling;
      var any = [].some.call(sec.querySelectorAll('.card'), function(c){ return !c.hidden; });
      h.hidden = !any; h.nextElementSibling.hidden = !any; sec.hidden = !any;
    });
    document.getElementById('count').textContent = shown + ' of ' + cards.length + ' forms';
  }
  [].forEach.call(document.querySelectorAll('.chip'), function(btn){
    btn.addEventListener('click', function(){
      tier = btn.dataset.tier;
      [].forEach.call(document.querySelectorAll('.chip'), function(b){
        b.setAttribute('aria-pressed', String(b === btn));
      });
      apply();
    });
  });
  document.getElementById('q').addEventListener('input', function(e){
    q = e.target.value.trim().toLowerCase(); apply();
  });
  document.getElementById('size').addEventListener('change', applySize);

  applySize();
  apply();
})();
</script>
</body>
</html>
`;
}

const TIER_BLURB = {
  Conventional: 'The forms a reader already knows how to read. Reach here first — an unfamiliar form spends the reader’s attention on the form instead of the finding.',
  Unconventional: 'Familiar to a chart-literate reader, unfamiliar to everyone else. Worth the cost when the data genuinely has a shape the conventional forms flatten.',
  Experimental: 'Forms that ask real work of the reader. Each one earns its place only when the alternative is showing less than the truth.',
  Interactive: 'Built so the interaction IS the reading path — click to isolate, drill, or scrub — rather than a static chart with a tooltip added.',
};

function tierSection(tier, cards) {
  return `<h2 class="tier">${esc(tier)} <span class="tag">${cards.length}</span></h2>
<p>${esc(TIER_BLURB[tier] || '')}</p>
<section class="grid">
${cards.map(card).join('\n')}
</section>`;
}

function card(c) {
  const search = [c.slug, c.title, c.gallery, c.answers, c.data, c.tier, c.build, c.rest]
    .join(' ').toLowerCase();
  return `<article class="card" data-slug="${esc(c.slug)}" data-tier="${esc(c.tier)}" data-search="${esc(search)}">
  <div class="stage"><div class="mount"></div><div class="ph">loading…</div></div>
  <div class="meta">
    <div class="hd">
      <h3>${esc(c.title)}</h3>
      <code class="slug">${esc(c.slug)}</code>
      <span class="tag">build: ${esc(c.build)}</span>
      <span class="tag">rest: ${esc(c.rest)}</span>
    </div>
    <dl>
      <dt>Answers</dt><dd>${esc(c.answers)}</dd>
      <dt>Needs</dt><dd>${esc(c.data)}</dd>
    </dl>
    <p class="note"><strong>Honesty.</strong> ${esc(c.honesty)}</p>
    <p class="note">Shown on <strong>${esc(c.source)}</strong>, ${c.rows} rows${c.shown ? ` — ${esc(c.shown)}` : ''}.</p>
    <pre class="cmd">deevee make &lt;your-data&gt; --form ${esc(c.slug)}</pre>
    <button class="replay" type="button">Replay the build</button>
  </div>
</article>`;
}
