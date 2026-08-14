// assets/modules/parallel.js
//
// PARALLEL MEASURES — one line per row, threaded across several measures.
// Portable module, ported from demo/b2b/native/dim-parallel.html.
//
// WHY THIS ONE NEXT. The library could answer "how has it changed" (trend),
// "which is biggest" (ranked-bar) and "what is each one shaped like" (radar),
// and had NOTHING for the commonest analytical table there is: one row per
// entity, several numeric columns. Upload region / won / prior / pipeline /
// quota and the filter's best offer was a ranked bar that reads one of those
// columns and ignores the rest. This is the form that reads all of them at once,
// and it is the only form here that shows a TRADE-OFF.
//
// WHAT CHANGED IN THE PORT. The demo hardcoded eighteen model rows and six axis
// keys, pinned its legend at right:44px inside a 1200x760 stage, took .dleg /
// .tip / .src from the gallery stylesheet, and baked Fritz hexes into the JS.
// Here the axes come from the bound columns, geometry is computed from the
// measured box, and colour resolves through --vf-cat-N / --vf-mark.
//
// HONESTY — this form has three specific ways of misleading, so all three are
// handled rather than hoped about:
//
//   1. EACH AXIS IS SCALED TO ITS OWN MIN-MAX. A line sitting high on one axis
//      and low on the next says nothing about absolute magnitude, and heights
//      are NOT comparable between axes. Disclosed in the source line, and each
//      axis prints its own min and max so the reader can convert.
//   2. AXIS ORDER IS A LAYOUT CHOICE, NOT A RANKING. It decides which crossings
//      you can see, not which relationships exist. So the order follows the
//      columns as bound (never resorted to flatter a story), and the headline
//      is computed over EVERY pair of measures rather than only adjacent ones —
//      a true statement about the data, independent of the layout.
//   3. THE SEGMENT BETWEEN TWO AXES IS A CONNECTOR, NOT INTERPOLATION. There is
//      no data between two measures. A missing value therefore BREAKS the line
//      rather than being bridged, and the break count is stated.
//
// The headline's trade-off claim is a Spearman rank correlation, computed, not
// asserted — and it is only made when the coefficient is strong enough to
// deserve the sentence.

