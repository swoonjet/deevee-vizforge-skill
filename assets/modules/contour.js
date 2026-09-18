// CONTOUR — the gallery's `unc-contour` ("B2B software lives on two islands"),
// ported to take any two numeric columns over enough rows to have a shape.
//
// HONESTY, and it is a bigger claim than the hexbin's: THIS IS AN ESTIMATE.
// A density surface is not the data — it is a smoothing of the data, and the
// BANDWIDTH decides how much. Too small and every point becomes its own island;
// too large and two real clusters merge into one. There is no correct value, so
// the piece prints the one it used and draws the actual points underneath at
// low opacity, which is the only way a reader can check the surface against
// what it was made from.

import { d3Piece } from './d3-piece.js';
import { xyShape, xyRoles, xyNote, xyHeadline } from './xy-shape.js';
import { resolveAccent, formatNumber, ticks as niceTicks } from './vf-core.js';

export const slug = 'contour';
export const roles = xyRoles;
export const shape = xyShape;

export default d3Piece({
  slug, title: 'Contour', roles, shape,
  build: 'emerge',
  rest: 'ripple',
  restSelect: '[data-vf-shimmer]',
  dur: 4200,
  aspect: 0.56,
  hoverNote: 'Hover a point for its two values.',

  headline: xyHeadline,
  dek(stats) {
    return `${formatNumber(stats.pointCount)} points, smoothed into a density surface — the islands are where `
      + 'they crowd.';
  },
  note: (stats) => xyNote(stats,
    'the surface is an ESTIMATE with a chosen bandwidth, not the data — the points it was made from are drawn '
    + 'underneath so the two can be compared'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const pts = data.points;
    if (pts.length < 3) return null;

    const m = { top: 14, right: 18, bottom: 34, left: 52 };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);
    const sx = (v) => m.left + ((v - stats.xMin) / ((stats.xMax - stats.xMin) || 1)) * plotW;
    const sy = (v) => height - m.bottom - ((v - stats.yMin) / ((stats.yMax - stats.yMin) || 1)) * plotH;

    // Scott's rule, scaled to the plot: a defensible default rather than a
    // number picked to make the picture look good.
    const bandwidth = Math.max(6, Math.min(40, plotW / (2.2 * Math.pow(pts.length, 0.2))));

    const placed = pts.map((p) => [sx(p.x), sy(p.y)]);
    const contours = d3.contourDensity()
      .x((p) => p[0]).y((p) => p[1])
      .size([Math.round(width), Math.round(height)])
      .bandwidth(bandwidth)
      .thresholds(8)(placed);

    const base = colors[0];
    const accent = resolveAccent(ctx.el);
    const maxV = Math.max(...contours.map((c) => c.value)) || 1;

    for (const t of niceTicks(stats.xMin, stats.xMax, Math.max(2, Math.round(width / 160)))) {
      if (t < stats.xMin || t > stats.xMax) continue;
      sel.append('text').attr('x', sx(t)).attr('y', height - m.bottom + 18).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of niceTicks(stats.yMin, stats.yMax, 4)) {
      if (t < stats.yMin || t > stats.yMax) continue;
      sel.append('text').attr('x', m.left - 8).attr('y', sy(t) + 4).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    sel.append('text').attr('x', width - m.right).attr('y', height - m.bottom + 32).attr('text-anchor', 'end')
      .attr('font-family', 'var(--_fl)').attr('font-size', 11)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.7).text(stats.xName);
    sel.append('text').attr('x', m.left - 8).attr('y', m.top + 2).attr('text-anchor', 'end')
      .attr('font-family', 'var(--_fl)').attr('font-size', 11)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.7).text(stats.yName);

    const path = d3.geoPath();
    contours.forEach((c, i) => {
      sel.append('path')
        .attr('d', path(c))
        .attr('fill', i === contours.length - 1 ? accent || base : base)
        .attr('fill-opacity', 0.1 + 0.72 * (c.value / maxV))
        .attr('stroke', 'var(--_paper)').attr('stroke-width', 0.6)
        .attr('data-vf-shimmer', '');
    });

    // THE POINTS THE SURFACE WAS MADE FROM, underneath it in weight and on top
    // of it in the DOM, so the estimate can be checked against the evidence.
    const dots = [];
    const r = pts.length > 800 ? 1.1 : pts.length > 250 ? 1.7 : 2.6;
    for (const p of pts) {
      const dot = sel.append('circle')
        .attr('cx', sx(p.x)).attr('cy', sy(p.y)).attr('r', r)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.34)
        .style('cursor', 'crosshair');
      dots.push(dot);
      dot.on('pointerenter', () => {
        motion.hold();
        dot.attr('r', r + 2.4).attr('fill-opacity', 0.9);
        tip.show(
          `<div><b>${stats.xName}</b> ${fmt(p.x)}</div><div><b>${stats.yName}</b> ${fmt(p.y)}</div>`,
          sx(p.x), sy(p.y)
        );
      });
      dot.on('pointerleave', () => {
        dot.attr('r', r).attr('fill-opacity', 0.34);
        tip.hide();
        motion.free();
      });
    }

    ctx.setCopy({ dekAppend: `Bandwidth ${bandwidth.toFixed(0)}px, eight levels.` });

    return null;
  },
});
