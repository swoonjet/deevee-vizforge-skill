// assets/modules/radar.js
//
// RADAR / spiderweb — a named shape per entity across several measures.
// Portable module, ported from demo/b2b/native/dim-radar.html.
//
// WHAT CHANGED IN THE PORT. The demo piece hardcoded its data (`const RAD =
// {compact:[60,95,...]}`), assumed a 1200x760 stage with the legend pinned at
// right:44px, took .dleg/.tip/.src styling from the gallery stylesheet, and
// baked Fritz hexes into the JS. Here: data arrives bound, the geometry is
// computed from the measured box, styles ship with mount(), and colour comes
// from --vf-cat-N.
//
// HONESTY — radar is the form most often used dishonestly, so the constraints
// are explicit:
//
//   1. THE ENCODING IS REACH ALONG EACH SPOKE, NOT ENCLOSED AREA. Area grows
//      with the square of reach and also changes with axis ORDER, which is a
//      layout choice, not data. Both facts are disclosed in the source line and
//      the fill is kept faint so it reads as a connector, not a quantity.
//   2. ANGLE CARRIES AXIS IDENTITY ONLY. Spokes are equally spaced and never
//      vary with value.
//   3. AXES MUST SHARE A SCALE, or the normalisation must be disclosed.
//      `scale:'shared'` puts every measure on one 0..max axis — only valid when
//      the measures are commensurable. `scale:'per-axis'` normalises each to its
//      own min..max, which makes a shape readable but makes cross-axis
//      comparison meaningless; that is stated in the source line rather than
//      left for the reader to discover.
//   4. Radial extent starts at zero. A non-zero inner radius would inflate
//      small values into a visible ring, so it is not offered.

