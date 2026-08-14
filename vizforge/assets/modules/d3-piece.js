// assets/modules/d3-piece.js
//
// THE HARNESS THAT TURNS A GALLERY PIECE INTO A PORTABLE MODULE.
//
// The 32 animated pieces in the Fritz gallery are hand-written D3 over their
// own hardcoded `const ROWS = [...]`. Their drawing, their entrances and their
// hover states are already proven in front of clients — rewriting all of that
// dependency-free would take months and would produce something that merely
// resembles the gallery. So the port keeps the D3 and replaces only the two
// things that make a piece un-portable: the hardcoded data, and the assumption
// that it owns the page.
//
// WHAT A PORT LOOKS LIKE, therefore:
//
//   export default d3Piece({
//     slug: 'stream',
//     roles: {...},              // what columns it needs
//     shape(rows, bindings),     // rows -> the piece's own data structure
//     headline(stats),           // the finding, computed
//     draw(ctx),                 // the gallery's drawing code, near verbatim
//     build: 'swell', rest: 'timescan',
//   })
//
// and everything else — the frame, the theming, the resize, the tooltip, the
// build-and-rest animation, destroy/update — comes from here.
//
// THE D3 DEPENDENCY IS REAL AND IS DECLARED. `vf-core.js` is dependency-free by
// design and stays that way; this file sits beside it and reads `globalThis.d3`.
// A page that mounts a d3 piece must provide d3 first. The export path handles
// that by inlining it (see scripts/build-embed.mjs), and the Studio loads it
// once. `hasD3()` lets a caller check rather than crash.
//
// COLOUR: pieces take their series colours from --vf-cat-1..6 through
// resolveCategories, and their emphasis from --vf-accent, so a gallery piece
// dropped into a host page follows that page's theme like every other module.

import {
  buildFrame, observeSize, resolveCategories, createMotion, dataChanged,
  showTip, hideTip, interactionNote, formatNumber, renderTrail, textWidth, fitText,
} from './vf-core.js';

export function hasD3() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.d3);
}

function d3OrThrow() {
  if (!hasD3()) {
    throw new Error(
      'd3-piece: this module needs d3 on the page. The Studio loads it from '
      + '/assets/vendor/d3.min.js and the export inlines it; a hand-written embed must '
      + 'include it before mounting.'
    );
  }
  return globalThis.d3;
}

/**
 * d3Piece(spec) -> { slug, roles, shape, validate, mount }
 *
 * The returned object satisfies the same contract as a hand-rolled module, so
 * the Studio, the export builder and the PNG renderer cannot tell the two
 * apart.
 */
