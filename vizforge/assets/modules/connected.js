// CONNECTED SCATTER — the gallery's `conv-connected` ("The cloud chase"),
// ported to take two numeric columns threaded by a date.
//
// HONESTY: THE LINE IS A CONNECTOR IN TIME, NOT INTERPOLATION. Between two
// dots the path says only "this came after that" — it does not claim the pair
// passed through the points along the way, and it is drawn as a soft curve
// precisely so it does not read as a fitted trend. Every dot is a real
// observation; the first and last are labelled, because a loop with no anchors
// cannot be read at all.

import { d3Piece } from './d3-piece.js';
import { xyShape, xyRoles, xyNote } from './xy-shape.js';
import { resolveAccent, formatNumber, formatTemporal, ticks as niceTicks } from './vf-core.js';

export const slug = 'connected';
export const roles = {
  ...xyRoles,
  t: { types: ['temporal', 'quantitative'], required: true, label: 'Time (threads the path)' },
  series: { types: ['nominal', 'ordinal'], required: false, label: 'One path each' },
};
export const shape = xyShape;

export default d3Piece({
  slug, title: 'Connected scatter', roles, shape,
  build: 'trace',
  rest: 'tracer',
  dur: 4200,
  aspect: 0.56,
  hoverNote: 'Hover a point for its moment and both values.',

  headline(stats) {
    return `${stats.xName} against ${stats.yName}, threaded in time`;
  },
  dek(stats) {
    return `${formatNumber(stats.pointCount)} observations`
      + (stats.seriesCount > 1 ? ` across ${stats.seriesCount} paths` : '')
      + ' — each dot is one moment, and the line only says which came next.';
  },
  note: (stats) => xyNote(stats,
    'the line between two dots is a CONNECTOR IN TIME, not a fitted trend and not interpolation — nothing is '
    + 'claimed about the values between them'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const pts = data.points.filter((p) => Number.isFinite(p.t));
    if (pts.length < 2) return null;

    const m = { top: 16, right: 24, bottom: 34, left: 56 };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);
    const sx = (v) => m.left + ((v - stats.xMin) / ((stats.xMax - stats.xMin) || 1)) * plotW;
    const sy = (v) => height - m.bottom - ((v - stats.yMin) / ((stats.yMax - stats.yMin) || 1)) * plotH;

    const tSpan = Math.max(...pts.map((p) => p.t)) - Math.min(...pts.map((p) => p.t));
    const looksTemporal = tSpan > 86400000;
    const fmtT = (v) => (looksTemporal ? formatTemporal(v, tSpan) : formatNumber(v));

    const byName = new Map();
    for (const p of pts) {
      const name = p.series === undefined ? '' : p.series;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(p);
    }
    for (const path of byName.values()) path.sort((a, b) => a.t - b.t);

    const names = [...byName.keys()];
    const accent = resolveAccent(ctx.el);

    for (const t of niceTicks(stats.xMin, stats.xMax, Math.max(2, Math.round(width / 170)))) {
      if (t < stats.xMin || t > stats.xMax) continue;
      sel.append('text').attr('x', sx(t)).attr('y', height - m.bottom + 18).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of niceTicks(stats.yMin, stats.yMax, 4)) {
      if (t < stats.yMin || t > stats.yMax) continue;
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', sy(t)).attr('y2', sy(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.07);
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

    const line = d3.line().x((p) => sx(p.x)).y((p) => sy(p.y)).curve(d3.curveCatmullRom.alpha(0.5));
    const dots = [];

    names.forEach((name, i) => {
      const path = byName.get(name);
      const colour = names.length === 1 ? colors[0] : colors[i % colors.length];

      sel.append('path')
        .attr('d', line(path))
        .attr('fill', 'none')
        .attr('stroke', colour)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.75)
        .attr('stroke-linecap', 'round');

      path.forEach((p, k) => {
        const end = k === path.length - 1;
        const startPoint = k === 0;
        const dot = sel.append('circle')
          .attr('cx', sx(p.x)).attr('cy', sy(p.y))
          .attr('r', end ? 5.5 : 3.6)
          .attr('fill', end ? accent || colour : colour)
          .attr('fill-opacity', end || startPoint ? 1 : 0.8)
          .attr('stroke', 'var(--_paper)').attr('stroke-width', end ? 1.6 : 0.8)
          .style('cursor', 'pointer');
        if (end) dot.attr('data-vf-peak', '');
        dots.push({ dot, p, base: end ? 5.5 : 3.6 });

        // THE TWO ANCHORS a loop needs: where it started, where it ended.
        if (startPoint || end) {
          sel.append('text')
            .attr('x', sx(p.x) + 9).attr('y', sy(p.y) + (end ? -8 : 14))
            .attr('font-family', 'var(--_ff)').attr('font-size', 10.5).attr('font-weight', end ? 700 : 400)
            .attr('fill', end ? 'var(--_accent)' : 'var(--_ink)')
            .attr('fill-opacity', end ? 1 : 0.65)
            .attr('stroke', 'var(--_paper)').attr('stroke-width', 3).attr('paint-order', 'stroke')
            .attr('pointer-events', 'none')
            .text(`${names.length > 1 && end ? `${name} · ` : ''}${fmtT(p.t)}`);
        }
      });
    });

    for (const rec of dots) {
      rec.dot.on('pointerenter', () => {
        motion.hold();
        rec.dot.attr('r', rec.base + 2.5);
      });
      rec.dot.on('pointermove', () => {
        tip.show(
          `<div><b>${fmtT(rec.p.t)}</b>${rec.p.series ? ` &middot; ${rec.p.series}` : ''}</div>`
          + `<div>${stats.xName} <b>${fmt(rec.p.x)}</b></div>`
          + `<div>${stats.yName} <b>${fmt(rec.p.y)}</b></div>`,
          sx(rec.p.x), sy(rec.p.y)
        );
      });
      rec.dot.on('pointerleave', () => {
        rec.dot.attr('r', rec.base);
        tip.hide();
        motion.free();
      });
    }

    return null;
  },
});
