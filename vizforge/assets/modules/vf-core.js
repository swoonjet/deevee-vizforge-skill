// assets/modules/vf-core.js
//
// Shared runtime for VizForge PORTABLE MODULES — the embeddable form of a
// technique. A module is a pure `mount(el, config)` with zero dependencies,
// designed to be inlined into a single self-contained file (an iframe page or
// a copy-paste snippet) with no CDN, no build step and no host-page
// assumptions.
//
// HOW THIS DIFFERS FROM A SCAFFOLD. A scaffold (scaffolds/*.html) is a fixed
// 1200x750 editorial stage that the QA gate captures deterministically. A
// module is responsive, themeable, and lives inside someone else's page.
// Same renderer, two envelopes.
//
// WHAT THE DEMO PIECES GOT WRONG, and what this fixes (the four Dimensional
// pieces at demo/b2b/native/dim-*.html):
//   - data hardcoded inline as `const P=[...]`      -> config.data
//   - fixed 1200x760 stage, controls at right:44px  -> ResizeObserver + viewBox
//   - .hd/.dek/.tip/.src styled by the GALLERY's
//     stylesheet, so a bare page renders unstyled   -> styles ship with mount
//   - Fritz hexes baked into JS                     -> CSS custom properties
//
// THEMING. Every colour and font resolves through a CSS custom property with a
// house fallback, so a host page restyles a module without touching its code:
//
//   --vf-paper --vf-ink --vf-muted --vf-hair --vf-accent
//   --vf-cat-1 .. --vf-cat-6
//   --vf-font-headline --vf-font-label --vf-font-figures
//
// HONESTY. Carried over from the scaffolds, not relaxed for being embeddable:
// a non-zero baseline on a position channel is legal only when disclosed, and
// `subject` (what the data IS) may only ever arrive from config — never a
// literal in module code. See the 2026-07-30 false-attribution fix.

export const THEME_DEFAULTS = {
  paper: '#f9f7ef',
  ink: '#14141c',
  muted: '#3a3a4a',
  hair: 'rgba(20,20,28,.12)',
  hair2: 'rgba(20,20,28,.06)',
  accent: '#9c2b1b',
  cat: ['#1a7aff', '#0d3d85', '#a8008c', '#3f7d4e', '#b06a00', '#5c4b8a'],
  fontHeadline: '"Space Grotesk", "Instrument Sans", system-ui, sans-serif',
  fontLabel: '"Inter", system-ui, sans-serif',
  fontFigures: '"IBM Plex Mono", "Geist Mono", ui-monospace, monospace',
};

let uidCounter = 0;
export function uid(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      if (attrs[key] === undefined || attrs[key] === null) continue;
      node.setAttribute(key, String(attrs[key]));
    }
  }
  return node;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A dek's interaction clause — appended only when the piece can actually BE
 * interacted with.
 *
 * "Hover to read exact values" is true in a page and false in a PNG, and a
 * caption instructing a reader to do something impossible costs the piece its
 * authority in the one place it has to be trustworthy. `config.static` is set by
 * the PNG renderer (scripts/render-module-png.mjs), so the sentence disappears
 * from a raster and stays in every live embed.
 *
 * The FLAG, not a user-agent guess: a module cannot detect "I am being
 * screenshotted" and must not try — a touch device with no hover is a separate
 * problem with a separate answer (the tooltip already opens on tap).
 */
export function interactionNote(config, sentence) {
  return config && config.static ? '' : ` ${sentence}`;
}

/**
 * The same rule, for copy a module writes from inside draw().
 *
 * interactionNote() only filters the hoverNote a module DECLARES. A module that
 * calls ctx.setCopy() composes its own sentences and bypasses that filter
 * completely — so "Click a member to keep only its own bonds." shipped inside
 * exported PNGs, an instruction the reader of a raster cannot follow. Six modules
 * did it. Wrapping the clause in ifLive() makes the rule visible at the site that
 * has to obey it, and greppable across the library.
 *
 *   dek: `${edgeDek(stats)}${ifLive(config, ' Click a member to keep only its bonds.')}`
 *
 * The leading space belongs to the CALLER's string, not to this function, because
 * the clause is often the whole value rather than a suffix.
 */
export function ifLive(config, sentence) {
  return config && config.static ? '' : sentence;
}

// ---------------------------------------------------------------------------
// Scales — deliberately hand-rolled. A module must not pull d3 into a host
// page, and these are the only three scale behaviours the modules need.
// ---------------------------------------------------------------------------

export function linearScale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
  scale.invert = (p) => (r1 === r0 ? d0 : d0 + ((p - r0) / (r1 - r0)) * span);
  scale.domain = () => [d0, d1];
  scale.range = () => [r0, r1];
  return scale;
}

export function bandScale(values, range, padding = 0.2) {
  const [r0, r1] = range;
  const n = Math.max(1, values.length);
  const step = (r1 - r0) / n;
  const bandWidth = step * (1 - padding);
  const index = new Map(values.map((v, i) => [v, i]));
  const scale = (v) => r0 + index.get(v) * step + (step - bandWidth) / 2;
  scale.bandwidth = () => bandWidth;
  scale.step = () => step;
  scale.domain = () => values.slice();
  return scale;
}

/**
 * "Nice" ticks over [lo, hi]. Same 1/2/5/10 progression d3 uses, so axes read
 * the way the scaffolds' do.
 */
export function ticks(lo, hi, count = 6) {
  if (!(isFinite(lo) && isFinite(hi)) || lo === hi) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/**
 * Ticks for a TEMPORAL domain. Linear millisecond steps do not land on
 * calendar boundaries, which produces axes reading "Jan Jan Jan Feb Feb Mar" —
 * evenly spaced in time, useless to read. These snap to real year / month /
 * day starts so every label is distinct and meaningful.
 */
export function temporalTicks(lo, hi, count = 6) {
  if (!(isFinite(lo) && isFinite(hi)) || lo === hi) return [lo];
  const DAY = 86400000;
  const span = hi - lo;
  const out = [];

  const push = (v) => { if (v >= lo && v <= hi) out.push(v); };

  if (span > 3 * 365 * DAY) {
    const y0 = new Date(lo).getUTCFullYear();
    const y1 = new Date(hi).getUTCFullYear();
    const step = Math.max(1, Math.ceil((y1 - y0 + 1) / count));
    for (let y = y0; y <= y1; y += step) push(Date.UTC(y, 0, 1));
  } else if (span > 45 * DAY) {
    const d = new Date(lo);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    const months = Math.round(span / (30.44 * DAY));
    const step = Math.max(1, Math.ceil(months / count));
    for (let i = 0; i <= months + step; i += step) {
      push(Date.UTC(y, m + i, 1));
    }
  } else {
    const days = Math.max(1, Math.round(span / DAY));
    const step = Math.max(1, Math.ceil(days / count));
    const start = new Date(lo);
    const base = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    for (let i = 0; i <= days + step; i += step) push(base + i * DAY);
  }

  return out.length ? out : [lo, hi];
}

/**
 * Axis ticks for a series, preferring the DATA'S OWN x values when there are
 * few enough to label directly. A six-point monthly series should label its
 * six months exactly, not an interpolated grid that misses them.
 */
export function axisTicks(values, domain, count, isTemporal) {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length <= Math.max(2, count)) return distinct;
  return isTemporal ? temporalTicks(domain[0], domain[1], count) : ticks(domain[0], domain[1], count);
}

/**
 * A position-channel domain: padded, and NOT forced to zero. Position may use
 * a non-zero baseline provided it is disclosed — `baselineDisclosed` below
 * reports whether a disclosure is required.
 */
export function positionDomain(values, { padding = 0.06 } = {}) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { domain: [0, 1], baselineZero: true };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    const bump = Math.abs(lo) * 0.05 || 1;
    lo -= bump;
    hi += bump;
  }
  const pad = (hi - lo) * padding;
  const domain = [lo - pad, hi + pad];
  return { domain, baselineZero: domain[0] <= 0 && lo >= 0 };
}

/** A length-channel domain: ALWAYS anchored at zero. Bars may never truncate. */
export function lengthDomain(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  const hi = finite.length ? Math.max(0, ...finite) : 1;
  const lo = finite.length ? Math.min(0, ...finite) : 0;
  const pad = (hi - lo) * 0.04;
  return [lo, hi + pad];
}

// ---------------------------------------------------------------------------
// Value + date formatting
// ---------------------------------------------------------------------------

export function formatNumber(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e4) return (v / 1e3).toFixed(0) + 'k';
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 1) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a temporal x value. THIS IS THE FIX for the epoch-millisecond axis
 * labels the `line` scaffold renders ("1736000000000"): coerceX there falls
 * back to Date.parse and nothing ever formats it back, so a user binding a
 * date column gets raw epoch integers on the axis and in the headline.
 *
 * `span` (domain width in ms) picks the granularity, so a six-month range
 * reads "Mar 2025" and a two-day range reads "14:00".
 */
export function formatTemporal(ms, span) {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return '—';
  const DAY = 86400000;
  if (span === undefined || span > 5 * 365 * DAY) return String(d.getUTCFullYear());
  if (span > 300 * DAY) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  // Month granularity down to ~6 weeks: a 6-point monthly series must read
  // "Mar", not "Mar 1", which implies a day precision the buckets don't have.
  if (span > 45 * DAY) return MONTHS[d.getUTCMonth()];
  if (span > 3 * DAY) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Number coercion for BOUND DATA, where a blank cell must never become a value.
 *
 * `Number('')` and `Number(null)` are both 0, and both pass Number.isFinite. So
 * the obvious `const v = Number(row[col])` turns an EMPTY CELL into a real zero:
 * a trend line diving to the axis, a bar of nothing, a radar spoke pulled to the
 * centre, a total short by however many blanks there were — none of it in the
 * data, and none of it disclosed. scripts/profile.mjs preserves the source text,
 * so an empty CSV cell arrives as '' and every uploaded file took that path.
 *
 * coerceX() already guarded the x channel this way; the value channels did not.
 * Returns NaN for anything that is not a number, so callers keep Number.isFinite
 * as their single gate and a blank stays a gap.
 */
export function toNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'string' && raw.trim() === '') return NaN;
  return Number(raw);
}

