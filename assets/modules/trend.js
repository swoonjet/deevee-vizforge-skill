// assets/modules/trend.js
//
// TREND — interactive multi-series time series. Portable module.
//
// WHY THIS EXISTS. The wizard's profiler most often detects `temporal +
// quantitative` on a real upload, and before this module there was no
// interactive technique for that shape at all. Worse, the static `line`
// scaffold mishandles it in two ways this module fixes at the root:
//
//   1. SERIES IS SILENTLY IGNORED. skill/manifest/line.json's contract
//      promises the role "Series (optional — one line per distinct value)",
//      and scripts/shapers/line.mjs faithfully emits `point.series` — but
//      scaffolds/line.html never reads it. Three products bound through that
//      path get sorted by date and joined into ONE path, producing a sawtooth
//      that connects unrelated series. A wrong chart, gate-clean. This module
//      groups by series and draws one line each.
//
//   2. TEMPORAL X RENDERS AS RAW EPOCH MILLISECONDS. line's coerceX falls back
//      to Date.parse and nothing formats it back, so the axis reads
//      "1736000000000" and the headline "at x=1748736000000.00". Here x
//      carries its type and formats through vf-core's formatTemporal.
//
// HONESTY. Position channel, so a non-zero baseline is legal — and disclosed
// in the source line whenever it occurs, never silently. Lines are linearly
// interpolated between real bound points only; no curve smoothing is invented.
// Gaps are gaps: a series with a missing point is broken, not bridged.

import {
  buildFrame, observeSize, resolveCategories, linearScale, ticks,
  positionDomain, formatNumber, formatTemporal, coerceX, svgEl, axisTicks,
  showTip, hideTip, clamp, interactionNote, toNumber, createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'trend';

export const roles = {
  x: { types: ['temporal', 'quantitative'], required: true, label: 'X-axis (time or ordered value)' },
  y: { types: ['quantitative'], required: true, label: 'Y-axis value' },
  series: { types: ['nominal'], required: false, label: 'Series (one line per distinct value)' },
};

/**
 * shape(rows, bindings) -> {data:[{x,y,series}], stats}
 *
 * Pure. Mirrors the scripts/shapers/*.mjs contract so the same function can
 * feed the wizard's binding engine and a hand-written embed.
 */
export function shape(rows, bindings = {}, options = {}) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;
  const xType = options.xType || 'quantitative';

  const data = [];
  let resolvedType = xType;

  for (const row of rows || []) {
    if (!row) continue;
    const cx = coerceX(row[xCol], xType);
    const y = toNumber(row[yCol]);
    if (!Number.isFinite(cx.value) || !Number.isFinite(y)) continue;
    if (cx.type === 'temporal') resolvedType = 'temporal';
    data.push({
      x: cx.value,
      y,
      series: seriesCol ? String(row[seriesCol]) : '',
    });
  }

  data.sort((a, b) => (a.series === b.series ? a.x - b.x : a.series < b.series ? -1 : 1));

  const seriesNames = [...new Set(data.map((d) => d.series))];
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);

  // Per-series first/last, so the headline can state a real change.
  const deltas = seriesNames.map((name) => {
    const pts = data.filter((d) => d.series === name);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const change = first && last && first.y !== 0 ? (last.y - first.y) / Math.abs(first.y) : null;
    return { series: name, firstY: first ? first.y : null, lastY: last ? last.y : null, change };
  });

  const ranked = deltas.filter((d) => d.change !== null).sort((a, b) => b.change - a.change);

  return {
    data,
    stats: {
      rowCount: data.length,
      seriesCount: seriesNames.length,
      seriesNames,
      xType: resolvedType,
      firstX: xs.length ? Math.min(...xs) : null,
      lastX: xs.length ? Math.max(...xs) : null,
      minY: ys.length ? Math.min(...ys) : null,
      maxY: ys.length ? Math.max(...ys) : null,
      deltas,
      topGain: ranked[0] || null,
      topDrop: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    },
  };
}

/** Errors that make this technique the wrong choice for the bound columns. */
export function validate(rows, bindings, { profile } = {}) {
  const errors = [];
  const xCol = bindings.x;
  const field = profile && Array.isArray(profile.fields)
    ? profile.fields.find((f) => f.name === xCol)
    : undefined;

  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal — not orderable for a trend's x-axis`,
      remedy: `bind 'x' to a temporal or quantitative column, or use ranked-bar for categories`,
    });
  }

  const { data } = shape(rows, bindings);
  if (data.length < 2) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': fewer than 2 usable rows after coercion — a trend needs at least 2 points`,
      remedy: `bind to columns with at least 2 numeric rows`,
    });
  }
  return errors;
}