import {
  buildFrame, observeSize, resolveCategories, svgEl, formatNumber,
  showTip, hideTip, clamp, interactionNote, toNumber, createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'radar';

export const roles = {
  series: { types: ['nominal'], required: true, label: 'Series (one shape per distinct value)' },
  axis: { types: ['nominal', 'ordinal'], required: true, label: 'Measure (one spoke per distinct value)' },
  value: { types: ['quantitative'], required: true, label: 'Value (reach along the spoke)' },
};

export function shape(rows, bindings = {}) {
  const sCol = bindings.series;
  const aCol = bindings.axis;
  const vCol = bindings.value;

  const axes = [];
  const seriesNames = [];
  const byKey = new Map();

  for (const row of rows || []) {
    if (!row) continue;
    const s = row[sCol];
    const a = row[aCol];
    const v = toNumber(row[vCol]);
    if (s === undefined || a === undefined || !Number.isFinite(v)) continue;
    const sk = String(s);
    const ak = String(a);
    if (!seriesNames.includes(sk)) seriesNames.push(sk);
    if (!axes.includes(ak)) axes.push(ak);
    byKey.set(`${sk}\u0000${ak}`, v);
  }

  const data = seriesNames.map((name) => ({
    series: name,
    values: axes.map((a) => {
      const v = byKey.get(`${name}\u0000${a}`);
      return v === undefined ? null : v;
    }),
  }));

  // Per-axis extents, used by both scale modes.
  const extents = axes.map((_, i) => {
    const vals = data.map((d) => d.values[i]).filter((v) => v !== null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 1 };
  });

  const allValues = data.flatMap((d) => d.values).filter((v) => v !== null);
  const missing = data.reduce((n, d) => n + d.values.filter((v) => v === null).length, 0);

  return {
    data,
    stats: {
      axes,
      seriesNames,
      seriesCount: seriesNames.length,
      axisCount: axes.length,
      extents,
      globalMax: allValues.length ? Math.max(...allValues) : 1,
      globalMin: allValues.length ? Math.min(...allValues) : 0,
      missing,
      // The roundest shape is a real, computable finding.
      roundest: data.length
        ? data
          .map((d) => {
            const vals = d.values.filter((v) => v !== null);
            if (vals.length < 2) return { series: d.series, spread: Infinity };
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
            return { series: d.series, spread: mean === 0 ? Infinity : sd / Math.abs(mean) };
          })
          .sort((a, b) => a.spread - b.spread)[0]
        : null,
    },
  };
}

export function validate(rows, bindings) {
  const errors = [];
  const { stats } = shape(rows, bindings);
  if (stats.axisCount < 3) {
    errors.push({
      channel: 'axis',
      problem: `channel 'axis': a radar needs at least 3 measures (got ${stats.axisCount})`,
      remedy: `bind 'axis' to a column with 3 or more distinct values, or use ranked-bar for 1-2`,
    });
  }
  if (stats.axisCount > 12) {
    errors.push({
      channel: 'axis',
      problem: `channel 'axis': ${stats.axisCount} spokes is past legibility for a radar`,
      remedy: `aggregate the measures, or use small multiples of ranked-bar`,
    });
  }
  return errors;
}

function defaultHeadline(stats) {
  const { roundest, seriesNames, axes } = stats;
  if (roundest && Number.isFinite(roundest.spread) && seriesNames.length > 1) {
    return `"${roundest.series}" is the most even across all ${axes.length} measures`;
  }
  return `${seriesNames.length} ${seriesNames.length === 1 ? 'shape' : 'shapes'} across ${axes.length} measures`;
}

export function mount(el, config = {}) {
  let state = normalize(config);

  let frame = buildFrame(el, state.config, {
    legend: state.stats.seriesCount > 1,
    ariaLabel: `Radar chart, ${state.stats.seriesCount} series across ${state.stats.axisCount} measures`,
    defaultHeadline: defaultHeadline(state.stats),
    defaultDek: buildDek(state),
    note: state.note,
  });

  const hidden = new Set();
  let colors = resolveCategories(el, Math.max(1, state.stats.seriesCount));
  let teardown = null;
  let currentSize = null;

  // The web is drawn first, then the reading opens outward from the centre —
  // the entrance a radial form has. Afterwards a soft spotlight walks the
  // series in turn, so a five-shape chart reads itself one shape at a time.
  const motion = createMotion(el, config);

  function draw(width, height) {
    const { stats, data } = state;
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const active = stats.seriesNames.filter((n) => !hidden.has(n));
    if (!active.length || stats.axisCount < 3) return;

    const cx = width / 2;
    const cy = height / 2;
    // Leave room for the outermost spoke labels on every side.
    const R = Math.max(30, Math.min(width, height) / 2 - clamp(width * 0.07, 44, 96));
    const n = stats.axisCount;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

    // Reach fraction 0..1 for a value on axis i, per the declared scale mode.
    const reach = (v, i) => {
      if (v === null) return null;
      if (state.scaleMode === 'per-axis') {
        const { min, max } = stats.extents[i];
        return max === min ? 0.5 : clamp((v - min) / (max - min), 0, 1);
      }
      const max = stats.globalMax;
      return max === 0 ? 0 : clamp(v / max, 0, 1);
    };

    const pt = (i, frac) => ({
      x: cx + Math.cos(angle(i)) * R * frac,
      y: cy + Math.sin(angle(i)) * R * frac,
    });

    // Rings — reading aids only.
    const rings = svgEl('g');
    [0.25, 0.5, 0.75, 1].forEach((frac) => {
      let d = '';
      for (let i = 0; i < n; i += 1) {
        const p = pt(i, frac);
        d += (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
      }
      d += 'Z';
      rings.appendChild(svgEl('path', {
        d, fill: 'none', stroke: 'var(--_ink)',
        'stroke-opacity': frac === 1 ? 0.2 : 0.09, 'stroke-width': 1,
      }));
    });
    for (let i = 0; i < n; i += 1) {
      const p = pt(i, 1);
      rings.appendChild(svgEl('line', {
        x1: cx, y1: cy, x2: p.x, y2: p.y,
        stroke: 'var(--_ink)', 'stroke-opacity': 0.14, 'stroke-width': 1,
      }));
    }
    svg.appendChild(rings);

    // Spoke labels
    const labels = svgEl('g');
    for (let i = 0; i < n; i += 1) {
      const lp = pt(i, 1.14);
      const dx = lp.x - cx;
      const dy = lp.y - cy;
      const t = svgEl('text', {
        x: lp.x, y: lp.y,
        'text-anchor': Math.abs(dx) < 6 ? 'middle' : dx < 0 ? 'end' : 'start',
        'dominant-baseline': Math.abs(dy) < 6 ? 'middle' : dy < 0 ? 'auto' : 'hanging',
        fill: 'var(--_ink)', 'fill-opacity': 0.85,
        'font-family': 'var(--_fl)', 'font-size': clamp(width * 0.011, 10, 13.5), 'font-weight': 500,
      });
      t.textContent = stats.axes[i];
      labels.appendChild(t);
    }
    svg.appendChild(labels);

    // Shapes
    const shapes = svgEl('g', { 'data-vf-bloom': '' });
    const hitLayer = svgEl('g');
    const dotLayer = svgEl('g');
    // series name -> its polygon and its vertices, so pointing at one shape can
    // push the others back. Three overlapping outlines on one web is exactly
    // the case where a tooltip alone is not enough to say which is which.
    const bySeries = new Map();
    const claim = (name, node) => {
      if (!bySeries.has(name)) bySeries.set(name, []);
      bySeries.get(name).push(node);
      return node;
    };
    const isolate = (name) => {
      motion.hold();
      for (const [key, nodes] of bySeries) {
        for (const node of nodes) node.style.opacity = key === name ? '1' : '0.16';
      }
    };
    const release = () => {
      for (const nodes of bySeries.values()) {
        for (const node of nodes) node.style.opacity = '';
      }
      motion.free();
    };

    active.forEach((name) => {
      const idx = stats.seriesNames.indexOf(name);
      const row = data[idx];
      // Single shape = the field mark; multi-shape keeps the categorical ramp.
      const color = active.length > 1 ? colors[idx] : 'var(--_mark)';
      const pts = [];
      let d = '';
      let started = false;

      for (let i = 0; i < n; i += 1) {
        const frac = reach(row.values[i], i);
        if (frac === null) { pts.push(null); continue; }
        const p = pt(i, frac);
        pts.push(p);
        d += (started ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
        started = true;
      }
      if (!started) return;
      // Only close the ring when no spoke is missing — a closed polygon over a
      // gap would invent a value.
      const complete = pts.every((p) => p !== null);
      if (complete) d += 'Z';

      const shape = svgEl('path', {
        d,
        // Faint fill: the polygon is a connector between reaches, never an
        // area encoding. See the honesty note at the top of this file.
        fill: complete ? color : 'none',
        'fill-opacity': complete ? 0.08 : 0,
        stroke: color, 'stroke-width': 2.1, 'stroke-linejoin': 'round',
        style: 'cursor:pointer',
        'data-vf-shape': '',
      });
      shapes.appendChild(claim(name, shape));

      // The outline itself answers to the cursor, not only its six vertices —
      // a 2.1px stroke is a hard target, so the hit area is a fat invisible
      // twin of the same path. It carries no paint and no meaning.
      const hit = svgEl('path', {
        d, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
        'pointer-events': 'stroke', style: 'cursor:pointer',
      });
      hit.addEventListener('pointerenter', () => isolate(name));
      hit.addEventListener('pointerleave', release);
      hitLayer.appendChild(hit);

      pts.forEach((p, i) => {
        if (!p) return;
        const dot = svgEl('circle', {
          cx: p.x, cy: p.y, r: 4.4, fill: color,
          stroke: 'var(--_paper)', 'stroke-width': 1.6, style: 'cursor:pointer',
        });
        const enter = () => {
          const box = svg.getBoundingClientRect();
          const extent = state.scaleMode === 'per-axis'
            ? ` <span style="opacity:.7">(axis ${formatNumber(stats.extents[i].min)}–${formatNumber(stats.extents[i].max)})</span>`
            : ` <span style="opacity:.7">of ${formatNumber(stats.globalMax)}</span>`;
          showTip(
            frame.tip,
            `<div style="color:${color}"><b>${escapeHtml(name)}</b></div><div>${escapeHtml(stats.axes[i])} <b>${formatNumber(row.values[i])}</b>${extent}</div>`,
            (p.x / width) * box.width,
            (p.y / height) * box.height
          );
        };
        dot.addEventListener('pointerenter', () => { isolate(name); enter(); });
        dot.addEventListener('pointerleave', () => { release(); hideTip(frame.tip); });
        dotLayer.appendChild(claim(name, dot));
      });
    });
    shapes.appendChild(hitLayer);
    shapes.appendChild(dotLayer);
    svg.appendChild(shapes);

    motion.attach(svg, {
      build: 'bloom',
      dur: 3400,
      origin: [cx, cy],
      rest: 'walk',
      select: '[data-vf-shape]',
    });
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
        if (!hidden.has(name) && state.stats.seriesNames.length - hidden.size === 1) return;
        if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
        button.setAttribute('aria-pressed', String(!hidden.has(name)));
        if (currentSize) draw(currentSize[0], currentSize[1]);
      });
      li.appendChild(button);
      frame.legend.appendChild(li);
    });
  }

  buildLegend();
  teardown = observeSize(el, frame.plot, (w, h) => {
    currentSize = [w, h];
    draw(w, h);
  }, { aspect: state.aspect, fit: state.fit, minHeight: 260 });

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
      colors = resolveCategories(el, Math.max(1, state.stats.seriesCount));
      frame = buildFrame(el, state.config, {
        legend: state.stats.seriesCount > 1,
        ariaLabel: `Radar chart, ${state.stats.seriesCount} series`,
        defaultHeadline: defaultHeadline(state.stats),
        defaultDek: buildDek(state),
        note: state.note,
      });
      hidden.clear();
      buildLegend();
      teardown = observeSize(el, frame.plot, (w, h) => { currentSize = [w, h]; draw(w, h); },
        { aspect: state.aspect, fit: state.fit, minHeight: 260 });
    },
    get stats() { return state.stats; },
  };
}