/**
 * Coerces a bound x value to a number, reporting WHICH kind it was so callers
 * can format it back. Explicit `xType` from config always wins — guessing is
 * only a fallback for hand-written embeds.
 */
export function coerceX(raw, xType) {
  if (raw === undefined || raw === null) return { value: NaN, type: 'quantitative' };
  const s = String(raw).trim();
  if (s === '') return { value: NaN, type: 'quantitative' };

  if (xType === 'temporal') {
    const n = Number(s);
    // A bare number in temporal position is either already epoch ms or a year.
    if (Number.isFinite(n)) {
      if (Math.abs(n) > 1e11) return { value: n, type: 'temporal' };
      if (n > 1000 && n < 3000) return { value: Date.UTC(Math.trunc(n), 0, 1), type: 'temporal' };
    }
    const parsed = Date.parse(s);
    return Number.isNaN(parsed)
      ? { value: NaN, type: 'temporal' }
      : { value: parsed, type: 'temporal' };
  }

  const n = Number(s);
  if (Number.isFinite(n)) return { value: n, type: 'quantitative' };
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? { value: NaN, type: 'quantitative' } : { value: parsed, type: 'temporal' };
}

// ---------------------------------------------------------------------------
// Envelope: chrome, styles, responsiveness
// ---------------------------------------------------------------------------

/**
 * The stylesheet every module ships with. Scoped to the mount root's generated
 * class so it can never collide with a host page, and written entirely against
 * CSS custom properties with house fallbacks so a host can retheme it.
 */
export function moduleStyles(rootClass) {
  const t = THEME_DEFAULTS;
  return `
.${rootClass}{
  --_paper: var(--vf-paper, ${t.paper});
  --_ink: var(--vf-ink, ${t.ink});
  --_muted: var(--vf-muted, ${t.muted});
  --_hair: var(--vf-hair, ${t.hair});
  --_hair2: var(--vf-hair2, ${t.hair2});
  --_accent: var(--vf-accent, ${t.accent});
  /* THE FIELD MARK — the colour of every mark that is NOT the emphasis, in a
     single-hue module (ranked bar, single-series trend). It used to be
     hardcoded as ink at 52%, which meant a theme could set the accent and the
     paper but had no way to say what the chart FIELD is made of. The Fritz
     theme's own law is "one blue/ink family for the field, Flarepop only where
     the story peaks" — unreachable while the field was ink. Default is exactly
     the previous rendering, so the house palette is unchanged. A theme that
     overrides these owns the 3:1 graphics contrast of the result. */
  --_mark: var(--vf-mark, var(--vf-ink, ${t.ink}));
  --_mark-opacity: var(--vf-mark-opacity, 0.52);
  --_fh: var(--vf-font-headline, ${t.fontHeadline});
  --_fl: var(--vf-font-label, ${t.fontLabel});
  --_ff: var(--vf-font-figures, ${t.fontFigures});
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  width: 100%;
  background: var(--_paper);
  color: var(--_ink);
  font-family: var(--_fl);
  padding: clamp(1rem, 3.5cqw, 2.75rem);
  display: flex;
  flex-direction: column;
  gap: 0;
}
.${rootClass} *, .${rootClass} *::before, .${rootClass} *::after{ box-sizing: border-box; }
/* DEFENSIVE RESET. A module uses semantic tags (h2, p, ul, button) inside a
   page it does not control, so the host's own element rules reach in. A real
   case: a host styling "h2 { text-transform: uppercase }" shouted the computed
   headline. Neutralise every inherited text treatment the module then sets
   deliberately — this is isolation, not decoration. */
.${rootClass} h2, .${rootClass} p, .${rootClass} ul, .${rootClass} li,
.${rootClass} button, .${rootClass} div{
  text-transform: none;
  text-decoration: none;
  font-style: normal;
  font-variant: normal;
  letter-spacing: normal;
  word-spacing: normal;
  text-indent: 0;
  text-align: left;
  text-shadow: none;
  float: none;
  border: 0;
}
.${rootClass} ul, .${rootClass} li{ list-style: none; margin: 0; padding: 0; }
.${rootClass} .vf-headline{
  margin: 0;
  color: var(--_ink);
  font-family: var(--_fh);
  font-weight: 700;
  font-size: clamp(1.15rem, 2.9cqw, 2.05rem);
  line-height: 1.14;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.${rootClass} .vf-dek{
  margin: 0.55rem 0 0 0;
  color: var(--_ink);
  max-width: 46rem;
  font-size: clamp(0.82rem, 1.25cqw, 1.02rem);
  line-height: 1.45;
  opacity: 0.82;
  text-wrap: pretty;
}
/* THE WAY BACK. An interactive form that can descend has to say so, and has to
   offer a control the size of a control. This used to be an 11px SVG <text>
   drawn inside each module's own plot — 79x14 pixels of caption under a 1400px
   picture, with no hover, no focus, no hit padding, and a different idiom per
   module. It read as a label, so readers got stuck one level down.

   It lives OUTSIDE the svg on purpose: a real <button> is focusable, reachable
   by keyboard, announced by a screen reader, and cannot be mistaken for a mark.
   It is also outside the plot box, so it never steals space the chart measured
   itself against. Hidden entirely at the top level — an inert "All groups" sat
   there permanently and was pure clutter. */
.${rootClass} .vf-nav{
  display: none;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.7rem 0 0 0;
  font-family: var(--_ff);
  font-size: clamp(0.68rem, 0.95cqw, 0.78rem);
}
.${rootClass} .vf-nav.is-open{ display: flex; }
.${rootClass} .vf-back{
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  margin: 0;
  padding: 0.4em 0.85em;
  border: 1px solid var(--_hair);
  border-radius: 999px;
  background: var(--_paper);
  color: var(--_accent);
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.${rootClass} .vf-back:hover{
  background: var(--_accent);
  border-color: var(--_accent);
  color: var(--_paper);
}
.${rootClass} .vf-back:focus-visible{
  outline: 2px solid var(--_accent);
  outline-offset: 2px;
}
.${rootClass} .vf-back .vf-back-arrow{ font-size: 1.1em; line-height: 1; }
.${rootClass} .vf-trail{
  color: var(--_ink);
  opacity: 0.72;
  min-width: 0;
  overflow-wrap: anywhere;
}
/* The keyboard route, stated. Only shown where a keyboard exists to press it —
   a still export has no Escape key, and printing one would be a small lie. */
.${rootClass} .vf-esc{
  margin-left: auto;
  color: var(--_ink);
  opacity: 0.45;
  white-space: nowrap;
}
.${rootClass} .vf-esc kbd{
  font: inherit;
  border: 1px solid var(--_hair);
  border-radius: 4px;
  padding: 0.1em 0.4em;
}
@media (prefers-reduced-motion: reduce){
  .${rootClass} .vf-back{ transition: none; }
}
.${rootClass} .vf-plot{
  position: relative;
  margin: clamp(0.85rem, 2.2cqw, 1.6rem) 0;
  flex: 1 1 auto;
  min-height: 0;
}
.${rootClass} svg{ display: block; width: 100%; height: auto; overflow: visible; }
/* fit:"height" — the module fills a constrained box (an iframe, a dashboard
   cell) instead of deriving its height from width x aspect. Without this the
   plot overflows any fixed-height host and the source line collides with the
   chart. */
.${rootClass}.vf-fit-height{ height: 100%; }
.${rootClass}.vf-fit-height .vf-plot{ overflow: hidden; }
.${rootClass}.vf-fit-height svg{ height: 100%; }
.${rootClass} .vf-source{
  margin: 0;
  color: var(--_ink);
  font-family: var(--_ff);
  font-size: clamp(0.62rem, 0.86cqw, 0.74rem);
  line-height: 1.4;
  opacity: 0.62;
  text-wrap: pretty;
}
.${rootClass} .vf-legend{
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin: 0.85rem 0 0 0;
  padding: 0;
  list-style: none;
}
.${rootClass} .vf-legend button{
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--_fl);
  font-size: clamp(0.7rem, 1cqw, 0.82rem);
  font-weight: 600;
  color: var(--_ink);
  background: none;
  border: 0;
  padding: 0.1rem 0;
  cursor: pointer;
}
.${rootClass} .vf-legend button[aria-pressed="false"]{ opacity: 0.34; }
.${rootClass} .vf-legend .vf-swatch{ width: 0.7rem; height: 0.7rem; border-radius: 50%; flex: none; }
.${rootClass} .vf-tip{
  position: absolute;
  z-index: 5;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -100%);
  background: var(--_paper);
  border: 1px solid var(--_hair);
  padding: 0.4rem 0.55rem;
  font-family: var(--_ff);
  font-size: 0.72rem;
  line-height: 1.35;
  white-space: nowrap;
  transition: opacity 120ms ease-out;
}
.${rootClass} .vf-tip b{ font-weight: 600; }
@media (prefers-reduced-motion: reduce){
  .${rootClass} .vf-tip{ transition: none; }
}
`.trim();
}

/**
 * Builds the shared chrome (headline, dek, plot area, legend, source line) and
 * returns the pieces a module renders into.
 *
 * `copy.subject` is the only place a dataset may describe itself. Modules must
 * never hardcode one — same rule as the scaffolds.
 */
export function buildFrame(el, config, opts) {
  const rootClass = uid('vf');
  const copy = config.copy || {};

  el.textContent = '';
  el.classList.add(rootClass);
  el.classList.add('vf-module');

  const style = document.createElement('style');
  style.textContent = moduleStyles(rootClass);
  el.appendChild(style);

  const headline = document.createElement('h2');
  headline.className = 'vf-headline';
  headline.textContent = copy.headline || opts.defaultHeadline || '';
  el.appendChild(headline);

  const dek = document.createElement('p');
  dek.className = 'vf-dek';
  dek.textContent = copy.dek || opts.defaultDek || '';
  if (!dek.textContent) dek.style.display = 'none';
  el.appendChild(dek);

  let legend = null;
  if (opts.legend) {
    legend = document.createElement('ul');
    legend.className = 'vf-legend';
    el.appendChild(legend);
  }

  // The way back, between the dek and the picture: where a reader looks after
  // reading what changed, and above the marks rather than lost among them.
  // Empty and display:none until a module opens a level (see ctx.trail).
  const nav = document.createElement('div');
  nav.className = 'vf-nav';
  el.appendChild(nav);

  const plot = document.createElement('div');
  plot.className = 'vf-plot';
  el.appendChild(plot);

  const svg = svgEl('svg', { role: 'img', 'aria-label': opts.ariaLabel || 'data visualization' });
  plot.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'vf-tip';
  tip.setAttribute('role', 'status');
  plot.appendChild(tip);

  const source = document.createElement('p');
  source.className = 'vf-source';
  source.textContent = attributionLine(copy, opts.note);
  el.appendChild(source);

  return { rootClass, headline, dek, legend, nav, plot, svg, tip, source };
}