export function d3Piece(spec) {
  const {
    slug, roles, shape, headline, dek, note,
    draw, build = null, rest = null, restSelect = null,
    aspect = 0.52, minHeight = 260, validate,
  } = spec;

  function normalize(config) {
    const rows = Array.isArray(config.data) ? config.data : (config.rows || []);
    const bindings = config.bindings || {};
    const shaped = shape(rows, bindings, config.options || {});
    return { config, bindings, ...shaped };
  }

  function mount(el, config = {}) {
    let state = normalize(config);
    const motion = createMotion(el, config);
    // WHERE AN INTERACTION LIVES. draw() runs again on every resize, so a
    // drilled level or an isolated series held in a draw-local variable is lost
    // the first time the window changes width — and the piece silently jumps
    // back to the top of the hierarchy while the reader is reading it. `view`
    // is per-mount and survives redraws; it is reset when the DATA changes,
    // because a level of the old table means nothing in the new one.
    let view = {};

    function frameOpts() {
      return {
        legend: false,
        ariaLabel: spec.title || slug,
        defaultHeadline: headline ? headline(state.stats, state) : '',
        defaultDek: (dek ? dek(state.stats, state) : '')
          + interactionNote(config, (typeof spec.hoverNote === 'function'
            ? spec.hoverNote(state.config)
            : spec.hoverNote) || 'Hover for exact values.'),
        note: typeof note === 'function' ? note(state.stats, state) : note,
      };
    }

    let frame = buildFrame(el, state.config, frameOpts());
    let colors = resolveCategories(el, Math.max(1, state.stats.seriesCount || 6));
    let teardown = null;
    let currentSize = null;
    // What Escape does right now. Held here rather than re-bound per draw: one
    // listener for the life of the mount, reading the CURRENT way home, so a
    // redraw cannot leave a second listener behind pointing at a stale level.
    let goHome = null;
    // The layout-discovered clause currently on the end of the dek, so the next
    // draw can replace it instead of stacking another one behind it.
    let appended = '';

    function render(width, height) {
      const d3 = d3OrThrow();
      const svg = frame.svg;
      // The way back belongs to the level being drawn. Cleared first so a module
      // that has returned to the top — and therefore stops calling ctx.trail —
      // cannot leave last level's button standing over the root picture, still
      // wired to a `view` that no longer means anything.
      goHome = null;
      renderTrail(frame.nav, null);
      svg.textContent = '';
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));

      // The gallery's drawing code, given everything it used to reach for
      // globally: its own selection, its own box, its bound data, the theme's
      // colours, and a tooltip that already knows how to position itself.
      // draw() may hand back the plot box, which the timescan rest needs to
      // know how far to travel — the harness cannot infer it from the marks.
      const drawn = draw({
        d3,
        svg,
        sel: d3.select(svg),
        width,
        height,
        data: state.data,
        stats: state.stats,
        bindings: state.bindings,
        colors,
        config: state.config,
        el,
        tip: {
          show(html, x, y) {
            const box = svg.getBoundingClientRect();
            showTip(frame.tip, html, (x / width) * box.width, (y / height) * box.height);
          },
          hide() { hideTip(frame.tip); },
        },
        fmt: formatNumber,
        motion,
        view,
        // Restate the finding when the reader changes what they are looking at.
        // A drill that leaves the root's headline standing above a single
        // branch is the piece telling them something untrue about the picture
        // in front of them. Copy the CALLER wrote always wins: their headline
        // is not ours to overwrite.
        setCopy(next = {}) {
          const copy = state.config.copy || {};
          if (next.headline !== undefined && !copy.headline) frame.headline.textContent = next.headline;
          if (next.dek !== undefined && !copy.dek) {
            frame.dek.textContent = next.dek;
            frame.dek.style.display = next.dek ? '' : 'none';
          }
          // A clause only the LAYOUT can know — how many marks came out too
          // small to draw at this size, say. It goes onto the reader's own dek
          // as well as ours, because it is a fact about the picture rather
          // than a caption; and it is REPLACED on every redraw rather than
          // appended, because the answer changes with the window and a stale
          // "3 items are not shown" over a picture that now shows them is the
          // same kind of lie the clause exists to prevent.
          if ('dekAppend' in next) {
            const clause = next.dekAppend || '';
            if (clause !== appended) {
              if (appended) {
                frame.dek.textContent = frame.dek.textContent.replace(appended, '').trim();
              }
              if (clause) frame.dek.textContent = `${frame.dek.textContent} ${clause}`.trim();
              appended = clause;
              frame.dek.style.display = frame.dek.textContent ? '' : 'none';
            }
          }
        },
        // Draw this level again. An interactive port calls it after changing
        // `view`; pair it with motion.replay() when the new level deserves its
        // own entrance (a drill IS a new picture), and leave the replay off
        // when only the emphasis moved.
        redraw() { if (currentSize) render(currentSize[0], currentSize[1]); },
        // THE WAY BACK, declared rather than drawn.
        //
        // A module says where the reader is and how to leave; the harness owns
        // what that looks like and how it is reached. Called with nothing (or
        // null) at the top level, which hides the bar — the previous per-module
        // SVG crumbs left a permanent inert "All groups" sitting above the
        // picture, which is clutter that also trained readers to ignore the one
        // place the real control would later appear.
        //
        //   ctx.trail({ label: 'All groups', crumbs: 'Cloud · 27', onHome })
        //
        // Escape is bound here, once per mount, and every module gets it free.
        // A module that forgets to call this at its top level simply keeps the
        // previous bar, which would be a stale way back — so `render` clears it
        // before every draw and a level-holding module re-declares it each time.
        trail(next) {
          goHome = next && next.onHome ? next.onHome : null;
          renderTrail(frame.nav, next && {
            label: next.label,
            crumbs: next.crumbs,
            // A still has no keyboard, so it does not claim one.
            keyboard: !state.config.static,
            onHome: next.onHome,
          });
        },
      });

      // A piece whose rest depends on how it was CONFIGURED — the same treemap
      // breathes at rest and previews its own drill when the reader can drill —
      // names its rest as a function of the config rather than a constant.
      const restName = typeof rest === 'function' ? rest(state.config) : rest;

      if (build || restName) {
        motion.attach(svg, {
          build,
          rest: restName,
          dur: spec.dur || 4200,
          select: restSelect || undefined,
          lead: spec.lead,
          box: drawn && drawn.scanBox ? drawn.scanBox : undefined,
          // Two things only the DRAW knows: where the radial centre is (the
          // ring and bloom builds scale about it) and how to preview this
          // piece's own interaction (the attract rest calls back into it).
          origin: drawn && drawn.origin ? drawn.origin : spec.origin,
          attract: drawn && drawn.attract ? drawn.attract : undefined,
          // SWEEP — the third thing only the draw knows: how to REDRAW a mark at
          // a fraction of itself. A radial form's honest entrance is geometric
          // (a petal extends along its radius, a wedge opens through its angle)
          // and that needs the arc generator, which lives in the module. Without
          // it a build can only scale or fade the finished path, which is the
          // "floats into place" look. Contract: {count, apply(i, t)}; apply(-1, t)
          // sets every mark at once, for the prep pass.
          sweep: drawn && drawn.sweep ? drawn.sweep : undefined,
        });
      }
    }

    function observe() {
      return observeSize(el, frame.plot, (w, h) => {
        currentSize = [w, h];
        render(w, h);
      }, { aspect: config.aspect || aspect, fit: config.fit || 'aspect', minHeight });
    }

    // ESCAPE, bound once for the life of the mount and reading whatever the
    // current level's way home happens to be. On the module's own root rather
    // than the document, so a page with several pieces on it does not have
    // every one of them unwind when the reader presses Escape at one — the
    // module is focusable for exactly this reason.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    function onKeyDown(e) {
      if (e.key !== 'Escape' || !goHome) return;
      e.preventDefault();
      e.stopPropagation();
      goHome();
    }
    el.addEventListener('keydown', onKeyDown);

    teardown = observe();

    return {
      destroy() {
        if (teardown) teardown();
        el.removeEventListener('keydown', onKeyDown);
        motion.destroy();
        el.textContent = '';
        el.classList.remove('vf-module', frame.rootClass);
      },
      update(next) {
        if (teardown) teardown();
        if (dataChanged(state.config, next)) { motion.replay(); view = {}; }
        state = normalize(next);
        colors = resolveCategories(el, Math.max(1, state.stats.seriesCount || 6));
        frame = buildFrame(el, state.config, frameOpts());
        appended = '';  // a fresh dek carries no clause yet
        teardown = observe();
      },
      get stats() { return state.stats; },
      redraw() { if (currentSize) render(currentSize[0], currentSize[1]); },
    };
  }

  return { slug, roles, shape, validate: validate || (() => []), mount, usesD3: true };
}

