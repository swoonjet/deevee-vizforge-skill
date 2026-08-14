// assets/modules/stream.js
//
// STREAMGRAPH — the gallery's `unc-stream` ("The race for second place"),
// ported to take any date / category / value table.
//
// HONESTY, and it is the whole reason this form needs care. In a stacked band
// only two things are readable: the TOTAL height at any x, and the THICKNESS of
// each band. A band's vertical POSITION carries nothing — it is the result of
// the stacking order and the wiggle offset, both of which are layout. So the
// source line says that outright, and the piece never invites a reader to
// compare two bands by where they sit.
//
// The wiggle offset (d3.stackOffsetWiggle) is chosen for the same reason the
// gallery chose it: it minimises the wobble of every band's centre line, which
// makes THICKNESS easier to read. It is a legibility device, not an encoding.

import { d3Piece, num, coerceKey } from './d3-piece.js';
import { formatTemporal, formatNumber, temporalTicks, ticks as niceTicks, ifLive} from './vf-core.js';

export const slug = 'stream';

export const roles = {
  x: { types: ['temporal', 'quantitative'], required: true, label: 'Time' },
  series: { types: ['nominal', 'ordinal'], required: true, label: 'Series (one band each)' },
  y: { types: ['quantitative'], required: true, label: 'Value (band thickness)' },
};

export function shape(rows, bindings = {}) {
  const xCol = bindings.x;
  const sCol = bindings.series;
  const yCol = bindings.y;

  const byKey = new Map();
  const names = new Set();
  let temporal = false;

  for (const row of rows || []) {
    if (!row) continue;
    const k = coerceKey(row[xCol]);
    const v = num(row[yCol]);
    if (!Number.isFinite(k.value) || !Number.isFinite(v)) continue;
    if (k.type === 'temporal') temporal = true;
    const name = String(row[sCol] === undefined ? '' : row[sCol]);
    if (!name) continue;
    names.add(name);
    // Repeated (x, series) pairs SUM. A streamgraph over transactional rows is
    // the common case and dropping duplicates would silently shrink a band.
    const slot = byKey.get(k.value) || { x: k.value, total: 0 };
    slot[name] = (slot[name] || 0) + v;
    slot.total += v;
    byKey.set(k.value, slot);
  }

  const seriesNames = [...names].sort();
  const data = [...byKey.values()].sort((a, b) => a.x - b.x);
  for (const d of data) for (const n of seriesNames) if (d[n] === undefined) d[n] = 0;

  // The finding: which band grew most across the span, in share of the total.
  const shareAt = (d, n) => (d.total ? d[n] / d.total : 0);
  const first = data[0];
  const last = data[data.length - 1];
  const moves = seriesNames.map((n) => ({
    name: n,
    from: first ? shareAt(first, n) : 0,
    to: last ? shareAt(last, n) : 0,
    delta: last && first ? shareAt(last, n) - shareAt(first, n) : 0,
    peak: Math.max(...data.map((d) => d[n] || 0)),
  })).sort((a, b) => b.delta - a.delta);

  return {
    data,
    stats: {
      seriesNames,
      seriesCount: seriesNames.length,
      pointCount: data.length,
      rowCount: (rows || []).length,
      temporal,
      firstX: first ? first.x : null,
      lastX: last ? last.x : null,
      totalPeak: Math.max(0, ...data.map((d) => d.total)),
      gainer: moves[0] || null,
      loser: moves[moves.length - 1] || null,
    },
  };
}

const fmtX = (stats) => (v) => (stats.temporal
  ? formatTemporal(v, stats.lastX - stats.firstX)
  : formatNumber(v));

function streamHeadline(stats) {
  const { gainer, loser, seriesCount } = stats;
  const pct = (v) => Math.round(Math.abs(v) * 100);
  if (gainer && loser && gainer.name !== loser.name && gainer.delta > 0.01) {
    return `${gainer.name} took ${pct(gainer.delta)} points of share while ${loser.name} gave up ${pct(loser.delta)}`;
  }
  if (gainer) return `${gainer.name} holds ${pct(gainer.to)}% of the total by the end`;
  return `${seriesCount} series over ${stats.pointCount} points`;
}

function streamDek(stats) {
  const f = fmtX(stats);
  return `${stats.seriesCount} series stacked over ${stats.pointCount} points, `
    + `${f(stats.firstX)} to ${f(stats.lastX)}.`;
}