/**
 * renderTrail(nav, state) — paints the way-back bar.
 *
 * `state` is null/undefined at the top level, which HIDES the bar completely.
 * Otherwise `{ label, crumbs, onHome, keyboard }`: a real button reading
 * `label`, the trail of where you are, and (unless `keyboard` is false) the
 * Escape hint. Rebuilt rather than patched, because a redraw may change the
 * level and a half-updated breadcrumb is worse than none.
 *
 * Returns the button so the caller can focus it — moving focus to the way out
 * is the whole reason a keyboard user can descend at all.
 */
export function renderTrail(nav, state) {
  nav.textContent = '';
  if (!state) {
    nav.classList.remove('is-open');
    return null;
  }
  nav.classList.add('is-open');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'vf-back';
  const arrow = document.createElement('span');
  arrow.className = 'vf-back-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '←';
  back.appendChild(arrow);
  back.appendChild(document.createTextNode(state.label || 'Back'));
  if (state.onHome) back.addEventListener('click', state.onHome);
  nav.appendChild(back);

  if (state.crumbs) {
    const trail = document.createElement('span');
    trail.className = 'vf-trail';
    trail.textContent = state.crumbs;
    nav.appendChild(trail);
  }

  if (state.keyboard !== false) {
    const esc = document.createElement('span');
    esc.className = 'vf-esc';
    const kbd = document.createElement('kbd');
    kbd.textContent = 'Esc';
    esc.appendChild(kbd);
    esc.appendChild(document.createTextNode(' to go back'));
    nav.appendChild(esc);
  }

  return back;
}

/**
 * The source line: provenance, then methodology, then the honesty note.
 * Mirrors assets/snippets/attribution.js's separator idiom so an embedded
 * module reads like a scaffold-rendered piece.
 */
export function attributionLine(copy, note) {
  const parts = [`Source: ${copy.source || 'User-provided data'}`];
  const methodology = copy.methodology || copy.subject;
  if (methodology) parts.push(methodology);
  const resolved = copy.note || note;
  if (resolved) parts.push(resolved);
  return parts.join(' · ');
}

/**
 * Re-renders on width change. Returns a teardown. Height follows a target
 * aspect ratio, floored so a narrow embed never collapses the plot.
 */
export function observeSize(el, plot, render, { aspect = 0.52, minHeight = 190, fit = 'aspect' } = {}) {
  let last = '';

  if (fit === 'height') el.classList.add('vf-fit-height');

  const apply = () => {
    const width = Math.round(plot.clientWidth || el.clientWidth || 0);
    if (width <= 0) return;

    // fit:"height" takes the height the flex layout actually gave the plot, so
    // the piece fills an iframe or dashboard cell exactly. Falls back to the
    // aspect rule when the host imposes no height (a flowing page).
    let height;
    if (fit === 'height') {
      const box = Math.round(plot.clientHeight || 0);
      height = box > minHeight ? box : Math.max(minHeight, Math.round(width * aspect));
    } else {
      height = Math.max(minHeight, Math.round(width * aspect));
    }

    const key = `${width}x${height}`;
    if (key === last) return;
    last = key;
    render(width, height);
  };

  apply();

  if (typeof ResizeObserver !== 'function') {
    const onResize = () => apply();
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }

  const ro = new ResizeObserver(apply);
  ro.observe(el);
  ro.observe(plot);
  return () => ro.disconnect();
}

/**
 * The emphasis colour, as the page actually resolved it.
 *
 * A module needs this when the categorical ramp and the accent can COLLIDE:
 * the Fritz ramp deliberately includes Flarepop at cat-3, so a piece with three
 * or more groups can paint an ordinary group in the exact hue it also uses to
 * mark its finding, and the reader is given two peaks to choose from.
 */
export function resolveAccent(el) {
  if (typeof getComputedStyle !== 'function') return '';
  const c = getComputedStyle(el);
  return (c.getPropertyValue('--_accent') || c.getPropertyValue('--vf-accent') || '').trim();
}

/**
 * A blank label is real data — it just cannot go on a mark nameless. Shared by
 * every family shaper so the same table reads the same way in every form.
 */
export const UNLABELLED = '(unlabelled)';

/** Rough advance width for the house sans at a given size. Measured, not guessed. */
export const textWidth = (s, fontPx) => String(s).length * fontPx * 0.56;

/**
 * A label that fits the space it is given, or nothing.
 *
 * Marks whose size IS the data will be too small for their own names, and a
 * name that overflows does not merely look untidy — it lands on the
 * neighbouring mark and appears to label that one instead. An ellipsis is
 * honest; a name painted across two tiles is not. Returns null when even a
 * truncation would be unreadable: the tooltip still carries the full name.
 *
 * Lives here rather than in a shaper because two families now need it, and two
 * copies of the same helper in one inlined export is a name collision.
 */
export function fitText(name, maxPx, fontPx) {
  const per = fontPx * 0.56;
  const room = Math.floor(maxPx / per);
  if (room < 4) return null;
  const s = String(name);
  if (s.length <= room) return s;
  return `${s.slice(0, Math.max(3, room - 1)).trimEnd()}…`;
}

/**
 * Category name -> colour, with the accent hue RESERVED for the one the
 * headline names.
 *
 * The house ramp deliberately contains the accent (Flarepop sits at
 * --vf-cat-3), and a form that also marks its finding with the accent then has
 * two peaks on screen. Worse with more categories than colours: the ramp wraps,
 * so several unrelated categories come out in it.
 *
 * So the star takes the accent, and every other name is drawn from the ramp
 * WITHOUT it. When the ramp has no accent in it, or there is no star, this is
 * exactly the plain wrap-around assignment.
 */
/**
 * Names that say "this number is a ratio, an average or a score" — the kinds of
 * quantity that DO NOT ADD UP. Deliberately about the COLUMN NAME: a shaper
 * cannot tell 12 dollars from 12 dollars-per-seat by looking at the numbers.
 *
 * Lives here, in the one file every bundle inlines first, because more than one
 * shaper needs it and two copies of a regex is two things to keep in step. A
 * form that sums a rate is claiming a total that does not exist, so whoever
 * aggregates has to be able to ask.
 */
const RATE_NAME = /(^|[\s_-])(per|rate|avg|average|mean|median|pct|percent|share|ratio|score|index|margin|multiple|nps|cagr)([\s_-]|$)|_per_|per_|%/i;

export function looksLikeRate(name) {
  return name !== undefined && name !== null && RATE_NAME.test(String(name));
}

export function assignColors(names, colors, { accent, star } = {}) {
  const list = names && names.length ? names : [''];
  const norm = (c) => String(c || '').trim().toLowerCase();
  const hasAccent = Boolean(accent) && colors.some((c) => norm(c) === norm(accent));
  if (!hasAccent || !star || !list.includes(star)) {
    return new Map(list.map((n, i) => [n, colors[i % colors.length]]));
  }
  const rest = colors.filter((c) => norm(c) !== norm(accent));
  const pool = rest.length ? rest : colors;
  const map = new Map();
  let i = 0;
  for (const name of list) {
    if (name === star) { map.set(name, accent); continue; }
    map.set(name, pool[i % pool.length]);
    i += 1;
  }
  return map;
}

/** Resolves the categorical palette, honouring --vf-cat-N overrides. */
export function resolveCategories(el, count) {
  const computed = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const override = computed ? computed.getPropertyValue(`--vf-cat-${i + 1}`).trim() : '';
    out.push(override || THEME_DEFAULTS.cat[i % THEME_DEFAULTS.cat.length]);
  }
  return out;
}

export function showTip(tip, html, x, y) {
  tip.innerHTML = html;
  tip.style.left = `${x}px`;
  tip.style.top = `${y - 10}px`;
  tip.style.opacity = '1';
}

export function hideTip(tip) {
  tip.style.opacity = '0';
}

// ---------------------------------------------------------------------------
// MOTION — the build-and-rest engine
//
// WHY THIS EXISTS. A module drew instantly and then sat perfectly still, while
// every piece in the deployed gallery assembles over three to five seconds in a
// way native to its own form and then keeps a quiet rest state running
// afterwards. That difference is most of what separates the two. The gallery's
// engine is demo/builders/anim2.js; this is its behaviour rebuilt for modules,
// with three differences the envelope forces:
//
//   - NO d3. A module may not pull a library into a host page, so the tween
//     driver, the easing and the staggering all live here.
//   - ONE rAF FOR THE PAGE. Every build and every rest across every mounted
//     module shares a single ticker, which stops itself the moment it is idle.
//   - RESTORE IS MANDATORY. anim2 runs once, inside a page it owns. A module
//     redraws on resize, on a legend click, on new data — so every build
//     records what it touched and can be jumped to its finished state at any
//     moment. An interrupted entrance must never strand a mark at opacity 0.
//     That is the failure this whole design is arranged around: a blank chart
//     behind a green test suite.
//
// TWO RULES CARRIED OVER FROM anim2, both honesty rather than taste:
//   1. A REST IS PAINT-ONLY OR OVERLAY-ONLY. Opacity may breathe and a tracer
//      dot may travel the line, but the geometry of an encoding never moves at
//      rest — a mark that drifts is a value that appears to have changed.
//   2. REDUCED MOTION RENDERS COMPLETE AND STILL. Not a faster build: no build.
//      `config.static` (set by the PNG renderer) takes the same path, so a
//      raster can never catch a half-assembled chart.
// ---------------------------------------------------------------------------

