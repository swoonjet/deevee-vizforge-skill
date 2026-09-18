// HEXBIN — the gallery's `unc-hexbin` ("Nobody ships on Sunday"), ported to
// take any two numeric columns over enough rows to overplot.
//
// HONESTY: THE BIN SIZE IS A CHOICE AND IT CHANGES THE PICTURE. Bigger hexes
// smooth the field into a blob; smaller ones scatter it into confetti. There is
// no neutral setting, so the piece PRINTS the radius it used and the count of
// the fullest bin — without those two numbers a reader cannot tell a real
// cluster from an artefact of the binning.
//
// Colour is a sequential ramp over the COUNT, which is a count of rows and
// nothing else. A hexbin says where the rows pile up; it says nothing about
// what those rows are worth.

import { d3Piece } from './d3-piece.js';
import { xyShape, xyRoles, xyNote, hexBins, hexagonPath } from './xy-shape.js';
import { resolveAccent, formatNumber, ticks as niceTicks } from './vf-core.js';

export const slug = 'hexbin';
export const roles = xyRoles;
export const shape = xyShape;

export default d3Piece({
  slug, title: 'Hexbin', roles, shape,
  build: 'wave',
  rest: 'wavebreathe',
  restSelect: '[data-vf-cell]',
  dur: 3800,
  aspect: 0.56,
  hoverNote: 'Hover a hex for how many rows fell in it.',

  headline(stats) {
    return `${formatNumber(stats.pointCount)} rows of ${stats.xName} against ${stats.yName}, `
      + 'binned so the crowd is visible';
  },
  dek(stats) {
    return `Where the points pile up, rather than a black mass — ${formatNumber(stats.pointCount)} rows in all.`;
  },
  note: (stats) => xyNote(stats,
    'colour is the COUNT of rows in each hex, and the bin size is a choice that changes the picture, so it is '
    + 'printed on the piece'),

  draw(ctx) {
    const { sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const pts = data.points;
    if (!pts.length) return null;

    const m = { top: 14, right: 18, bottom: 34, left: 52 };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);

    const sx = (v) => m.left + ((v - stats.xMin) / ((stats.xMax - stats.xMin) || 1)) * plotW;
    const sy = (v) => height - m.bottom - ((v - stats.yMin) / ((stats.yMax - stats.yMin) || 1)) * plotH;

    // A RADIUS FROM THE DATA, not a constant: enough hexes across the plot to
    // show structure, few enough that each one holds a countable crowd.
    const across = Math.max(8, Math.min(34, Math.round(Math.sqrt(pts.length) * 1.6)));
    const radius = Math.max(4, plotW / (across * 1.8));

    const placed = pts.map((p) => ({ ...p, px: sx(p.x), py: sy(p.y) }));
    const bins = hexBins(placed, radius);
    const maxCount = Math.max(...bins.map((b) => b.count));
    const accent = resolveAccent(ctx.el);
    const base = colors[0];
    const hex = hexagonPath(radius);

    // Axes: the LABELS are rounded, the domain is not.
    for (const t of niceTicks(stats.xMin, stats.xMax, Math.max(2, Math.round(width / 160)))) {
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

    const cells = [];
    for (const bin of bins) {
      const t = bin.count / maxCount;
      const isPeak = bin.count === maxCount;
      const cell = sel.append('path')
        .attr('d', hex)
        .attr('transform', `translate(${bin.x.toFixed(2)},${bin.y.toFixed(2)})`)
        .attr('fill', isPeak ? accent || base : base)
        .attr('fill-opacity', 0.18 + 0.8 * t)
        .attr('data-vf-cell', '')
        .style('cursor', 'pointer');
      if (isPeak) cell.attr('data-vf-peak', '');
      const rec = { cell, bin };
      cells.push(rec);

      cell.on('pointerenter', () => {
        motion.hold();
        for (const other of cells) other.cell.style('opacity', other === rec ? 1 : 0.3);
      });
      cell.on('pointermove', () => {
        const mx = bin.points.reduce((s, p) => s + p.x, 0) / bin.count;
        const my = bin.points.reduce((s, p) => s + p.y, 0) / bin.count;
        tip.show(
          `<div><b>${fmt(bin.count)} ${bin.count === 1 ? 'row' : 'rows'}</b></div>`
          + `<div style="opacity:.8">around ${stats.xName} ${fmt(mx)}, ${stats.yName} ${fmt(my)}</div>`
          + `<div style="opacity:.6">${((100 * bin.count) / stats.pointCount).toFixed(1)}% of all rows</div>`,
          bin.x, bin.y
        );
      });
      cell.on('pointerleave', () => {
        for (const other of cells) other.cell.style('opacity', '');
        tip.hide();
        motion.free();
      });
    }

    // THE TWO NUMBERS THAT MAKE THE PICTURE READABLE.
    ctx.setCopy({
      dekAppend: `${bins.length} hexes of radius ${radius.toFixed(1)}px; the fullest holds `
        + `${fmt(maxCount)} rows.`,
    });

    return null;
  },
});