export default d3Piece({
  slug,
  title: 'Streamgraph',
  roles,
  shape,
  build: 'swell',
  rest: (config) => (config && config.isolate ? 'attract' : 'timescan'),
  dur: 4800,
  aspect: 0.5,
  hoverNote: (config) => (config && config.isolate
    ? 'Hover for the split at any moment; click a band to pull it out onto its own zero baseline.'
    : 'Hover for the split at any moment.'),

  headline: streamHeadline,

  dek: streamDek,

  note: 'read each band by its THICKNESS and the stack by its total height; a band\'s vertical position is set by the stacking order and carries no value',

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.length || !stats.seriesCount) return null;

    const isolate = Boolean(config.isolate);
    const only = isolate && view.series && stats.seriesNames.includes(view.series) ? view.series : null;
    if (only) return drawIsolated(ctx, only);

    const labelRoom = Math.min(190, Math.max(90, width * 0.16));
    const m = { top: 14, right: labelRoom, bottom: 30, left: 18 };
    const f = fmtX(stats);

    const x = d3.scaleLinear()
      .domain([stats.firstX, stats.lastX])
      .range([m.left, width - m.right]);

    const stack = d3.stack()
      .keys(stats.seriesNames)
      .offset(d3.stackOffsetWiggle)
      .order(d3.stackOrderInsideOut);
    const layers = stack(data);

    const lo = d3.min(layers, (l) => d3.min(l, (d) => d[0]));
    const hi = d3.max(layers, (l) => d3.max(l, (d) => d[1]));
    const y = d3.scaleLinear().domain([lo, hi]).range([height - m.bottom, m.top]);

    const area = d3.area()
      .x((d) => x(d.data.x))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveBasis);

    // x axis. NOT d3's linear ticks: over epoch milliseconds those land
    // wherever the arithmetic falls, which printed "Jan Jan Feb Mar Apr Apr
    // May" for six monthly points. vf-core's temporalTicks snap to real
    // calendar boundaries so every label is distinct and means something.
    const axis = sel.append('g');
    const want = Math.max(2, Math.round(width / 160));
    const marks = stats.temporal
      ? temporalTicks(stats.firstX, stats.lastX, want)
      : niceTicks(stats.firstX, stats.lastX, want);
    for (const t of marks) {
      if (t < stats.firstX || t > stats.lastX) continue;
      axis.append('text')
        .attr('x', x(t)).attr('y', height - m.bottom + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.62)
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .text(f(t));
    }

    const g = sel.append('g');
    const bands = [];
    layers.forEach((layer, i) => {
      const name = stats.seriesNames[i];
      const color = colors[i % colors.length];
      const path = g.append('path')
        .attr('d', area(layer))
        .attr('fill', color)
        .attr('fill-opacity', 0.92)
        .attr('data-vf-layer', '')
        .attr('data-series', name)
        .style('cursor', 'pointer');

      // HOVER: the band under the cursor holds, every other band drops back,
      // and the readout is the split AT THAT MOMENT rather than a total — a
      // stacked band is only ever read at one x.
      path.on('pointermove', (event) => {
        ctx.motion.hold();
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const xv = x.invert(px);
        let near = data[0];
        for (const d of data) if (Math.abs(d.x - xv) < Math.abs(near.x - xv)) near = d;
        g.selectAll('path').style('opacity', 0.22);
        path.style('opacity', 1);
        const share = near.total ? (near[name] / near.total) * 100 : 0;
        tip.show(
          '<div style="color:' + color + '"><b>' + name + '</b></div>'
          + '<div>' + f(near.x) + ' &middot; <b>' + fmt(near[name]) + '</b></div>'
          + '<div style="opacity:.7">' + share.toFixed(1) + '% of ' + fmt(near.total) + ' that period</div>',
          x(near.x), y((layer[data.indexOf(near)] || [0, 0])[1])
        );
      });
      path.on('pointerleave', () => {
        g.selectAll('path').style('opacity', '');
        tip.hide();
        ctx.motion.free();
      });

      if (isolate) {
        path.style('cursor', 'zoom-in');
        path.on('click', () => {
          tip.hide();
          view.series = name;
          motion.replay();  // a band on its own baseline is a different picture
          ctx.redraw();
        });
      }
      bands.push({ path, name });
    });

    if (isolate) {
      // At the top of the stack there is nothing to go back to, so no bar.
      ctx.trail(null);
      // Coming BACK from an isolation has to restore the stack's own finding —
      // leaving "Core peaks at 2035" over the whole stack describes a picture
      // that is no longer on screen.
      ctx.setCopy({
        headline: streamHeadline(stats),
        dek: `${streamDek(stats)}${ifLive(config, ' Click a band to pull it onto its own zero baseline.')}`,
      });
    }

    // Direct labels at the right, pushed apart so none collide — the gallery's
    // own touch, and what removes the need for a legend.
    const lastIdx = data.length - 1;
    const labs = layers.map((layer, i) => ({
      name: stats.seriesNames[i],
      color: colors[i % colors.length],
      yy: y((layer[lastIdx][0] + layer[lastIdx][1]) / 2),
      v: data[lastIdx][stats.seriesNames[i]],
    })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < labs.length; i += 1) {
      if (labs[i].yy - labs[i - 1].yy < 30) labs[i].yy = labs[i - 1].yy + 30;
    }
    for (const L of labs) {
      sel.append('text')
        .attr('x', width - m.right + 12).attr('y', L.yy)
        .attr('fill', L.color)
        .attr('font-family', 'var(--_fl)').attr('font-size', 12.5).attr('font-weight', 600)
        .text(L.name);
      sel.append('text')
        .attr('x', width - m.right + 12).attr('y', L.yy + 15)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .text(fmt(L.v));
    }

    let attract;
    if (isolate && bands.length > 1) {
      attract = {
        count: Math.min(6, bands.length),
        apply(i, amp) {
          for (const b of bands) b.path.style('opacity', b === bands[i] ? '1' : String(1 - 0.45 * amp));
        },
        clear() { for (const b of bands) b.path.style('opacity', ''); },
      };
    }

    return {
      attract,
      scanBox: { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom },
    };
  },
});