/** The house easing — sine in-out, long and soft (assets/snippets/easing.js). */
export function easeSinInOut(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

const tickerJobs = new Set();
let tickerRunning = false;

function tickerFrame(now) {
  tickerRunning = false;
  for (const job of [...tickerJobs]) {
    let keep = false;
    // A throwing job is dropped rather than killing the frame: one module's
    // dead node reference must not stop every other module's animation.
    try { keep = job(now) !== false; } catch (err) { keep = false; }
    if (!keep) tickerJobs.delete(job);
  }
  if (tickerJobs.size) {
    tickerRunning = true;
    requestAnimationFrame(tickerFrame);
  }
}

function addJob(job) {
  tickerJobs.add(job);
  if (!tickerRunning) {
    tickerRunning = true;
    requestAnimationFrame(tickerFrame);
  }
  return job;
}

/**
 * A set of staggered tweens sharing one start timestamp and one rAF entry.
 *
 * The shared clock is the point: `delay` is measured from the first frame of
 * the whole build, so a fifty-line stagger stays exact instead of drifting by
 * however many frames each tween happened to be created on.
 */
function createTimeline() {
  const items = [];
  let t0 = null;
  let job = null;
  let span = 0;

  return {
    add(delay, dur, fn) {
      items.push({ delay, dur, step: fn, done: false });
      span = Math.max(span, delay + dur);
      return this;
    },
    get span() { return span; },
    run() {
      if (!items.length) return;
      job = addJob((now) => {
        if (t0 === null) t0 = now;
        const elapsed = now - t0;
        let alive = false;
        for (const item of items) {
          if (item.done) continue;
          const local = elapsed - item.delay;
          if (local < 0) { alive = true; continue; }
          const raw = item.dur <= 0 ? 1 : Math.min(1, local / item.dur);
          item.step(easeSinInOut(raw), raw);
          if (raw >= 1) item.done = true;
          else alive = true;
        }
        return alive;
      });
    },
    /**
     * Jumps every unfinished tween to its end state. Called on teardown, on a
     * redraw, and on a data update — the guarantee that a build in flight
     * cannot leave a mark invisible.
     */
    finish() {
      if (job) tickerJobs.delete(job);
      job = null;
      for (const item of items) {
        if (item.done) continue;
        item.done = true;
        try { item.step(1, 1); } catch (err) { /* node already gone */ }
      }
      items.length = 0;
    },
  };
}

// --- element helpers -------------------------------------------------------

function lengthOf(node) {
  try { return node.getTotalLength(); } catch (err) { return 0; }
}

/** Stroke-only paths — the ones that can be drawn along their own length. */
function strokeLines(svg) {
  return [...svg.querySelectorAll('path')].filter((n) => {
    const fill = n.getAttribute('fill');
    return (fill === null || fill === 'none') && n.getAttribute('stroke');
  });
}

function dashPrep(node, store) {
  const len = lengthOf(node);
  if (!len) return 0;
  store.set(node, { kind: 'dash', len });
  node.style.strokeDasharray = String(len);
  node.style.strokeDashoffset = String(len);
  return len;
}

function dashDone(node) {
  node.style.strokeDasharray = '';
  node.style.strokeDashoffset = '';
}

function fadePrep(node) {
  node.style.opacity = '0';
}

function fadeStep(node) {
  return (eased, raw) => {
    node.style.opacity = raw >= 1 ? '' : String(eased);
  };
}

/**
 * GEOMETRY ONLY. NO OPACITY.
 *
 * These two used to fade a mark in as they scaled it (`opacity = eased * 2.2`),
 * and that pairing is what made every build read as "fade and float" instead of
 * as the form assembling. A mark at scale 0.001 is already invisible — fading it
 * as well adds nothing except the impression that it drifted in from nowhere.
 * The gallery engine's own `popPrep` sets a transform and nothing else, which is
 * why its entrances feel like growth. Seven builds inherit this: grow, rain,
 * tiles, rise, count, sankey, emerge.
 */
function scalePrep(node, origin, axis) {
  node.style.transformBox = 'fill-box';
  node.style.transformOrigin = origin;
  node.style.transform = axis === 'y' ? 'scaleY(0.001)' : axis === 'x' ? 'scaleX(0.001)' : 'scale(0.001)';
}

function scaleStep(node, axis) {
  return (eased, raw) => {
    if (raw >= 1) {
      node.style.transform = '';
      node.style.transformBox = '';
      node.style.transformOrigin = '';
      return;
    }
    const v = Math.max(0.001, eased);
    node.style.transform = axis === 'y' ? `scaleY(${v})` : axis === 'x' ? `scaleX(${v})` : `scale(${v})`;
  };
}

/** Circles enter by radius rather than transform — no transform-box needed. */
function radiusPrep(node, store) {
  const r = Number(node.getAttribute('r')) || 0;
  if (!r) return 0;
  store.set(node, { kind: 'radius', r });
  node.setAttribute('r', '0');
  return r;
}

function radiusStep(node, r) {
  return (eased, raw) => {
    node.setAttribute('r', String(raw >= 1 ? r : r * eased));
  };
}

function textsOf(svg) {
  return [...svg.querySelectorAll('text')];
}

/** Fades the labelling in as one late pass — the chart writes itself last. */
function addTextPass(svg, tl, dur) {
  const texts = textsOf(svg);
  texts.forEach((t) => fadePrep(t));
  texts.forEach((t, i) => {
    tl.add(dur * 0.48 + (i % 12) * 18, dur * 0.34, fadeStep(t));
  });
}

function xOf(node) {
  const cx = node.getAttribute('cx');
  if (cx !== null) return Number(cx) || 0;
  const x = node.getAttribute('x');
  if (x !== null) return Number(x) || 0;
  try { const b = node.getBBox(); return b.x + b.width / 2; } catch (err) { return 0; }
}

function fraction(values, v) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi === lo ? 0.5 : (v - lo) / (hi - lo);
}

/**
 * A mark's drawn area, read off its own attributes first.
 *
 * getBBox() would answer for every shape, but it forces layout per mark and
 * returns zeros for anything not yet laid out — and an area-ordered build over
 * a thousand tiles asks this question a thousand times. Rects and circles carry
 * their size in attributes, which is every mark the tiles build handles.
 */
function areaOf(node) {
  const r = Number(node.getAttribute('r'));
  if (Number.isFinite(r) && r > 0) return Math.PI * r * r;
  const w = Number(node.getAttribute('width')) || 0;
  const h = Number(node.getAttribute('height')) || 0;
  if (w > 0 && h > 0) return w * h;
  try { const b = node.getBBox(); return b.width * b.height; } catch (err) { return 0; }
}

/** A mark's centre in user units — same attribute-first reasoning as areaOf. */
function centreOf(node) {
  const cx = Number(node.getAttribute('cx'));
  const cy = Number(node.getAttribute('cy'));
  if (Number.isFinite(cx) && Number.isFinite(cy)) return { x: cx, y: cy };
  const x = Number(node.getAttribute('x'));
  const y = Number(node.getAttribute('y'));
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return {
      x: x + (Number(node.getAttribute('width')) || 0) / 2,
      y: y + (Number(node.getAttribute('height')) || 0) / 2,
    };
  }
  try { const b = node.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } catch (err) { return { x: 0, y: 0 }; }
}

// --- builds ----------------------------------------------------------------
//
// Each build is { prep, run }. `prep` runs synchronously at attach so the piece
// is never painted complete-then-hidden; `run` fills a timeline that plays when
// the piece scrolls into view.