/** Number coercion that keeps a blank cell a gap. Mirrors vf-core's toNumber. */
export function num(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'string' && raw.trim() === '') return NaN;
  return Number(raw);
}

/** A bound x value as epoch ms when it is a date, else a number. */
export function coerceKey(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (s === '') return { value: NaN, type: 'quantitative' };
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n > 1000 && n < 3000) return { value: Date.UTC(Math.trunc(n), 0, 1), type: 'temporal' };
    return { value: n, type: 'quantitative' };
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? { value: NaN, type: 'quantitative' } : { value: parsed, type: 'temporal' };
}

/**
 * A RADIAL FORM AND THE WIDTH IT CANNOT USE.
 *
 * A circle is bound by the SHORT side of its box. On the 2.8:1 stage this
 * library mounts into, every radial form drew a disc at ~80-95% of the HEIGHT
 * and 25-33% of the WIDTH, with the rest blank paper — measured across pie,
 * sunburst, circle packing, the rose and the chord. A bigger radius wins nothing
 * there, so the fix is never a scale: it is a layout that gives the dead width
 * something to carry.
 *
 * WHAT IS SHARED AND WHAT IS NOT. The mechanics are identical for every radial
 * form — decide whether there is width to spare, size a table to its own content,
 * centre the pair as one figure, draw the rows, hand back hover handles — so they
 * live here once instead of five times. WHAT GOES IN THE TABLE IS NOT SHARED and
 * must not be: a hierarchy's dead width wants its level's parts, a ring's wants
 * each member's in and out, a cycle's wants the cycle in order. Each caller
 * declares its own columns and rows and keeps that decision in its own file.
 *
 * THE ONE RULE THE TABLE OBEYS: it is not a second chart. A length encoding
 * beside an angular or areal one is the same numbers encoded twice, and the
 * stronger encoding wins — which would make the disc decoration. The table adds
 * what the disc cannot hold: every part named (including the ones too small to
 * label), the exact figures, and whatever reading the geometry is silent about.
 *
 *   spec.columns  [{ key, header, align:'start'|'end', weight, fade }]
 *                 The FIRST column is the name column; it gets the swatch.
 *   spec.rows     [{ name, colour, cells:{ key: 'text' } }]
 *   spec.foot     { name, cells } | null — a total line, for forms with no hole
 *                 to put one in.
 *   spec.rimRoom  the inset the form needs for its OWN rim labels when there is
 *                 no room to split (px, default 54).
 *   spec.nameCap  max px for the name column (default 260).
 *
 * Returns { split, cx, cy, outer, panel, bands } — the disc geometry to draw
 * into, and `bands` as [{ name, band }] so the caller can wire one emphasis
 * across both surfaces. With no room to split it draws nothing, and returns the
 * centred full-box geometry with the caller's own rim inset applied.
 */