/**
 * Computes the headline from the bound data. Never a topic label — the same
 * rule docs/titling-attribution.md sets for scaffolds.
 */
function defaultHeadline(stats, fmtX) {
  const { topGain, topDrop, seriesCount } = stats;
  const pct = (c) => `${c >= 0 ? '+' : ''}${Math.round(c * 100)}%`;

  if (seriesCount > 1 && topGain && topDrop && topGain.series !== topDrop.series) {
    if (topGain.change > 0 && topDrop.change < 0) {
      return `${topGain.series} rose ${pct(topGain.change)} while ${topDrop.series} fell ${pct(Math.abs(topDrop.change) * -1).replace('-', '')}`;
    }
    return `${topGain.series} led at ${pct(topGain.change)}, ${topDrop.series} trailed at ${pct(topDrop.change)}`;
  }
  if (topGain && topGain.change !== null) {
    const dir = topGain.change >= 0 ? 'rose' : 'fell';
    return `${topGain.series ? topGain.series + ' ' : 'The series '}${dir} ${pct(Math.abs(topGain.change))} from ${formatNumber(topGain.firstY)} to ${formatNumber(topGain.lastY)}`;
  }
  return `${stats.rowCount} points from ${fmtX(stats.firstX)} to ${fmtX(stats.lastX)}`;
}

/**
 * mount(el, config) -> { destroy(), update(config) }
 *
 * config: { data | rows+bindings, copy, xType, aspect, interactive }
 */