const BUILDS = {
  /**
   * TRACE — lines draw along their own length, led by a travelling dot, and
   * the marks arrive left to right behind them. A time series assembling in
   * the direction it is read.
   */
  trace: {
    prep(svg, store) {
      strokeLines(svg).forEach((n) => dashPrep(n, store));
      [...svg.querySelectorAll('circle')].forEach((n) => radiusPrep(n, store));
    },
    run(svg, ctx, store) {
      const { tl, dur, spec } = ctx;
      const paths = strokeLines(svg).filter((n) => store.has(n));
      const per = paths.length ? (dur * 0.72) / (1 + (paths.length - 1) * 0.42) : dur * 0.72;
      // The leading dot is a nice reading cue on six lines and visual noise on
      // sixty, so a dense form turns it off.
      const lead = spec.lead !== false && paths.length <= 12;

      paths.forEach((node, i) => {
        const { len } = store.get(node);
        const dot = lead
          ? svgEl('circle', { r: 3.4, fill: node.getAttribute('stroke') || 'currentColor', opacity: 0 })
          : null;
        if (dot) node.parentNode.appendChild(dot);
        tl.add(i * per * 0.42, per, (eased, raw) => {
          node.style.strokeDashoffset = String(len * (1 - eased));
          if (dot) {
            try {
              const p = node.getPointAtLength(len * eased);
              dot.setAttribute('cx', String(p.x));
              dot.setAttribute('cy', String(p.y));
            } catch (err) { /* degenerate path */ }
            dot.setAttribute('opacity', String(0.9 * Math.sin(Math.PI * Math.min(1, raw))));
          }
          if (raw >= 1) { dashDone(node); if (dot) dot.remove(); }
        });
      });

      const dots = [...svg.querySelectorAll('circle')].filter((n) => store.has(n) && store.get(n).kind === 'radius');
      const xs = dots.map(xOf);
      dots.forEach((node, i) => {
        const f = dots.length > 1 ? fraction(xs, xs[i]) : 0.5;
        tl.add(f * dur * 0.68, 560, radiusStep(node, store.get(node).r));
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * GROW — bars rise from their own baseline, staggered along the category
   * axis. The direction comes from the module (`data-vf-grow`), because only
   * the module knows which edge is the zero line.
   */
  grow: {
    prep(svg) {
      [...svg.querySelectorAll('rect[data-vf-grow]')].forEach((n) => {
        const dir = n.getAttribute('data-vf-grow');
        const origin = dir === 'down' ? '50% 0%' : dir === 'left' ? '100% 50%' : dir === 'right' ? '0% 50%' : '50% 100%';
        scalePrep(n, origin, dir === 'left' || dir === 'right' ? 'x' : 'y');
      });
      [...svg.querySelectorAll('[data-vf-part="rule"]')].forEach(fadePrep);
    },
    run(svg, ctx) {
      const { tl, dur } = ctx;
      const bars = [...svg.querySelectorAll('rect[data-vf-grow]')];
      const keys = bars.map((n) => Number(n.getAttribute('data-vf-order')) || 0);
      bars.forEach((node, i) => {
        const dir = node.getAttribute('data-vf-grow');
        const f = bars.length > 1 ? fraction(keys, keys[i]) : 0;
        tl.add(f * dur * 0.5, dur * 0.42, scaleStep(node, dir === 'left' || dir === 'right' ? 'x' : 'y'));
      });
      // A rule marks a value against a bar, so it lands once that bar exists.
      [...svg.querySelectorAll('[data-vf-part="rule"]')].forEach((node, i) => {
        tl.add(dur * 0.62 + i * 40, dur * 0.3, fadeStep(node));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * BLOOM — a radial form opens outward from its own centre, then its points
   * land. Scaling the whole group about the plot's centre (not each shape
   * about its own bounding box) is what makes it read as a radar opening
   * rather than a set of polygons inflating.
   */
  bloom: {
    prep(svg, store, spec) {
      const group = svg.querySelector('[data-vf-bloom]');
      if (!group) return;
      const [ox, oy] = spec.origin || [0, 0];
      group.style.transformBox = 'view-box';
      group.style.transformOrigin = `${ox}px ${oy}px`;
      group.style.transform = 'scale(0.02)';
      [...svg.querySelectorAll('[data-vf-bloom] circle')].forEach((n) => radiusPrep(n, store));
      [...strokeLines(svg), ...svg.querySelectorAll('line')]
        .filter((n) => !group.contains(n))
        .forEach((n) => dashPrep(n, store));
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;

      // The web is drawn first: the frame arrives, then the reading opens into it.
      const web = [...strokeLines(svg), ...svg.querySelectorAll('line')]
        .filter((n) => store.has(n) && store.get(n).kind === 'dash');
      web.forEach((node, i) => {
        const { len } = store.get(node);
        tl.add(i * 26, dur * 0.3, (eased, raw) => {
          node.style.strokeDashoffset = String(len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      const group = svg.querySelector('[data-vf-bloom]');
      if (group) {
        tl.add(dur * 0.18, dur * 0.52, (eased, raw) => {
          if (raw >= 1) {
            group.style.transform = '';
            group.style.transformBox = '';
            group.style.transformOrigin = '';
            return;
          }
          group.style.transform = `scale(${Math.max(0.02, eased)})`;
        });
      }

      const dots = [...svg.querySelectorAll('[data-vf-bloom] circle')].filter((n) => store.has(n));
      dots.forEach((node, i) => {
        tl.add(dur * 0.5 + i * 22, 520, radiusStep(node, store.get(node).r));
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * RAIN — the summary assembles, then the sample it summarises falls in
   * behind it: median, box, whiskers, then every raw value. Parts are named by
   * the module through `data-vf-part`, because "which line is the median" is
   * not recoverable from the DOM.
   */
  rain: {
    prep(svg, store) {
      // THE DENSITY CURVE RISES OFF ITS OWN BASELINE. It is the body of the form
      // (a raincloud has nothing else), so it enters first and geometrically:
      // scaling from the row's floor is the curve being measured out of the axis,
      // where a fade would be the picture of a curve arriving.
      svg.querySelectorAll('[data-vf-part="violin"]').forEach((n) => scalePrep(n, '50% 100%', 'y'));
      svg.querySelectorAll('[data-vf-part="median"]').forEach((n) => dashPrep(n, store));
      svg.querySelectorAll('[data-vf-part="whisker"]').forEach((n) => dashPrep(n, store));
      svg.querySelectorAll('[data-vf-part="box"]').forEach((n) => scalePrep(n, '50% 50%', 'y'));
      svg.querySelectorAll('[data-vf-part="dot"], [data-vf-part="outlier"]').forEach((n) => {
        n.style.opacity = '0';
        n.style.transform = 'translateY(-22px)';
      });
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;

      // Rows cascade, and each curve takes longer than its slot so neighbouring
      // rows are rising together.
      [...svg.querySelectorAll('[data-vf-part="violin"]')].forEach((node, i, all) => {
        tl.add((i / Math.max(1, all.length)) * dur * 0.34, dur * 0.44, scaleStep(node, 'y'));
      });

      const medians = [...svg.querySelectorAll('[data-vf-part="median"]')];
      medians.forEach((node, i) => {
        const rec = store.get(node);
        if (!rec) return;
        tl.add(i * 90, dur * 0.22, (eased, raw) => {
          node.style.strokeDashoffset = String(rec.len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      [...svg.querySelectorAll('[data-vf-part="box"]')].forEach((node, i) => {
        tl.add(dur * 0.14 + i * 90, dur * 0.3, scaleStep(node, 'y'));
      });

      [...svg.querySelectorAll('[data-vf-part="whisker"]')].forEach((node, i) => {
        const rec = store.get(node);
        if (!rec) return;
        tl.add(dur * 0.3 + i * 26, dur * 0.26, (eased, raw) => {
          node.style.strokeDashoffset = String(rec.len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      const drops = [...svg.querySelectorAll('[data-vf-part="dot"], [data-vf-part="outlier"]')];
      const xs = drops.map(xOf);
      drops.forEach((node, i) => {
        const f = drops.length > 1 ? fraction(xs, xs[i]) : 0.5;
        tl.add(dur * 0.4 + f * dur * 0.42, 620, (eased, raw) => {
          if (raw >= 1) { node.style.opacity = ''; node.style.transform = ''; return; }
          node.style.opacity = String(eased);
          node.style.transform = `translateY(${(-22 * (1 - eased)).toFixed(2)}px)`;
        });
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * SWELL — stacked bands grow out of their own centre line, in order. A
   * streamgraph does not arrive, it fills: the band was always there and the
   * volume flows into it. Marked by the module with `data-vf-layer`.
   */
  swell: {
    prep(svg) {
      [...svg.querySelectorAll('[data-vf-layer]')].forEach((n) => {
        n.style.transformBox = 'fill-box';
        n.style.transformOrigin = '50% 50%';
        n.style.transform = 'scaleY(0.001)';
      });
    },
    run(svg, ctx) {
      const { tl, dur } = ctx;
      const layers = [...svg.querySelectorAll('[data-vf-layer]')];
      layers.forEach((node, i) => {
        tl.add(i * (dur * 0.5 / Math.max(1, layers.length)), dur * 0.5, scaleStep(node, 'y'));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * TILES — an area-encoded partition lands biggest-first. The large blocks
   * anchor the frame, the long tail fills in behind them, and the picture is
   * legible from the first second rather than at the end of the stagger.
   *
   * Ordering by AREA is the form's own logic: in a treemap or a circle pack the
   * area IS the value, so "biggest first" is "most important first". Marked by
   * the module with `data-vf-tile`, which is also what keeps a group frame or a
   * legend swatch out of the sequence unless the module wants it in.
   */
  tiles: {
    prep(svg, store) {
      [...svg.querySelectorAll('[data-vf-tile]')].forEach((n) => {
        // A circle enters by RADIUS. transform-box:fill-box on a circle is
        // correct in Chromium and wrong-ish elsewhere, and the radius route is
        // already the kit's answer for round marks.
        if (n.tagName === 'circle') radiusPrep(n, store);
        else scalePrep(n, '50% 50%');
      });
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;
      const marks = [...svg.querySelectorAll('[data-vf-tile]')]
        .map((n) => ({ n, a: areaOf(n) }))
        .sort((a, b) => b.a - a.a);
      const span = dur * 0.62;
      marks.forEach(({ n }, i) => {
        const at = (i / Math.max(1, marks.length)) * span;
        const rec = store.get(n);
        tl.add(at, dur * 0.3, rec && rec.kind === 'radius' ? radiusStep(n, rec.r) : scaleStep(n));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * RING — a radial partition sweeps round, ring by ring, from the centre out.
   * The inner level arrives first because the outer one is a subdivision OF it:
   * assembling the children before their parent would show a composition of
   * something that is not on screen yet.
   *
   * The module names each arc's level with `data-vf-ring` and its angular
   * position with `data-vf-order`. Neither is recoverable from the path data,
   * and guessing them from bounding boxes (which is what the gallery engine
   * does) mis-sorts every wedge that crosses the twelve o'clock line.
   */
  ring: {
    prep(svg, store, spec) {
      // GEOMETRY FIRST. This used to set opacity 0 and scale 0.92, which is a
      // fade plus an 8% float — the whole ring arriving from slightly too far
      // away, with nothing about it specific to a radial form. Where the module
      // offers a sweep, the wedges open through their own angle instead and
      // nothing is faded at all.
      if (spec.sweep) { spec.sweep.apply(-1, 0); return; }
      const [ox, oy] = spec.origin || [0, 0];
      [...svg.querySelectorAll('[data-vf-arc]')].forEach((n) => {
        n.style.transformBox = 'view-box';
        n.style.transformOrigin = `${ox}px ${oy}px`;
        n.style.transform = 'scale(0.001)';
      });
    },
    run(svg, ctx) {
      const { tl, dur, spec } = ctx;
      const arcs = [...svg.querySelectorAll('[data-vf-arc]')]
        .map((n, i) => ({
          n,
          ring: Number(n.getAttribute('data-vf-ring')) || 0,
          order: Number(n.getAttribute('data-vf-order')),
          i,
        }))
        .map((a) => ({ ...a, order: Number.isFinite(a.order) ? a.order : a.i }))
        .sort((a, b) => a.ring - b.ring || a.order - b.order);

      const perRing = new Map();
      for (const a of arcs) perRing.set(a.ring, (perRing.get(a.ring) || 0) + 1);
      const placed = new Map();

      arcs.forEach((a) => {
        const seen = placed.get(a.ring) || 0;
        placed.set(a.ring, seen + 1);
        const f = seen / Math.max(1, perRing.get(a.ring));
        const at = Math.min(a.ring, 2) * dur * 0.16 + f * dur * 0.44;
        // Each wedge takes longer than its slot in the stagger, so neighbours are
        // opening together and the ring is continuously in motion instead of
        // ticking through one finished shape at a time.
        tl.add(at, dur * 0.5, (eased, raw) => {
          if (spec.sweep) {
            spec.sweep.apply(a.i, raw >= 1 ? 1 : eased);
            return;
          }
          if (raw >= 1) {
            a.n.style.transform = '';
            a.n.style.transformBox = '';
            a.n.style.transformOrigin = '';
            return;
          }
          a.n.style.transform = `scale(${Math.max(0.001, eased).toFixed(4)})`;
        });
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * STRETCH — both ends of a pair land, then the gap draws itself between them.
   *
   * The gallery's entrance for a dumbbell, and the reason it belongs to that form
   * alone: the two markers are the measurements and the connector is the FINDING.
   * Growing the connector out of an axis (which is what `grow` did here for
   * months, because ranked-bar was drawing a bar) says the gap is a quantity
   * measured from zero. It is not — it is a distance between two positions, so it
   * can only honestly appear once both of its ends exist.
   *
   * Rows cascade by `data-vf-order`, and BOTH ends of a row share that order, so
   * a pair arrives together rather than one dot chasing the other.
   */
  stretch: {
    prep(svg, store) {
      [...svg.querySelectorAll('circle')].forEach((n) => radiusPrep(n, store));
      // Only the tagged connectors, never every line — the value gridlines are
      // also <line> and dash-drawing the grid animates the furniture.
      [...svg.querySelectorAll('[data-vf-part="connector"]')].forEach((n) => dashPrep(n, store));
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;
      const dots = [...svg.querySelectorAll('circle')].filter((n) => store.has(n));
      const dotKeys = dots.map((n) => Number(n.getAttribute('data-vf-order')) || 0);
      dots.forEach((node, i) => {
        const f = dots.length > 1 ? fraction(dotKeys, dotKeys[i]) : 0;
        tl.add(f * dur * 0.42, dur * 0.34, radiusStep(node, store.get(node).r));
      });

      const links = [...svg.querySelectorAll('[data-vf-part="connector"]')].filter((n) => store.has(n));
      const linkKeys = links.map((n) => Number(n.getAttribute('data-vf-order')) || 0);
      links.forEach((node, i) => {
        const { len } = store.get(node);
        const f = links.length > 1 ? fraction(linkKeys, linkKeys[i]) : 0;
        // Starts after its own row's dots have landed, not after all of them.
        tl.add(f * dur * 0.42 + dur * 0.26, dur * 0.4, (eased, raw) => {
          node.style.strokeDashoffset = String(len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * PETAL — a rose opens one wedge at a time, in the cycle's own order.
   *
   * NOT the same motion as BLOOM, and the difference is the whole point of the
   * form. Bloom scales the single group about the plot centre, so the rose
   * inflates as one object; petal scales each wedge about that same centre but
   * on its own schedule, so the cycle plays out in the order it is read —
   * January to December, hour by hour. Substituting bloom here was the port
   * losing a form-native entrance, which is the one thing the gallery's
   * animation engine set out to give every piece.
   *
   * Scaling about the SHARED view-box origin, not each path's own fill-box, is
   * what keeps a wedge growing outward along its own radius instead of
   * fattening in place. Angular order comes from the module as
   * `data-vf-order`, because a bounding box mis-sorts every wedge that crosses
   * twelve o'clock.
   */
  petal: {
    prep(svg, store, spec) {
      // THE MODULE'S OWN GEOMETRY, when it offers it. A petal's LENGTH is its
      // value, so the honest entrance grows the radius outward from the hub —
      // the mark draws itself the way the encoding reads. A transform scale
      // cannot do that: it shrinks the angular width too, so the rose reads as a
      // picture being zoomed rather than as petals extending. `spec.sweep` is the
      // same escape hatch `attract` uses — the module hands over a function that
      // redraws mark i at fraction t, because only the module has the arc
      // generator. Falling back to a scale when it does not.
      if (spec.sweep) { spec.sweep.apply(-1, 0); return; }
      const [ox, oy] = spec.origin || [0, 0];
      [...svg.querySelectorAll('[data-vf-petal]')].forEach((n) => {
        n.style.transformBox = 'view-box';
        n.style.transformOrigin = `${ox}px ${oy}px`;
        n.style.transform = 'scale(0.001)';
      });
    },
    run(svg, ctx) {
      const { tl, dur, spec } = ctx;
      const petals = [...svg.querySelectorAll('[data-vf-petal]')]
        .map((n, i) => {
          const order = Number(n.getAttribute('data-vf-order'));
          return { n, order: Number.isFinite(order) ? order : i, i };
        })
        .sort((a, b) => a.order - b.order);

      // Overlapping tweens on purpose: each petal takes 62% of the run while the
      // stagger spends only 46% of it, so the rose is always mid-gesture rather
      // than a queue of finished shapes. That overlap is most of what reads as
      // fluid.
      petals.forEach(({ n, i }, rank) => {
        const at = (rank / Math.max(1, petals.length)) * dur * 0.46;
        tl.add(at, dur * 0.62, (eased, raw) => {
          if (spec.sweep) {
            spec.sweep.apply(i, raw >= 1 ? 1 : eased);
            return;
          }
          if (raw >= 1) {
            n.style.transform = '';
            n.style.transformBox = '';
            n.style.transformOrigin = '';
            return;
          }
          n.style.transform = `scale(${Math.max(0.001, eased).toFixed(4)})`;
        });
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * RISE — stacked bands grow up off their own baseline, lowest row first.
   *
   * The difference from SWELL is where the motion is anchored. Swell scales a
   * layer about its middle, which suits a stream whose thickness reads outward
   * from a centreline. A horizon band is measured UP FROM ITS ROW'S FLOOR, so
   * scaling it about its middle shows it growing downward through its own
   * baseline for the first half of the entrance — a thing the encoding never
   * does. Anchoring at the bottom edge is the honest motion for a form whose
   * zero is at the bottom.
   */
  rise: {
    prep(svg) {
      [...svg.querySelectorAll('[data-vf-layer]')].forEach((n) => scalePrep(n, '50% 100%', 'y'));
    },
    run(svg, ctx) {
      const { tl, dur } = ctx;
      // TOP ROW FIRST, matching the gallery engine: a horizon is a stack of
      // rows read downward like a table, so the sequence follows the reading
      // order, not the direction each band grows. Order comes from the module
      // when it has one, otherwise from where the band actually sits.
      const layers = [...svg.querySelectorAll('[data-vf-layer]')]
        .map((n, i) => {
          const order = Number(n.getAttribute('data-vf-order'));
          return { n, key: Number.isFinite(order) ? order : centreOf(n).y, i };
        })
        .sort((a, b) => a.key - b.key || a.i - b.i);

      layers.forEach(({ n }, rank) => {
        const at = (rank / Math.max(1, layers.length)) * dur * 0.55;
        tl.add(at, dur * 0.45, scaleStep(n, 'y'));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * WAVE — a field of cells fades in along a diagonal, top-left to
   * bottom-right. For the grid forms (a calendar, a punchcard) where there is
   * no series to trace and no baseline to grow from: the plane simply fills,
   * in the direction the grid is read.
   */
  wave: {
    // GEOMETRY WHERE THE MARK HAS ANY, A FADE ONLY WHERE IT DOES NOT.
    //
    // A punchcard's cell is a CIRCLE whose area is the count, so it can grow —
    // and growing is what the encoding does. Fading it in was the laziest
    // reading of "a plane fills": it treated a sized mark as if it had no size.
    // A calendar's cell is a fixed square of colour with no magnitude in its
    // geometry, so there is genuinely nothing to grow and the diagonal fade is
    // the honest motion for it. Both still sweep on the same diagonal, so the
    // gesture across the grid is unchanged.
    prep(svg, store) {
      [...svg.querySelectorAll('[data-vf-cell]')].forEach((n) => {
        if (n.tagName === 'circle') radiusPrep(n, store);
        else fadePrep(n);
      });
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;
      const cells = [...svg.querySelectorAll('[data-vf-cell]')];
      if (!cells.length) return;
      const box = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : { width: 1, height: 1 };
      const span = (box.width + box.height) || 1;
      cells.forEach((node) => {
        const c = centreOf(node);
        const f = clamp((c.x + c.y) / span, 0, 1);
        const rec = store.get(node);
        // A grown mark gets a longer tween than a faded one — a radius settling
        // reads as arrival, where the same duration on an opacity ramp just
        // looks slow.
        if (rec && rec.kind === 'radius') tl.add(f * dur * 0.58, dur * 0.42, radiusStep(node, rec.r));
        else tl.add(f * dur * 0.62, dur * 0.3, fadeStep(node));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * COUNT — the units tally in, one after another, in reading order. A unit
   * chart's whole claim is that every mark is one thing and you can count
   * them, so its entrance counts them: fast per mark, long across the set.
   */
  count: {
    prep(svg, store) {
      [...svg.querySelectorAll('[data-vf-unit]')].forEach((n) => {
        if (n.tagName === 'circle') radiusPrep(n, store);
        else scalePrep(n, '50% 50%');
      });
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;
      const units = [...svg.querySelectorAll('[data-vf-unit]')]
        .map((n) => ({ n, c: centreOf(n) }))
        .sort((a, b) => (a.c.y - b.c.y) * 1000 + (a.c.x - b.c.x));
      const span = dur * 0.82;
      units.forEach(({ n }, i) => {
        const rec = store.get(n);
        tl.add((i / Math.max(1, units.length)) * span, 220,
          rec && rec.kind === 'radius' ? radiusStep(n, rec.r) : scaleStep(n));
      });
      addTextPass(svg, tl, dur);
    },
  },

  /**
   * SANKEY — the columns stand up left to right, and the volume runs into them
   * behind. A flow diagram is read in the direction it flows, so it assembles
   * that way: a ribbon cannot arrive before the node it leaves.
   *
   * The module marks its parts (`data-vf-node`, `data-vf-link`) because a
   * sankey's links and its node rects are indistinguishable from any other
   * path and rect in the DOM.
   */
  sankey: {
    prep(svg, store) {
      [...svg.querySelectorAll('[data-vf-node]')].forEach((n) => scalePrep(n, '50% 50%', 'y'));
      [...svg.querySelectorAll('[data-vf-link]')].forEach((n) => dashPrep(n, store));
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;

      const nodes = [...svg.querySelectorAll('[data-vf-node]')];
      const nodeXs = nodes.map(xOf);
      nodes.forEach((node, i) => {
        const f = nodes.length > 1 ? fraction(nodeXs, nodeXs[i]) : 0;
        tl.add(f * dur * 0.42, dur * 0.28, scaleStep(node, 'y'));
      });

      const links = [...svg.querySelectorAll('[data-vf-link]')].filter((n) => store.has(n));
      const linkXs = links.map((n) => {
        try { return n.getBBox().x; } catch (err) { return 0; }
      });
      links.forEach((node, i) => {
        const { len } = store.get(node);
        const f = links.length > 1 ? fraction(linkXs, linkXs[i]) : 0;
        tl.add(dur * 0.12 + f * dur * 0.48, dur * 0.34, (eased, raw) => {
          node.style.strokeDashoffset = String(len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      addTextPass(svg, tl, dur);
    },
  },

  /**
   * EMERGE — the enclosing frame is drawn, then the points arrive in the depth
   * order they are already painted in: back of the volume first, front last.
   */
  emerge: {
    prep(svg, store) {
      [...svg.querySelectorAll('line')].forEach((n) => dashPrep(n, store));
      [...svg.querySelectorAll('circle')].forEach((n) => radiusPrep(n, store));
      // A PIECE THAT DRAWS BARS AS WELL AS MARKS HAS TO BRING THEM BOTH IN.
      // The linked brush is a scatter beside a set of bars, and emerge only
      // knew about lines and circles — so its dots animated in from r=0 while
      // its bars were simply present from the first frame, fully drawn. Half a
      // piece with an entrance reads worse than none, and nothing failed: the
      // bars were correct, visible, and untouched. Additive here, because the
      // other two forms on emerge (contour, data cube) tag no bars at all.
      [...svg.querySelectorAll('rect[data-vf-grow]')].forEach((n) => {
        const dir = n.getAttribute('data-vf-grow');
        const origin = dir === 'down' ? '50% 0%' : dir === 'left' ? '100% 50%' : dir === 'right' ? '0% 50%' : '50% 100%';
        scalePrep(n, origin, dir === 'left' || dir === 'right' ? 'x' : 'y');
      });
    },
    run(svg, ctx, store) {
      const { tl, dur } = ctx;
      const bars = [...svg.querySelectorAll('rect[data-vf-grow]')];
      const barKeys = bars.map((n) => Number(n.getAttribute('data-vf-order')) || 0);
      bars.forEach((node, i) => {
        const dir = node.getAttribute('data-vf-grow');
        const f = bars.length > 1 ? fraction(barKeys, barKeys[i]) : 0;
        tl.add(f * dur * 0.45, dur * 0.4, scaleStep(node, dir === 'left' || dir === 'right' ? 'x' : 'y'));
      });

      const lines = [...svg.querySelectorAll('line')].filter((n) => store.has(n));
      lines.forEach((node, i) => {
        const { len } = store.get(node);
        tl.add(i * 22, dur * 0.34, (eased, raw) => {
          node.style.strokeDashoffset = String(len * (1 - eased));
          if (raw >= 1) dashDone(node);
        });
      });

      const dots = [...svg.querySelectorAll('circle')].filter((n) => store.has(n));
      dots.forEach((node, i) => {
        const f = dots.length > 1 ? i / (dots.length - 1) : 0.5;
        tl.add(dur * 0.3 + f * dur * 0.55, 540, radiusStep(node, store.get(node).r));
      });

      addTextPass(svg, tl, dur);
    },
  },
};

// --- rests -----------------------------------------------------------------
//
// Paint-only or overlay-only, always. Each returns a teardown.

const RESTS = {
  /** A faint dot re-reads the longest line, slowly, forever. */
  tracer(svg, spec, ctx) {
    const candidates = strokeLines(svg).filter((n) => lengthOf(n) > 120);
    if (!candidates.length) return null;
    const path = candidates.reduce((a, b) => (lengthOf(b) > lengthOf(a) ? b : a));
    const len = lengthOf(path);
    const period = spec.period || 16000;
    const dot = svgEl('circle', {
      r: 3, fill: path.getAttribute('stroke') || 'var(--_accent)', opacity: 0,
    });
    path.parentNode.appendChild(dot);

    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const t = (now % period) / period;
      try {
        const p = path.getPointAtLength(len * t);
        dot.setAttribute('cx', String(p.x));
        dot.setAttribute('cy', String(p.y));
      } catch (err) { return false; }
      dot.setAttribute('opacity', String(0.5 * Math.sin(Math.PI * t)));
      return true;
    });

    return () => { tickerJobs.delete(job); dot.remove(); };
  },

  /**
   * The marks the piece is actually about breathe. This is the module form of
   * the gallery's "Flarepop where the story peaks" law: emphasis stays alive
   * without anything else moving.
   */
  peak(svg, spec, ctx) {
    const els = [...svg.querySelectorAll(spec.select || '[data-vf-peak]')];
    if (!els.length) return null;
    const period = spec.period || 5600;
    const job = addJob((now) => {
      if (!ctx.live()) return true;
      els.forEach((n, i) => {
        // In phase by default: two marks that describe the SAME thing must
        // breathe together or they read as two separate signals.
        const t = ((now + i * (spec.stagger || 0)) % period) / period;
        n.style.opacity = String(1 - 0.22 * Math.sin(Math.PI * t) ** 2);
      });
      return true;
    });

    return () => {
      tickerJobs.delete(job);
      els.forEach((n) => { n.style.opacity = ''; });
    };
  },

  /**
   * A time cursor scans the plot, re-reading the axis and touching nothing.
   * Overlay-only: it is drawn on top and moves no mark.
   */
  timescan(svg, spec, ctx) {
    const host = svg.querySelector('[data-vf-scan]') || svg;
    const box = spec.box;
    if (!box) return null;
    const line = svgEl('line', {
      y1: box.top, y2: box.bottom, stroke: 'var(--_ink)', 'stroke-width': 1, opacity: 0,
    });
    host.appendChild(line);
    const period = spec.period || 22000;
    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const t = (now % period) / period;
      const x = box.left + (box.right - box.left) * easeSinInOut(t);
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('opacity', String(0.16 * Math.sin(Math.PI * t)));
      return true;
    });
    return () => { tickerJobs.delete(job); line.remove(); };
  },

  /**
   * FLOW — faint particles drift along the heaviest ribbons, so a funnel keeps
   * moving without a single mark changing size or place. Overlay-only: the
   * dots are added on top and removed on teardown.
   *
   * Deterministic by construction — the offsets and speeds come from each
   * particle's index, never from Math.random, because a PNG of this piece has
   * to be reproducible byte for byte.
   */
  flow(svg, spec, ctx) {
    const links = [...svg.querySelectorAll(spec.select || '[data-vf-link]')]
      .map((n) => ({ n, w: Number(n.getAttribute('stroke-width')) || 0 }))
      .filter((d) => d.w > 2)
      .sort((a, b) => b.w - a.w)
      .slice(0, 12);
    if (!links.length) return null;

    const count = Math.min(6, links.length * 2);
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const link = links[i % links.length];
      const dot = svgEl('circle', {
        r: 2.4,
        fill: link.n.getAttribute('stroke') || 'var(--_accent)',
        opacity: 0,
      });
      link.n.parentNode.appendChild(dot);
      parts.push({ dot, path: link.n, off: (i * 0.37) % 1, speed: 6500 + (i % 3) * 1300 });
    }

    const job = addJob((now) => {
      if (!ctx.live()) return true;
      for (const p of parts) {
        const t = ((now / p.speed) + p.off) % 1;
        try {
          const len = p.path.getTotalLength();
          const at = p.path.getPointAtLength(len * t);
          p.dot.setAttribute('cx', String(at.x));
          p.dot.setAttribute('cy', String(at.y));
        } catch (err) { return false; }
        p.dot.setAttribute('opacity', String(0.55 * Math.sin(Math.PI * t)));
      }
      return true;
    });

    return () => { tickerJobs.delete(job); parts.forEach((p) => p.dot.remove()); };
  },

  /**
   * WAVEBREATHE — a slow diagonal shimmer across a field of marks. For the
   * forms that are a SURFACE rather than a set of series (a packed field, a
   * heat grid): nothing to spotlight one at a time, but the field should not
   * read as a dead image either.
   *
   * Phase comes from each mark's own position, so the shimmer travels rather
   * than pulsing everything at once — and it is opacity only, a MULTIPLIER over
   * whatever the encoding already painted.
   */
  /**
   * RIPPLE — the same shimmer as wavebreathe, phased by AREA instead of by
   * position: biggest shape first, so the pulse runs from the broad outer band
   * inward to the tightest peak and the islands read as rising.
   *
   * A contour map has no reading direction — the diagonal sweep wavebreathe
   * uses is meaningless over nested rings, because two rings of the same
   * elevation sit on opposite sides of the frame and would breathe out of step.
   * Nesting order IS elevation here, and area is how you recover it.
   */
  ripple(svg, spec, ctx) {
    const els = [...svg.querySelectorAll(spec.select || '[data-vf-shimmer]')];
    if (els.length < 3) return null;
    const ranked = els
      .map((n, i) => ({ n, a: areaOf(n), i }))
      .sort((a, b) => b.a - a.a);
    const period = spec.period || 10000;
    const depth = spec.depth || 0.2;
    // 0.6 of a period across the whole stack, so the wave is visibly travelling
    // rather than the whole map breathing at once.
    const phase = new Map();
    ranked.forEach(({ n }, rank) => {
      phase.set(n, (rank / Math.max(1, ranked.length - 1)) * 0.6);
    });

    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const base = now / period;
      for (const n of els) {
        const t = (((base - phase.get(n)) % 1) + 1) % 1;
        n.style.opacity = String(1 - depth * Math.sin(Math.PI * t) ** 2);
      }
      return true;
    });

    return () => {
      tickerJobs.delete(job);
      for (const n of els) n.style.opacity = '';
    };
  },

  wavebreathe(svg, spec, ctx) {
    const els = [...svg.querySelectorAll(spec.select || '[data-vf-shimmer]')];
    if (els.length < 3) return null;
    const box = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
    const span = box && box.width + box.height > 0 ? box.width + box.height : 1;
    const phase = els.map((n) => {
      const c = centreOf(n);
      return clamp((c.x + c.y) / span, 0, 1);
    });
    const period = spec.period || 9000;
    const depth = spec.depth || 0.2;

    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const base = now / period;
      for (let i = 0; i < els.length; i += 1) {
        const t = (((base - phase[i]) % 1) + 1) % 1;
        els[i].style.opacity = String(1 - depth * Math.sin(Math.PI * t) ** 2);
      }
      return true;
    });

    return () => {
      tickerJobs.delete(job);
      els.forEach((n) => { n.style.opacity = ''; });
    };
  },

  /**
   * ATTRACT — an interactive piece demonstrates its own interaction.
   *
   * A hover-driven form that sits inert until someone happens to mouse over it
   * looks identical to a static one, so the gallery's interactive tier previews
   * the gesture on a cycle. Unlike every other rest, this one cannot introspect
   * the SVG: only the module knows what "isolate this branch" means. So the
   * module supplies `spec.attract = { count, apply(i, amp), clear() }` and this
   * only runs the clock.
   *
   * `apply` MUST be paint-only — the same rule every rest obeys. Previewing a
   * DRILL (which changes what is on screen) would move the reader somewhere
   * they did not ask to go; previewing the emphasis is an invitation.
   *
   * Yielding to the real cursor is the module's job, through the motion
   * controller's hold()/free() handoff — the same one every hover handler uses.
   */
  attract(svg, spec, ctx) {
    const a = spec.attract;
    if (!a || !(a.count > 1) || typeof a.apply !== 'function') return null;
    const hold = spec.hold || 3400;
    const lift = spec.lift || 2200;
    let painted = false;

    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const i = Math.floor(now / hold) % a.count;
      const ph = (now % hold) / lift;
      if (ph >= 1) {
        // The gap between previews. Cleared exactly once, so a still piece is
        // not being repainted sixty times a second for two seconds.
        if (painted) { a.clear(); painted = false; }
        return true;
      }
      a.apply(i, easeSinInOut(Math.sin(Math.PI * ph)));
      painted = true;
      return true;
    });

    return () => {
      tickerJobs.delete(job);
      try { a.clear(); } catch (err) { /* the svg it painted is already gone */ }
    };
  },

  /** A soft spotlight walks the series in order — the chart reads itself. */
  walk(svg, spec, ctx) {
    let els = [...svg.querySelectorAll(spec.select || '[data-vf-walk]')];
    if (els.length < 3) return null;
    // A spotlight that visits two hundred threads one at a time takes four
    // minutes to come round and is invisible when it arrives. Past the cap it
    // samples evenly instead, so the light still travels across the plot.
    const max = spec.max || 20;
    if (els.length > max) {
      const step = els.length / max;
      els = Array.from({ length: max }, (_, i) => els[Math.floor(i * step)]);
    }
    const n = els.length;
    const period = Math.max(14000, n * 1200);

    // A MULTIPLIER on whatever the mark's own paint already is, never an
    // absolute. `style.opacity` composes with the stroke-opacity and
    // fill-opacity attributes the module set, so writing an absolute here
    // would quietly overrule the encoding's own weighting.
    const job = addJob((now) => {
      if (!ctx.live()) return true;
      const pos = ((now % period) / period) * n;
      for (let i = 0; i < n; i += 1) {
        let d = Math.abs(i - pos);
        d = Math.min(d, n - d);
        const w = Math.max(0, 1 - d / 1.6);
        els[i].style.opacity = String(0.7 + 0.3 * easeSinInOut(w));
      }
      return true;
    });

    return () => {
      tickerJobs.delete(job);
      els.forEach((node) => { node.style.opacity = ''; });
    };
  },
};

/**
 * Did the DATA change, or only the words around it?
 *
 * The Studio calls update() on every keystroke in the copy editor, so a blanket
 * motion.replay() there restarts a four-second entrance on each character
 * typed — the piece never finishes assembling while you write its headline.
 * A new headline is not a new piece; new numbers are.
 *
 * Identity comparison, deliberately, not a deep one: the caller hands back the
 * same rows array and the same bindings object when only copy moved, and this
 * runs at keystroke rate over what may be thousands of rows.
 */
export function dataChanged(prev, next) {
  if (!prev || !next) return true;

  const before = prev.data || prev.rows;
  const after = next.data || next.rows;
  if (before !== after) {
    if (!Array.isArray(before) || !Array.isArray(after)) return true;
    if (before.length !== after.length) return true;
    for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) return true;
  }

  const pb = prev.bindings || {};
  const nb = next.bindings || {};
  for (const key of new Set([...Object.keys(pb), ...Object.keys(nb)])) {
    const a = pb[key];
    const b = nb[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
    } else if (a !== b) return true;
  }
  return false;
}

/**
 * createMotion(el, config) -> controller
 *
 * `attach(svg, spec)` is called at the end of every draw. The FIRST attach
 * after a mount or an update plays the build; later attaches (a resize, a
 * legend toggle) only re-arm the rest, because an entrance that replays every
 * time the window changes width is noise rather than motion.
 */
export function createMotion(el, config = {}) {
  const enabled = config.motion !== false
    && !config.static
    && !prefersReducedMotion()
    && typeof requestAnimationFrame === 'function';

  let tl = null;
  let restStop = null;
  let current = null;
  let observer = null;
  let visible = typeof IntersectionObserver !== 'function';
  let pending = null;
  let built = false;
  let buildDone = false;
  let destroyed = false;
  let settleTimer = null;
  // Bumped by every attach. A settle callback from a superseded entrance must
  // not mark the CURRENT one finished or hang a rest on the svg it replaced.
  let generation = 0;

  // Off-screen pieces stop costing frames. The reader taking over is handled
  // by the explicit hold()/free() handoff below rather than by sniffing
  // :hover on the root — a :hover gate freezes a rest MID-CYCLE the moment the
  // cursor crosses the headline, stranding whatever it was animating at
  // whatever value that frame happened to hold.
  const live = () => visible && !destroyed;

  function clearRest() {
    if (restStop) { restStop(); restStop = null; }
  }

  function finishBuild() {
    if (tl) { tl.finish(); tl = null; }
  }

  function startRest(svg, spec) {
    clearRest();
    current = { svg, spec };
    if (!spec.rest || destroyed) return;
    const rest = RESTS[spec.rest];
    // Same silent failure as an unknown build, one step later: the piece
    // assembles correctly and then stops dead, which is indistinguishable from
    // a piece that was never given a rest.
    if (!rest) {
      if (typeof console !== 'undefined') {
        console.warn(`vf-core: no rest named "${spec.rest}" — this piece will sit still once it has drawn.`);
      }
      return;
    }
    try {
      restStop = rest(svg, spec, { live }) || null;
    } catch (err) {
      restStop = null;
    }
  }

  function play() {
    if (!pending) return;
    const { svg, spec, store } = pending;
    const gen = generation;
    pending = null;
    const build = BUILDS[spec.build];
    tl = createTimeline();
    try {
      build.run(svg, { tl, dur: spec.dur || 4000, spec }, store);
    } catch (err) {
      tl.finish();
      tl = null;
      startRest(svg, spec);
      return;
    }
    const span = tl.span;
    tl.run();
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (gen !== generation || destroyed) return;
      finishBuild();
      buildDone = true;
      startRest(svg, spec);
    }, span + 240);
  }

  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && pending) play();
    }, { threshold: 0.2 });
    observer.observe(el);
  }

  return {
    get enabled() { return enabled; },

    attach(svg, spec = {}) {
      // Whatever was animating belonged to an svg that no longer exists.
      generation += 1;
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
      finishBuild();
      clearRest();
      pending = null;
      if (!enabled || destroyed) return;

      // A REDRAW DURING THE ENTRANCE RESTARTS IT on the new geometry rather
      // than snapping to complete. The first draw of a fit:"height" module can
      // land before the flex layout has given the plot its height, so the real
      // draw is the second one — and treating that as "already built" is how a
      // module ends up with no visible entrance at all, intermittently, on
      // exactly the layouts where the height is computed rather than given.
      // An unknown build name is a SILENT no-entrance — the piece just draws
      // instantly and nothing says why. Name it.
      if (spec.build && !BUILDS[spec.build] && typeof console !== 'undefined') {
        console.warn('vf-core: no build named "' + spec.build + '" — this piece will not animate in.');
      }
      if ((built && buildDone) || !spec.build || !BUILDS[spec.build]) {
        startRest(svg, spec);
        return;
      }

      built = true;
      buildDone = false;
      const store = new Map();
      try {
        BUILDS[spec.build].prep(svg, store, spec);
      } catch (err) {
        startRest(svg, spec);
        return;
      }
      pending = { svg, spec, store };
      if (visible) play();
    },

    /**
     * hold() / free() — the explicit handoff of the paint to the reader.
     *
     * A module whose hover handler writes the same property a rest writes
     * (opacity, for every rest in the kit) MUST call hold() before it repaints
     * and free() when the cursor leaves. hold() tears the rest down, which
     * restores every mark synchronously, so the handler paints onto a clean
     * slate; free() builds a fresh one. Anything less is a race that shows up
     * as one mark refusing to dim with its siblings.
     */
    hold() { clearRest(); },
    free() { if (current && !destroyed) startRest(current.svg, current.spec); },

    /** New data is a new piece: let it introduce itself again. */
    replay() { built = false; buildDone = false; },

    destroy() {
      destroyed = true;
      generation += 1;
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
      finishBuild();
      clearRest();
      pending = null;
      if (observer) { observer.disconnect(); observer = null; }
    },
  };
}