function buildDek(state) {
  const subject = (state.config.copy || {}).subject;
  const { stats } = state;
  const scaleClause = state.scaleMode === 'per-axis'
    ? 'each spoke scaled to its own range'
    : `all spokes on one 0–${formatNumber(stats.globalMax)} scale`;
  return `${stats.seriesCount} ${stats.seriesCount === 1 ? 'shape' : 'shapes'} across ${stats.axisCount} measures, ${scaleClause}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(state.config, 'Hover a vertex for its value.');
}

function normalize(config) {
  let data;
  let stats;

  if (Array.isArray(config.data) && !config.bindings) {
    ({ data, stats } = shape(config.data, { series: 'series', axis: 'axis', value: 'value' }));
  } else {
    ({ data, stats } = shape(config.data || config.rows || [], config.bindings || {}));
  }

  const scaleMode = config.scale === 'per-axis' ? 'per-axis' : 'shared';

  // Both scale modes carry a disclosure; neither is silent.
  const notes = [
    'read the reach along each spoke, not the enclosed area (area grows with the square of reach and changes with axis order)',
  ];
  if (scaleMode === 'per-axis') {
    notes.push('each spoke is normalised to its own min–max, so reaches are NOT comparable between spokes');
  }
  if (stats.missing > 0) {
    notes.push(`${stats.missing} missing ${stats.missing === 1 ? 'value' : 'values'} leave the outline open rather than interpolated`);
  }

  return {
    config,
    data,
    stats,
    scaleMode,
    note: notes.join('; '),
    aspect: config.aspect || 0.78,
    fit: config.fit || 'aspect',
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
