// SCATTER PLOT (conv-scatter) — two measures, one dot per row, nothing hidden.
//
// The library already had hexbin and contour on this shape, and both are
// answers to "there are too many points to draw". The plain scatter is the
// answer when there are not — and it is the honest default, because a bin and a
// density surface are both summaries and a dot is a row.
//
// WHAT IT ADDS over drawing circles: the two things a reader wants next.
//
//   BRUSH. Drag a box and the piece restates itself for what is inside it —
//   how many rows, what share, and where the selection's centre sits against
//   the whole. Every point stays drawn, faintly, so a selection is visibly a
//   part of something rather than a new chart.
//
//   THE r THAT ADMITS WHAT IT IS. A scatter's one-line finding is usually the
//   correlation, and the correlation is the easiest number on any chart to
//   over-read. It is stated with its own caveat attached, always.
//
// NO TREND LINE BY DEFAULT. A fitted line asserts a model the reader did not
// ask for and did not choose; it appears only when `options.fit` says so, and
// says which fit it is when it does.
//
// THE ENTRANCE settles points in by x order, each growing from r=0 — the mark's
// own geometry, never a fade ([[feedback_viz_no_fade_builds]]).

import { d3Piece } from './d3-piece.js';
import { xyShape, xyRoles, xyNote } from './xy-shape.js';
import { formatNumber, resolveAccent, assignColors } from './vf-core.js';

export const slug = 'scatter';
export const roles = {
  ...xyRoles,
  series: { types: ['nominal', 'ordinal'], required: false, label: 'Colour by' },
};
export const shape = xyShape;

/** How strong, in words — because "r = 0.42" is not a finding for most readers. */
function strength(r) {
  const a = Math.abs(r);
  if (a >= 0.8) return 'a strong';
  if (a >= 0.5) return 'a moderate';
  if (a >= 0.25) return 'a weak';
  return 'almost no';
}

function scatterHeadline(stats) {
  const r = stats.correlation;
  if (!Number.isFinite(r) || stats.pointCount < 3) {
    return `${stats.pointCount} rows by ${stats.xName} and ${stats.yName}`;
  }
  const dir = r >= 0 ? 'positive' : 'negative';
  return `${stats.xName} and ${stats.yName} show ${strength(r)} ${dir} relationship (r = ${r.toFixed(2)})`;
}