export function radialSideTable(ctx, spec = {}) {
  const { sel, width, height } = ctx;
  const columns = spec.columns || [];
  const rows = spec.rows || [];
  const NAME_SIZE = 12.5;
  const HEAD_SIZE = 10;
  const COL_PAD = 22;
  const MIN_GAP = 44;
  const SPLIT_MIN = 210;
  const rimRoom = spec.rimRoom === undefined ? 54 : spec.rimRoom;

  const nameCol = columns[0];
  const dataCols = columns.slice(1);
  const colWidth = (c) => COL_PAD + Math.max(
    textWidth(c.header || '', HEAD_SIZE),
    ...rows.map((r) => textWidth(String((r.cells || {})[c.key] ?? ''), NAME_SIZE)),
    spec.foot ? textWidth(String((spec.foot.cells || {})[c.key] ?? ''), NAME_SIZE) : 0
  );
  const widths = dataCols.map(colWidth);
  const nameW = Math.min(spec.nameCap || 260, Math.max(
    textWidth((nameCol && nameCol.header) || '', HEAD_SIZE),
    ...rows.map((r) => textWidth(r.name, NAME_SIZE))
  ));

  // The width a height-bound circle can never use. Measured, rather than
  // inferred from an aspect-ratio threshold, which guesses at the same thing one
  // step removed and has to be retuned for every new stage.
  const deadWidth = width - (height - 10) - MIN_GAP;
  const split = rows.length >= 2 && columns.length >= 2 && deadWidth >= SPLIT_MIN;

  if (!split) {
    return {
      split: false,
      cx: width / 2,
      cy: height / 2 + 6,
      outer: Math.max(40, Math.min(width, height) / 2 - rimRoom),
      panel: null,
      bands: [],
    };
  }

  const natural = 22 + nameW + 18 + widths.reduce((a, b) => a + b, 0);
  const panelW = Math.max(200, Math.min(natural, deadWidth));
  const discD = Math.min(height - 10, width - MIN_GAP - panelW);
  // Whatever the content-sized block does not use goes into the GAP and the
  // margins — never into the table, which would be stretching by another name. A
  // wide box legitimately buys air between the halves; it does not buy a wider
  // table.
  const gap = Math.max(MIN_GAP, Math.min(110, (width - discD - panelW) * 0.22));
  // Centred as ONE figure. Justifying the disc left and the table right fills the
  // box on paper and opens a void down the middle of it; leftover belongs in the
  // margins, where it reads as margin.
  const x0 = (width - (discD + gap + panelW)) / 2;
  const panel = { x: x0 + discD + gap, w: panelW };

  const HEAD = 26;
  const FOOT = spec.foot ? 34 : 0;
  const rowH = Math.max(20, Math.min(42, (height - HEAD - FOOT - 8) / rows.length));
  const top = Math.max(0, (height - (HEAD + rowH * rows.length + FOOT)) / 2);

  // Column edges from the SAME widths the panel was sized with, so a column can
  // never be measured one way and drawn another.
  const rights = [];
  let acc = panel.x + panel.w;
  for (let i = dataCols.length - 1; i >= 0; i -= 1) {
    rights[i] = acc;
    acc -= widths[i];
  }
  const nameX = panel.x + 22;
  const nameMax = Math.max(60, (rights[0] !== undefined ? rights[0] - widths[0] : acc) - nameX + widths[0] - 16);

  const g = sel.append('g');
  const cell = (x, y, text, o = {}) => g.append('text')
    .attr('x', x).attr('y', y)
    .attr('text-anchor', o.align || 'start').attr('dominant-baseline', 'middle')
    .attr('font-family', o.font || 'var(--_ff)')
    .attr('font-size', o.size || NAME_SIZE)
    .attr('font-weight', o.weight || 400)
    .attr('fill', 'var(--_ink)').attr('fill-opacity', o.fade === undefined ? 0.9 : o.fade)
    .attr('pointer-events', 'none')
    .text(text);

  // No rules anywhere: the header is separated by weight and space and the total
  // by space alone ([[feedback_no_rule_lines]]).
  const headY = top + HEAD / 2;
  const head = { size: HEAD_SIZE, fade: 0.5, weight: 500 };
  if (nameCol && nameCol.header) cell(nameX, headY, fitText(nameCol.header, nameMax, HEAD_SIZE), head);
  dataCols.forEach((c, i) => {
    if (c.header) cell(rights[i], headY, fitText(c.header, widths[i], HEAD_SIZE), { ...head, align: 'end' });
  });

  const bands = rows.map((r, i) => {
    const y = top + HEAD + i * rowH + rowH / 2;
    // The band is the row's highlight AND its hit area. One rect doing both means
    // a row can never light without being hoverable, or the reverse.
    const band = g.append('rect')
      .attr('x', panel.x - 8).attr('y', y - rowH / 2).attr('width', panel.w + 16)
      .attr('height', rowH).attr('rx', 3)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0)
      .style('cursor', 'pointer');
    if (r.colour) {
      g.append('rect')
        .attr('x', panel.x).attr('y', y - 6).attr('width', 12).attr('height', 12).attr('rx', 2)
        .attr('fill', r.colour).attr('pointer-events', 'none');
    }
    cell(nameX, y, fitText(r.name, nameMax, NAME_SIZE), { font: 'var(--_fl)', fade: 0.95 });
    dataCols.forEach((c, k) => {
      const text = (r.cells || {})[c.key];
      if (text === undefined || text === null || text === '') return;
      cell(rights[k], y, String(text), {
        align: 'end', weight: c.weight || 400, fade: c.fade,
      });
    });
    return { name: r.name, band };
  });

  if (spec.foot) {
    const y = top + HEAD + rowH * rows.length + FOOT / 2 + 4;
    cell(nameX, y, spec.foot.name, { font: 'var(--_fl)', weight: 600, fade: 0.9 });
    dataCols.forEach((c, k) => {
      const text = (spec.foot.cells || {})[c.key];
      if (text === undefined || text === null || text === '') return;
      cell(rights[k], y, String(text), { align: 'end', weight: 600 });
    });
  }

  return {
    split: true,
    cx: x0 + discD / 2,
    cy: height / 2,
    outer: Math.max(40, discD / 2 - 4),
    panel,
    bands,
  };
}