export function mount(el, config = {}) {
  let state = normalize(config);

  const frameOpts = {
    legend: state.stats.seriesCount > 1,
    ariaLabel: `Trend chart, ${state.stats.seriesCount} series, ${state.stats.rowCount} points`,
    defaultHeadline: defaultHeadline(state.stats, state.fmtX),
    defaultDek: buildDek(state),
    note: state.note,
  };

  let frame = buildFrame(el, state.config, frameOpts);
  const hidden = new Set();
  let colors = resolveCategories(el, Math.max(1, state.stats.seriesCount));
  let teardown = null;

  // A line chart assembles by being drawn: each series traces along its own
  // length, led by a dot, and the end markers land behind it left to right.
  // Afterwards a faint tracer keeps re-reading the longest line.
  const motion = createMotion(el, config);

  function draw(width, height) {
    const { stats } = state;
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const visible = state.data.filter((d) => !hidden.has(d.series));
    const active = stats.seriesNames.filter((n) => !hidden.has(n));
    if (visible.length === 0) return;

    const yInfo = positionDomain(visible.map((d) => d.y));
    const xs = visible.map((d) => d.x);
    const xDomain = [Math.min(...xs), Math.max(...xs)];
    const span = xDomain[1] - xDomain[0];

    // Right margin leaves room for the end-of-line direct labels; no legend
    // lookup needed to read a line when there is space to name it.
    const labelRoom = active.length > 1 ? clamp(width * 0.14, 62, 132) : 46;
    const m = { top: 12, right: labelRoom, bottom: 30, left: 46 };

    const x = linearScale(xDomain, [m.left, width - m.right]);
    const y = linearScale(yInfo.domain, [height - m.bottom, m.top]);

    const yT = ticks(yInfo.domain[0], yInfo.domain[1], 5);
    const grid = svgEl('g');
    for (const t of yT) {
      grid.appendChild(svgEl('line', {
        x1: m.left, x2: width - m.right, y1: y(t), y2: y(t),
        stroke: 'var(--_ink)', 'stroke-opacity': 0.1, 'stroke-width': 1,
      }));
      const label = svgEl('text', {
        x: m.left - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.7,
        'font-family': 'var(--_fl)', 'font-size': 11, 'font-variant-numeric': 'tabular-nums',
      });
      label.textContent = formatNumber(t);
      grid.appendChild(label);
    }
    svg.appendChild(grid);

    const xT = axisTicks(
      visible.map((d) => d.x),
      xDomain,
      Math.max(2, Math.round(width / 130)),
      stats.xType === 'temporal'
    );
    const xAxis = svgEl('g');
    for (const t of xT) {
      if (t < xDomain[0] || t > xDomain[1]) continue;
      const label = svgEl('text', {
        x: x(t), y: height - m.bottom + 18, 'text-anchor': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.7,
        'font-family': 'var(--_fl)', 'font-size': 11, 'font-variant-numeric': 'tabular-nums',
      });
      label.textContent = state.fmtX(t, span);
      xAxis.appendChild(label);
    }
    svg.appendChild(xAxis);

    // One path per series — the thing scaffolds/line.html fails to do.
    const lines = svgEl('g');
    active.forEach((name) => {
      const pts = state.data.filter((d) => d.series === name && !hidden.has(d.series));
      if (pts.length === 0) return;
      // A single series is the FIELD mark, so it follows the theme's mark colour
      // rather than being locked to ink — see vf-core's --_mark.
      const color = active.length > 1 ? colors[stats.seriesNames.indexOf(name)] : 'var(--_mark)';
      let d = '';
      pts.forEach((p, i) => { d += (i ? 'L' : 'M') + x(p.x).toFixed(2) + ',' + y(p.y).toFixed(2); });
      lines.appendChild(svgEl('path', {
        d, fill: 'none', stroke: color, 'stroke-width': 1.9,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));

      const last = pts[pts.length - 1];
      if (active.length > 1) {
        lines.appendChild(svgEl('circle', { cx: x(last.x), cy: y(last.y), r: 3.2, fill: color }));
        const tag = svgEl('text', {
          x: x(last.x) + 8, y: y(last.y), 'dominant-baseline': 'middle',
          fill: color, 'font-family': 'var(--_fl)', 'font-size': 11.5, 'font-weight': 600,
        });
        tag.textContent = name;
        lines.appendChild(tag);
      } else {
        lines.appendChild(svgEl('circle', { cx: x(last.x), cy: y(last.y), r: 4, fill: 'var(--_accent)' }));
        const tag = svgEl('text', {
          x: x(last.x) + 8, y: y(last.y) - 2,
          fill: 'var(--_accent)', 'font-family': 'var(--_ff)', 'font-size': 11,
        });
        tag.textContent = formatNumber(last.y);
        lines.appendChild(tag);
      }
    });
    svg.appendChild(lines);

    if (state.interactive) attachCrosshair(svg, { x, y, m, width, height, active, span });

    motion.attach(svg, { build: 'trace', dur: 4800, rest: 'tracer' });
  }

  function attachCrosshair(svg, ctx) {
    const { x, y, m, width, height, active, span } = ctx;
    const cursor = svgEl('line', {
      y1: m.top, y2: height - m.bottom, stroke: 'var(--_ink)',
      'stroke-opacity': 0.28, 'stroke-width': 1, opacity: 0,
    });
    svg.appendChild(cursor);
    const dots = svgEl('g', { opacity: 0 });
    svg.appendChild(dots);

    const hit = svgEl('rect', {
      x: m.left, y: m.top, width: Math.max(1, width - m.right - m.left),
      height: Math.max(1, height - m.bottom - m.top), fill: 'transparent', style: 'cursor:crosshair',
    });

    const onMove = (event) => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const py = ((event.clientY - box.top) / box.height) * height;
      const xv = x.invert(clamp(px, m.left, width - m.right));

      const rows = [];
      active.forEach((name) => {
        const pts = state.data.filter((d) => d.series === name);
        if (!pts.length) return;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
        const color = active.length > 1 ? colors[state.stats.seriesNames.indexOf(name)] : 'var(--_mark)';
        rows.push({ name, point: best, color });
      });
      if (!rows.length) return;

      // The series under the cursor leads: its dot is larger, its row is bold,
      // and the tooltip is anchored to IT rather than to whichever series
      // happened to be drawn first. Reading a six-line chart otherwise means
      // matching a swatch against a line by eye.
      let lead = 0;
      for (let i = 1; i < rows.length; i += 1) {
        if (Math.abs(y(rows[i].point.y) - py) < Math.abs(y(rows[lead].point.y) - py)) lead = i;
      }

      dots.textContent = '';
      rows.forEach((r, i) => {
        dots.appendChild(svgEl('circle', {
          cx: x(r.point.x), cy: y(r.point.y), r: i === lead ? 5.4 : 3.6,
          fill: r.color, stroke: 'var(--_paper)', 'stroke-width': 1.5,
          'fill-opacity': i === lead ? 1 : 0.55,
        }));
      });

      const anchor = rows[lead].point;
      cursor.setAttribute('x1', String(x(anchor.x)));
      cursor.setAttribute('x2', String(x(anchor.x)));
      cursor.setAttribute('opacity', '1');
      dots.setAttribute('opacity', '1');

      const head = `<div><b>${escapeHtml(state.fmtX(anchor.x, span))}</b></div>`;
      const body = rows
        .map((r, i) => `<div style="color:${r.color};opacity:${i === lead ? 1 : 0.62}">${r.name ? escapeHtml(r.name) + ' ' : ''}<b>${formatNumber(r.point.y)}</b></div>`)
        .join('');
      const box2 = svg.getBoundingClientRect();
      showTip(frame.tip, head + body, (x(anchor.x) / width) * box2.width, (y(anchor.y) / height) * box2.height);
    };

    const onLeave = () => {
      cursor.setAttribute('opacity', '0');
      dots.setAttribute('opacity', '0');
      hideTip(frame.tip);
    };

    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerleave', onLeave);
    svg.appendChild(hit);
  }

  function buildLegend() {
    if (!frame.legend) return;
    frame.legend.textContent = '';
    state.stats.seriesNames.forEach((name, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!hidden.has(name)));
      button.innerHTML = `<span class="vf-swatch" style="background:${colors[i]}"></span>`;
      button.appendChild(document.createTextNode(name));
      button.addEventListener('click', () => {
        // Never allow an empty chart: the last visible series cannot be hidden.
        if (!hidden.has(name) && state.stats.seriesNames.length - hidden.size === 1) return;
        if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
        button.setAttribute('aria-pressed', String(!hidden.has(name)));
        redraw();
      });
      li.appendChild(button);
      frame.legend.appendChild(li);
    });
  }

  let currentSize = null;
  function redraw() {
    if (currentSize) draw(currentSize[0], currentSize[1]);
  }

  buildLegend();
  teardown = observeSize(el, frame.plot, (w, h) => {
    currentSize = [w, h];
    draw(w, h);
  }, { aspect: state.aspect, fit: state.fit });

  return {
    destroy() {
      if (teardown) teardown();
      motion.destroy();
      el.textContent = '';
      el.classList.remove('vf-module', frame.rootClass);
    },
    update(next) {
      if (teardown) teardown();
      // New data is a new piece and gets to introduce itself again. A new
      // headline is not — see dataChanged().
      if (dataChanged(state.config, next)) motion.replay();
      state = normalize(next);
      colors = resolveCategories(el, Math.max(1, state.stats.seriesCount));
      frame = buildFrame(el, state.config, {
        legend: state.stats.seriesCount > 1,
        ariaLabel: `Trend chart, ${state.stats.seriesCount} series`,
        defaultHeadline: defaultHeadline(state.stats, state.fmtX),
        defaultDek: buildDek(state),
        note: state.note,
      });
      hidden.clear();
      buildLegend();
      teardown = observeSize(el, frame.plot, (w, h) => { currentSize = [w, h]; draw(w, h); }, { aspect: state.aspect, fit: state.fit });
    },
    get stats() { return state.stats; },
  };
}