import {
  buildFrame, observeSize, resolveCategories, svgEl, formatNumber,
  showTip, hideTip, clamp, interactionNote, toNumber, createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'parallel';

export const roles = {
  measures: { types: ['quantitative'], required: true, multiple: true, label: 'Measures (one axis each)' },
  id: { types: ['nominal', 'ordinal'], required: false, label: 'Row label (names each line)' },
  group: { types: ['nominal', 'ordinal'], required: false, label: 'Group (one colour each)' },
};

/** Strong enough to earn a sentence in the headline. */
const OPPOSITION_RHO = -0.5;
const AGREEMENT_RHO = 0.8;

export function shape(rows, bindings = {}) {
  const measures = (Array.isArray(bindings.measures) ? bindings.measures : []).filter(Boolean);
  const idCol = bindings.id;
  const groupCol = bindings.group;

  const data = [];
  for (const row of rows || []) {
    if (!row) continue;
    const values = measures.map((m) => {
      const v = toNumber(row[m]);
      return Number.isFinite(v) ? v : null;
    });
    // A row with nothing to plot is dropped; a row with SOME values is kept and
    // drawn with breaks, because dropping it would silently shrink the n.
    if (!values.some((v) => v !== null)) continue;
    data.push({
      id: idCol !== undefined && row[idCol] !== undefined ? String(row[idCol]) : '',
      group: groupCol !== undefined && row[groupCol] !== undefined ? String(row[groupCol]) : '',
      values,
    });
  }

  const axes = measures.map((name, i) => {
    const vals = data.map((d) => d.values[i]).filter((v) => v !== null);
    return {
      name,
      min: vals.length ? Math.min(...vals) : 0,
      max: vals.length ? Math.max(...vals) : 1,
      missing: data.length - vals.length,
    };
  });

  const groupNames = [...new Set(data.map((d) => d.group))].filter((g) => g !== '');
  const missing = axes.reduce((n, a) => n + a.missing, 0);

  // Every pair, not only the neighbours — see honesty note 2.
  const pairs = [];
  for (let i = 0; i < axes.length; i += 1) {
    for (let j = i + 1; j < axes.length; j += 1) {
      const rho = spearman(data.map((d) => d.values[i]), data.map((d) => d.values[j]));
      if (rho !== null) pairs.push({ a: axes[i].name, b: axes[j].name, rho, adjacent: j === i + 1 });
    }
  }
  // ADJACENT FIRST, then strength. Every pair is computed because a relationship
  // exists regardless of layout, but a headline that names two axes sitting side
  // by side points at a crossing the reader can actually SEE. A non-adjacent pair
  // is still reported when no neighbouring pair is strong — and then the source
  // line says the crossing is off screen, rather than leaving the reader hunting
  // for it.
  const strongestOf = (candidates, worseFirst) => candidates
    .slice()
    .sort((x, y) => (Number(y.adjacent) - Number(x.adjacent)) || (worseFirst ? x.rho - y.rho : y.rho - x.rho))[0] || null;

  const mostOpposed = strongestOf(pairs.filter((p) => p.rho <= OPPOSITION_RHO), true);
  const mostAligned = strongestOf(pairs.filter((p) => p.rho >= AGREEMENT_RHO), false);

  return {
    data,
    stats: {
      rowCount: data.length,
      axisCount: axes.length,
      axes,
      groupNames,
      groupCount: groupNames.length,
      missing,
      pairs,
      mostOpposed,
      mostAligned,
    },
  };
}

export function validate(rows, bindings) {
  const errors = [];
  const { stats } = shape(rows, bindings);
  if (stats.axisCount < 2) {
    errors.push({
      channel: 'measures',
      problem: `channel 'measures': needs at least 2 numeric columns to thread a line between (got ${stats.axisCount})`,
      remedy: `bind 'measures' to two or more numeric columns, or use ranked-bar for a single value`,
    });
  }
  if (stats.rowCount < 2) {
    errors.push({
      channel: 'measures',
      problem: `fewer than 2 rows carry a usable value (got ${stats.rowCount})`,
      remedy: 'bind to columns with at least 2 numeric rows',
    });
  }
  return errors;
}

// --- statistics -------------------------------------------------------------

/** Ranks with ties averaged; nulls are excluded by the caller. */
function rankOf(values) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k].i] = rank;
    i = j + 1;
  }
  return out;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? null : num / den;
}

/**
 * Spearman rank correlation over the rows where BOTH measures are present.
 *
 * Rank rather than raw Pearson because a parallel plot is read as ordering: the
 * question a crossing answers is "does the row that is high here sit low
 * there", which is monotonic, not linear. O(n log n), so it stays cheap on the
 * Studio's 5000-row cap — an O(n^2) count of literal line crossings would not.
 */
function spearman(colA, colB) {
  const a = [];
  const b = [];
  for (let i = 0; i < colA.length; i += 1) {
    if (colA[i] === null || colB[i] === null) continue;
    a.push(colA[i]);
    b.push(colB[i]);
  }
  if (a.length < 3) return null;
  return pearson(rankOf(a), rankOf(b));
}

function fmtRho(rho) {
  // A real minus sign, not a hyphen — this is a figure.
  return `${rho < 0 ? '−' : ''}${Math.abs(rho).toFixed(2)}`;
}

// --- copy -------------------------------------------------------------------

function defaultHeadline(stats) {
  const { mostOpposed, mostAligned, rowCount, axisCount } = stats;
  if (mostOpposed) {
    return `"${mostOpposed.a}" and "${mostOpposed.b}" pull against each other across ${rowCount} rows`;
  }
  if (mostAligned) {
    return `"${mostAligned.a}" and "${mostAligned.b}" rise and fall together across ${rowCount} rows`;
  }
  return `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} across ${axisCount} measures`;
}