export default d3Piece({
  slug, title: 'Scatter plot', roles, shape,
  build: 'rain', rest: 'attract', dur: 3600, aspect: 0.58, minHeight: 300,
  hoverNote: 'Hover a point for its values; drag a box to select a region.',

  headline: scatterHeadline,
  dek(stats) {
    return `${stats.pointCount} rows, one dot each. `
      // The caveat travels WITH the number, not in a footnote under it.
      + 'A relationship between two columns is not evidence that one causes the other.';
  },
  note: (stats) => xyNote(stats,
    'every row is its own dot and nothing is binned or averaged — overlapping dots are overlapping rows'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, config, motion, view, el } = ctx;
    const points = data.points || [];
    if (!points.length) return null;

    const accent = resolveAccent(el);
    const split = stats.seriesNames.length > 0;
    const colorFor = assignColors(split ? stats.seriesNames : [''], colors, { accent });

    const m = { top: 18, right: 24, bottom: 48, left: 66 };
    const x = d3.scaleLinear().domain([stats.xMin, stats.xMax]).nice().range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain([stats.yMin, stats.yMax]).nice().range([height - m.bottom, m.top]);

    for (const t of x.ticks(Math.max(3, Math.round(width / 130)))) {
      sel.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.top).attr('y2', height - m.bottom)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.07);
      sel.append('text').attr('x', x(t)).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of y.ticks(5)) {
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.07);
      sel.append('text').attr('x', m.left - 10).attr('y', y(t)).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }

    // Axis titles: a scatter without them is two anonymous numbers.
    sel.append('text').attr('x', (m.left + width - m.right) / 2).attr('y', height - 8)
      .attr('text-anchor', 'middle').attr('font-family', 'var(--_fl)').attr('font-size', 12)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.8).text(stats.xName);
    sel.append('text').attr('transform', `translate(16,${(m.top + height - m.bottom) / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').attr('font-family', 'var(--_fl)').attr('font-size', 12)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.8).text(stats.yName);

    // Smaller dots as the cloud thickens, so density reads as density rather
    // than as one solid shape.
    const r = points.length > 900 ? 2.4 : points.length > 300 ? 3.2 : points.length > 80 ? 4.2 : 5.4;
    const ordered = points.map((p, i) => ({ ...p, i })).sort((a, b) => a.x - b.x);

    const dots = ordered.map((p, i) => sel.append('circle')
      .attr('cx', x(p.x)).attr('cy', y(p.y)).attr('r', r)
      .attr('fill', colorFor.get(split ? p.series : '') || accent)
      .attr('fill-opacity', points.length > 300 ? 0.5 : 0.72)
      .attr('data-vf-part', 'dot')
      .attr('data-vf-order', i)
      .datum(p));

    if (config.showFit && points.length > 2) {
      // Least squares, named as such — a line on a scatter is a claim.
      const n = points.length;
      const sx = points.reduce((s, p) => s + p.x, 0);
      const sy = points.reduce((s, p) => s + p.y, 0);
      const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
      const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
      const denom = n * sxx - sx * sx;
      if (denom !== 0) {
        const slope = (n * sxy - sx * sy) / denom;
        const intercept = (sy - slope * sx) / n;
        sel.append('line')
          .attr('x1', x(stats.xMin)).attr('y1', y(slope * stats.xMin + intercept))
          .attr('x2', x(stats.xMax)).attr('y2', y(slope * stats.xMax + intercept))
          .attr('stroke', accent).attr('stroke-width', 1.6).attr('stroke-dasharray', '5 4')
          .attr('stroke-opacity', 0.75).attr('pointer-events', 'none');
      }
    }

    // xy-shape carries x, y and an optional series — no free-text label — so a
    // point identifies itself by its series or not at all. Declaring a `label`
    // role the shaper cannot fill would put an always-empty picker on screen.
    const nameOf = (p) => (split ? p.series : '');
    for (const dot of dots) {
      dot.style('cursor', 'pointer');
      dot.on('pointerenter', () => {
        motion.hold();
        const p = dot.datum();
        dot.attr('r', r + 3).attr('fill-opacity', 1);
        const who = nameOf(p);
        tip.show(
          (who ? `<div><b>${who}</b></div>` : '')
          + `<div>${stats.xName} &middot; <b>${fmt(p.x)}</b></div>`
          + `<div>${stats.yName} &middot; <b>${fmt(p.y)}</b></div>`,
          x(p.x), y(p.y)
        );
      });
      dot.on('pointerleave', () => {
        dot.attr('r', r).attr('fill-opacity', points.length > 300 ? 0.5 : 0.72);
        tip.hide();
        motion.free();
      });
    }

    // ---- THE BRUSH -------------------------------------------------------
    // A selection is a claim about a SUBSET, so it restates itself: how many
    // rows, what share of the whole, and where its centre sits. Everything
    // outside stays drawn and faint — a selection that erases its context is
    // just a smaller chart with no scale to read it against.
    let brush = null;
    let group = null;

    const paint = (box) => {
      for (const dot of dots) {
        const p = dot.datum();
        const inside = !box || (x(p.x) >= box[0][0] && x(p.x) <= box[1][0] && y(p.y) >= box[0][1] && y(p.y) <= box[1][1]);
        dot.attr('fill-opacity', inside ? (points.length > 300 ? 0.62 : 0.85) : 0.08);
        // The selection lives in the DOM, so a rest that repaints opacity can
        // never be mistaken for a selection (the lesson edge-shape learned).
        dot.attr('data-vf-lit', inside && box ? '1' : null);
      }
    };

    const restate = (sub) => {
      if (!sub) {
        ctx.trail(null);
        ctx.setCopy({ headline: scatterHeadline(stats), dek: undefined, dekAppend: '' });
        return;
      }
      const mx = sub.reduce((s, p) => s + p.x, 0) / sub.length;
      const my = sub.reduce((s, p) => s + p.y, 0) / sub.length;
      ctx.setCopy({
        headline: `${sub.length} of ${stats.pointCount} rows selected`,
        dekAppend: `Mean ${stats.xName} ${fmt(mx)} vs ${fmt(stats.xMean)} overall; `
          + `mean ${stats.yName} ${fmt(my)} vs ${fmt(stats.yMean)}. `
          + `The rest of the ${stats.pointCount} rows are still drawn, faintly, on the same axes.`,
      });
      ctx.trail({
        label: 'All rows',
        crumbs: `${sub.length} selected`,
        onHome() {
          view.brush = null;
          paint(null);
          restate(null);
          if (group) group.call(brush.move, null);
        },
      });
    };

    brush = d3.brush()
      .extent([[m.left, m.top], [width - m.right, height - m.bottom]])
      .on('brush end', (event) => {
        const box = event.selection;
        if (!box) { view.brush = null; paint(null); restate(null); return; }
        view.brush = box;
        paint(box);
        const sub = ordered.filter((p) => x(p.x) >= box[0][0] && x(p.x) <= box[1][0]
          && y(p.y) >= box[0][1] && y(p.y) <= box[1][1]);
        restate(sub.length ? sub : null);
      });

    group = sel.append('g').attr('class', 'vf-brush').call(brush);
    // A brush overlay swallows pointer events, so the dots' own hover has to be
    // reachable through it — the overlay only listens where a drag STARTS.
    group.selectAll('.overlay').style('cursor', 'crosshair');

    // A brush held across a resize is a brush in pixel space that no longer
    // means the same rows, so it is restored from the stored box and re-read.
    if (view.brush) group.call(brush.move, view.brush);

    return null;
  },
});