function buildDek(state) {
  const { stats, config } = state;
  const subject = (config.copy || {}).subject;
  const seriesPart = stats.seriesCount > 1
    ? `${stats.seriesCount} series, ${stats.rowCount} points`
    : `${stats.rowCount} points`;
  const range = `${state.fmtX(stats.firstX)} to ${state.fmtX(stats.lastX)}`;
  return `${seriesPart}, ${range}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(config, 'Hover to read exact values.');
}

function normalize(config) {
  const xType = config.xType || 'quantitative';
  let data;
  let stats;

  if (Array.isArray(config.data)) {
    // Pre-shaped, or a plain array the caller wants shaped by role names.
    if (config.bindings) {
      ({ data, stats } = shape(config.data, config.bindings, { xType }));
    } else {
      const coerced = config.data
        .map((d) => {
          const cx = coerceX(d.x, xType);
          return { x: cx.value, y: toNumber(d.y), series: d.series === undefined ? '' : String(d.series), type: cx.type };
        })
        .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
      const resolved = coerced.some((d) => d.type === 'temporal') ? 'temporal' : xType;
      ({ data, stats } = shape(
        coerced.map((d) => ({ x: d.x, y: d.y, s: d.series })),
        { x: 'x', y: 'y', series: 's' },
        { xType: resolved }
      ));
    }
  } else {
    ({ data, stats } = shape(config.rows || [], config.bindings || {}, { xType }));
  }

  const span = stats.lastX !== null && stats.firstX !== null ? stats.lastX - stats.firstX : undefined;
  const fmtX = stats.xType === 'temporal'
    ? (v, s) => formatTemporal(v, s === undefined ? span : s)
    : (v) => formatNumber(v);

  // Disclose a non-zero baseline whenever one occurs — never silently.
  const yInfo = positionDomain(data.map((d) => d.y));
  const note = yInfo.domain[0] > 0
    ? 'Y-axis does not start at zero (position encoding, disclosed)'
    : null;

  return {
    config,
    data,
    stats,
    fmtX,
    note,
    aspect: config.aspect || 0.5,
    fit: config.fit || 'aspect',
    interactive: config.interactive !== false,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