function defaultDek(stats, config) {
  const subject = (config.copy || {}).subject;
  const strongest = stats.mostOpposed || stats.mostAligned;
  const clauses = [
    `${stats.rowCount} ${stats.rowCount === 1 ? 'line' : 'lines'} across ${stats.axisCount} measures, each axis scaled to its own range`,
  ];
  // The pair is already named in the headline; the dek adds only the figure.
  // The off-screen caveat lives in the source line, because one em-dash is the
  // house maximum and the subject earns it.
  if (strongest) clauses.push(`rank correlation ${fmtRho(strongest.rho)}`);
  return `${clauses.join(', ')}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(config, 'Hover a line to trace it; drag down an axis to keep a range, click it to release.');
}

export function mount(el, config = {}) {
  let state = normalize(config);

  let frame = buildFrame(el, state.config, {
    legend: state.stats.groupCount > 1,
    ariaLabel: `Parallel coordinates, ${state.stats.rowCount} rows across ${state.stats.axisCount} measures`,
    defaultHeadline: defaultHeadline(state.stats),
    defaultDek: defaultDek(state.stats, state.config),
    note: state.note,
  });

  const hiddenGroups = new Set();
  // axis name -> {lo, hi} in normalised 0..1 space
  const brush = new Map();
  let colors = resolveCategories(el, Math.max(1, state.stats.groupCount));
  let teardown = null;
  let currentSize = null;
  let hovered = -1;
  let lines = [];

  // Threads draw along their own length, axis by axis, and afterwards a soft
  // spotlight walks across them — the piece re-reading itself.
  const motion = createMotion(el, config);

  function visible(row) {
    if (row.group && hiddenGroups.has(row.group)) return false;
    for (const [name, range] of brush) {
      const i = state.stats.axes.findIndex((a) => a.name === name);
      if (i < 0) continue;
      const v = norm(row.values[i], state.stats.axes[i]);
      // A row with no value on a brushed axis cannot satisfy the range, and
      // must not be quietly kept — a filter that silently passes unknowns is a
      // filter the reader cannot trust.
      if (v === null || v < range.lo - 1e-9 || v > range.hi + 1e-9) return false;
    }
    return true;
  }

  function norm(value, axis) {
    if (value === null) return null;
    const span = axis.max - axis.min;
    return span === 0 ? 0.5 : clamp((value - axis.min) / span, 0, 1);
  }

  function paint() {
    const anyBrush = brush.size > 0;
    lines.forEach((line, i) => {
      const shown = visible(line.row);
      const isHover = hovered === i;
      // Base opacity thins as the plot fills: 20 lines can each be read, 2000
      // cannot, and an overplotted black mass reads as one shape rather than
      // many rows.
      const base = clamp(3 / Math.sqrt(Math.max(1, lines.length)), 0.14, 0.8);
      line.el.setAttribute('stroke-opacity', String(
        isHover ? 0.98 : shown ? (hovered >= 0 ? base * 0.35 : base) : anyBrush || hiddenGroups.size ? 0.04 : base
      ));
      line.el.setAttribute('stroke-width', String(isHover ? 2.6 : 1.5));
      line.el.setAttribute('stroke', shown ? line.color : 'var(--_mark)');
    });
  }

  function draw(width, height) {
    const { stats, data } = state;
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    lines = [];
    if (stats.axisCount < 2 || !data.length) return;

    // Room: the outer axis labels are centred on their axis, so half a label
    // hangs outside on each side; min/max figures sit above and below.
    const side = clamp(width * 0.07, 46, 96);
    const top = 22;
    const bottom = 52;
    const x = (i) => side + (i * (width - side * 2)) / (stats.axisCount - 1);
    const y = (frac) => height - bottom - frac * (height - bottom - top);

    const axisLabelSize = clamp(width * 0.0105, 10, 13);
    const figureSize = clamp(width * 0.0085, 9, 11);

    // Lines first, so axes and labels read above them.
    const threads = svgEl('g');
    data.forEach((row) => {
      // Segments, not one path: a missing value is a BREAK, never a bridge.
      let d = '';
      let open = false;
      row.values.forEach((v, i) => {
        const frac = norm(v, stats.axes[i]);
        if (frac === null) { open = false; return; }
        d += (open ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(frac).toFixed(1);
        open = true;
      });
      if (!d) return;

      const color = stats.groupCount > 1 && row.group
        ? colors[Math.max(0, stats.groupNames.indexOf(row.group))]
        : 'var(--_mark)';

      const path = svgEl('path', {
        d,
        fill: 'none',
        stroke: color,
        'stroke-width': 1.5,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        style: 'cursor:pointer',
        'data-vf-thread': '',
      });
      const index = lines.length;
      const enter = (event) => {
        motion.hold();
        hovered = index;
        paint();
        const box = svg.getBoundingClientRect();
        const readout = stats.axes
          .map((a, i) => `${escapeHtml(a.name)} <b>${row.values[i] === null ? '—' : formatNumber(row.values[i])}</b>`)
          .join(' · ');
        showTip(
          frame.tip,
          `${row.id ? `<div style="color:${color}"><b>${escapeHtml(row.id)}</b>${row.group ? ` <span style="opacity:.7">${escapeHtml(row.group)}</span>` : ''}</div>` : ''}<div>${readout}</div>`,
          event.clientX - box.left,
          event.clientY - box.top
        );
      };
      path.addEventListener('pointerenter', enter);
      path.addEventListener('pointermove', enter);
      path.addEventListener('pointerleave', () => {
        hovered = -1;
        paint();
        hideTip(frame.tip);
        motion.free();
      });
      threads.appendChild(path);
      lines.push({ el: path, row, color });
    });
    svg.appendChild(threads);

    // Axes, their own extents, and the brush handles.
    stats.axes.forEach((axis, i) => {
      const ax = x(i);
      const group = svgEl('g');
      group.appendChild(svgEl('line', {
        x1: ax, y1: top, x2: ax, y2: height - bottom,
        stroke: 'var(--_ink)', 'stroke-opacity': 0.18, 'stroke-width': 1,
      }));

      // min and max printed, because per-axis scaling hides magnitude.
      const maxLabel = svgEl('text', {
        x: ax, y: top - 7, 'text-anchor': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.6,
        'font-family': 'var(--_ff)', 'font-size': figureSize,
        'font-variant-numeric': 'tabular-nums',
      });
      maxLabel.textContent = formatNumber(axis.max);
      group.appendChild(maxLabel);

      const minLabel = svgEl('text', {
        x: ax, y: height - bottom + 15, 'text-anchor': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.6,
        'font-family': 'var(--_ff)', 'font-size': figureSize,
        'font-variant-numeric': 'tabular-nums',
      });
      minLabel.textContent = formatNumber(axis.min);
      group.appendChild(minLabel);

      const name = svgEl('text', {
        x: ax, y: height - bottom + 36, 'text-anchor': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.9,
        'font-family': 'var(--_fl)', 'font-size': axisLabelSize, 'font-weight': 600,
      });
      name.textContent = axis.name;
      group.appendChild(name);

      const bandWidth = 26;
      const held = brush.get(axis.name);
      const shade = svgEl('rect', {
        x: ax - bandWidth / 2,
        y: held ? y(held.hi) : top,
        width: bandWidth,
        height: held ? Math.max(1, y(held.lo) - y(held.hi)) : 0,
        rx: 3,
        fill: 'var(--_accent)', 'fill-opacity': 0.14,
        visibility: held ? 'visible' : 'hidden',
        'pointer-events': 'none',
      });
      group.appendChild(shade);

      const hit = svgEl('rect', {
        x: ax - bandWidth / 2, y: top, width: bandWidth, height: height - bottom - top,
        fill: 'transparent', style: 'cursor:ns-resize',
      });
      hit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const localY = (ev) => {
          const box = svg.getBoundingClientRect();
          const scaled = ((ev.clientY - box.top) / box.height) * height;
          return clamp(scaled, top, height - bottom);
        };
        const y0 = localY(event);
        const move = (ev) => {
          const y1 = localY(ev);
          shade.setAttribute('y', String(Math.min(y0, y1)));
          shade.setAttribute('height', String(Math.abs(y1 - y0)));
          shade.setAttribute('visibility', Math.abs(y1 - y0) > 3 ? 'visible' : 'hidden');
        };
        const up = (ev) => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          const y1 = localY(ev);
          // A click (rather than a drag) releases the axis — one gesture, both
          // directions, no separate "clear" button to explain.
          if (Math.abs(y1 - y0) <= 4) {
            brush.delete(axis.name);
            shade.setAttribute('visibility', 'hidden');
          } else {
            const span = height - bottom - top;
            brush.set(axis.name, {
              lo: (height - bottom - Math.max(y0, y1)) / span,
              hi: (height - bottom - Math.min(y0, y1)) / span,
            });
          }
          paint();
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
      group.appendChild(hit);
      svg.appendChild(group);
    });

    paint();

    motion.attach(svg, {
      build: 'trace',
      dur: 4000,
      lead: false,
      rest: 'walk',
      select: '[data-vf-thread]',
    });
  }

  function buildLegend() {
    if (!frame.legend) return;
    frame.legend.textContent = '';
    state.stats.groupNames.forEach((name, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!hiddenGroups.has(name)));
      button.innerHTML = `<span class="vf-swatch" style="background:${colors[i]}"></span>`;
      button.appendChild(document.createTextNode(name));
      button.addEventListener('click', () => {
        if (!hiddenGroups.has(name) && state.stats.groupCount - hiddenGroups.size === 1) return;
        if (hiddenGroups.has(name)) hiddenGroups.delete(name); else hiddenGroups.add(name);
        button.setAttribute('aria-pressed', String(!hiddenGroups.has(name)));
        paint();
      });
      li.appendChild(button);
      frame.legend.appendChild(li);
    });
  }

  function observe() {
    return observeSize(el, frame.plot, (w, h) => {
      currentSize = [w, h];
      draw(w, h);
    }, { aspect: state.aspect, fit: state.fit, minHeight: 240 });
  }

  buildLegend();
  teardown = observe();

  return {
    destroy() {
      if (teardown) teardown();
      motion.destroy();
      el.textContent = '';
      el.classList.remove('vf-module', frame.rootClass);
    },
    update(next) {
      if (teardown) teardown();
      if (dataChanged(state.config, next)) motion.replay();
      state = normalize(next);
      colors = resolveCategories(el, Math.max(1, state.stats.groupCount));
      frame = buildFrame(el, state.config, {
        legend: state.stats.groupCount > 1,
        ariaLabel: `Parallel coordinates, ${state.stats.rowCount} rows across ${state.stats.axisCount} measures`,
        defaultHeadline: defaultHeadline(state.stats),
        defaultDek: defaultDek(state.stats, state.config),
        note: state.note,
      });
      hiddenGroups.clear();
      brush.clear();
      hovered = -1;
      buildLegend();
      teardown = observe();
    },
    get stats() { return state.stats; },
    get size() { return currentSize; },
  };
}

function normalize(config) {
  let data;
  let stats;

  if (Array.isArray(config.data) && !config.bindings) {
    // Canonical form: rows already carrying {id, group, values[]} plus the axis
    // names, as this module's own shape() emits them.
    const axes = Array.isArray(config.axes) ? config.axes : [];
    data = config.data.filter((d) => d && Array.isArray(d.values));
    ({ stats } = reStat(data, axes));
  } else {
    ({ data, stats } = shape(config.data || config.rows || [], config.bindings || {}));
  }

  const notes = [
    'each axis is scaled to its own min–max, so a height compares rows WITHIN an axis and never between axes',
    'axis order follows the bound columns; it decides which crossings are visible, not which relationships exist',
  ];
  if (stats.missing > 0) {
    notes.push(`${stats.missing} missing ${stats.missing === 1 ? 'value' : 'values'} break their line rather than being interpolated`);
  }
  const strongest = stats.mostOpposed || stats.mostAligned;
  if (strongest && !strongest.adjacent) {
    notes.push(`the strongest relationship here is between "${strongest.a}" and "${strongest.b}", which are not neighbours in this order, so that crossing is not on screen`);
  }

  return {
    config,
    data,
    stats,
    note: notes.join('; '),
    aspect: config.aspect || 0.5,
    fit: config.fit || 'aspect',
  };
}

/**
 * Rebuilds stats for the canonical {values[]} form, where the axis names arrive
 * separately. Keeps one statistics implementation rather than two.
 */
function reStat(data, axisNames) {
  const rows = data.map((d) => {
    const row = {};
    axisNames.forEach((name, i) => { row[name] = d.values[i]; });
    if (d.id) row.__id = d.id;
    if (d.group) row.__group = d.group;
    return row;
  });
  return shape(rows, { measures: axisNames, id: '__id', group: '__group' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