/**
 * ONE BAND, PULLED OUT ONTO A REAL ZERO BASELINE.
 *
 * This is the whole honesty argument for int-stream. Inside the stack, only a
 * band's THICKNESS is readable and its position is layout. Pulled out, it is an
 * area from zero — height IS the value — and that is a DIFFERENT reading of the
 * same numbers, so the piece says out loud that the baseline changed. Silently
 * swapping one for the other is how an interactive streamgraph teaches a reader
 * to misread the stack they go back to.
 */
function drawIsolated(ctx, name) {
  const { d3, sel, width, height, data, stats, colors, tip, fmt, view, motion } = ctx;
  const i = stats.seriesNames.indexOf(name);
  const colour = colors[i % colors.length];
  const f = fmtX(stats);

  const m = { top: 30, right: 26, bottom: 30, left: 58 };
  const points = data.map((d) => ({ x: d.x, v: d[name] || 0, total: d.total }));
  const peak = points.reduce((a, b) => (b.v > a.v ? b : a), points[0]);
  const last = points[points.length - 1];

  const x = d3.scaleLinear().domain([stats.firstX, stats.lastX]).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, Math.max(1, peak.v)]).nice().range([height - m.bottom, m.top]);

  // A REAL AXIS, because there is now a real zero to measure from.
  for (const t of y.ticks(4)) {
    sel.append('line')
      .attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t))
      .attr('stroke', 'var(--_ink)').attr('stroke-opacity', t === 0 ? 0.35 : 0.08);
    sel.append('text')
      .attr('x', m.left - 8).attr('y', y(t) + 4).attr('text-anchor', 'end')
      .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
      .text(fmt(t));
  }
  for (const t of temporalTicks(stats.firstX, stats.lastX, Math.max(2, Math.round(width / 160)))) {
    if (t < stats.firstX || t > stats.lastX) continue;
    sel.append('text')
      .attr('x', x(t)).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
      .attr('font-family', 'var(--_ff)').attr('font-size', 11)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.62)
      .text(f(t));
  }

  const area = d3.area().x((p) => x(p.x)).y0(y(0)).y1((p) => y(p.v)).curve(d3.curveMonotoneX);
  sel.append('path')
    .attr('d', area(points))
    .attr('fill', colour).attr('fill-opacity', 0.9)
    .attr('data-vf-layer', '')
    .attr('data-series', name);

  const hit = sel.append('rect')
    .attr('x', m.left).attr('y', m.top)
    .attr('width', Math.max(1, width - m.right - m.left))
    .attr('height', Math.max(1, height - m.bottom - m.top))
    .attr('fill', 'transparent').style('cursor', 'crosshair');
  hit.on('pointermove', (event) => {
    motion.hold();
    const box = ctx.svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const xv = x.invert(px);
    let near = points[0];
    for (const p of points) if (Math.abs(p.x - xv) < Math.abs(near.x - xv)) near = p;
    tip.show(
      '<div style="color:' + colour + '"><b>' + name + '</b></div>'
      + '<div>' + f(near.x) + ' &middot; <b>' + fmt(near.v) + '</b></div>'
      + '<div style="opacity:.7">' + (near.total ? ((100 * near.v) / near.total).toFixed(1) : '0')
      + '% of the ' + fmt(near.total) + ' that period</div>',
      x(near.x), y(near.v)
    );
  });
  hit.on('pointerleave', () => { tip.hide(); motion.free(); });

  ctx.trail({
    label: 'All bands',
    crumbs: name + ' alone',
    onHome() {
      tip.hide();
      view.series = null;
      motion.replay();
      ctx.redraw();
    },
  });

  ctx.setCopy({
    // "peaks at 2035 and ends at 2035" is what a growth series says when the
    // peak IS the last point — true, and a waste of the one line that states
    // the finding.
    headline: peak === last
      ? name + ' rises to ' + fmt(last.v) + ' by ' + f(last.x)
      : name + ' peaks at ' + fmt(peak.v) + ' and ends at ' + fmt(last.v),
    dek: 'Pulled out of the stack and drawn from a REAL ZERO BASELINE, so its height is the value rather '
      + 'than a thickness — a different reading of the same numbers. It is '
      + (last.total ? ((100 * last.v) / last.total).toFixed(1) : '0') + '% of the total by the end. '
      + ifLive(ctx.config, 'Click "All bands" to put it back.'),
  });

  return { scanBox: { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom } };
}
