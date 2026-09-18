// PUNCHCARD — the gallery's `unc-punchcard` ("One project clocks in; the other
// never sleeps"), ported to take any two crossed categories and a count.
//
// HONESTY: DOT AREA IS THE COUNT, so the radius is a square root — the same
// rule the rose and the circle pack obey, and for the same reason. A grid of
// dots invites the eye to compare areas, and sizing by radius would make a busy
// cell look several times busier than it is.
//
// An EMPTY CELL IS A REAL ZERO, not missing data, and the piece says so: the
// two categories are crossed exhaustively, so every combination that could have
// happened has a place on the grid whether it happened or not. That is the
// whole point of the form — the gaps are the finding.
//
// It rides edge-shape because "row category, column category, weight" is
// exactly an edge list, and its square matrix is exactly this grid.

import { d3Piece } from './d3-piece.js';
import { edgeShape, edgeNote } from './edge-shape.js';
import { resolveAccent, fitText, formatNumber } from './vf-core.js';

export const slug = 'punchcard';
export const roles = {
  row: { types: ['nominal', 'ordinal'], required: true, label: 'Rows' },
  col: { types: ['nominal', 'ordinal'], required: true, label: 'Columns' },
  value: { types: ['quantitative'], required: false, label: 'Count' },
};
export const shape = (rows, bindings = {}) => edgeShape(rows, {
  source: bindings.row || bindings.source,
  target: bindings.col || bindings.target,
  value: bindings.value,
});

export default d3Piece({
  slug, title: 'Punchcard', roles, shape,
  build: 'wave',
  rest: 'wavebreathe',
  restSelect: '[data-vf-cell]',
  dur: 4000,
  aspect: 0.5,
  hoverNote: 'Hover a cell for its exact count.',

  headline(stats) {
    const l = stats.biggestLink;
    if (!l) return 'Nothing crossed';
    return `${l.sourceName} × ${l.targetName} is the busiest cell, at ${formatNumber(l.value)}`;
  },
  dek(stats) {
    return `${stats.linkCount} of the combinations happened at all, out of everything the two columns could `
      + `cross — ${formatNumber(stats.total)} in total.`;
  },
  note: (stats) => edgeNote(stats,
    'dot AREA is the count, so the radius is a square root — and an empty cell is a real zero, not a gap in '
    + 'the data'),

  draw(ctx) {
    const { sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    if (!data.links.length) return null;

    // The two axes are the two BOUND COLUMNS' own vocabularies, in arrival
    // order — a punchcard is read as a cycle (Monday to Sunday, 0 to 23), and
    // sorting either axis by its total would destroy that.
    const rowNames = [];
    const colNames = [];
    for (const l of [...data.links].sort((a, b) => a.source - b.source || a.target - b.target)) {
      if (!rowNames.includes(l.sourceName)) rowNames.push(l.sourceName);
      if (!colNames.includes(l.targetName)) colNames.push(l.targetName);
    }
    rowNames.sort((a, b) => stats.nodeNames.indexOf(a) - stats.nodeNames.indexOf(b));
    colNames.sort((a, b) => stats.nodeNames.indexOf(a) - stats.nodeNames.indexOf(b));

    const labelRoom = Math.min(170, Math.max(70, width * 0.13));
    const m = { top: 24, right: 20, bottom: 28, left: labelRoom };
    const cw = Math.max(6, (width - m.left - m.right) / colNames.length);
    const ch = Math.max(6, (height - m.top - m.bottom) / rowNames.length);
    const maxV = Math.max(...data.links.map((l) => l.value)) || 1;
    const rMax = Math.max(2, Math.min(cw, ch) / 2 - 1.5);
    const radius = (v) => Math.max(1, rMax * Math.sqrt(v / maxV));

    const accent = resolveAccent(ctx.el);
    const base = colors[0];
    const star = stats.biggestLink;

    // Axis labels first, so a dot always sits on top of its own gridline.
    colNames.forEach((name, ci) => {
      const label = fitText(name, cw + 8, 10.5);
      if (label) {
        sel.append('text')
          .attr('x', m.left + ci * cw + cw / 2).attr('y', m.top - 9).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
          .text(label);
      }
    });
    rowNames.forEach((name, ri) => {
      const label = fitText(name, labelRoom - 14, 11.5);
      if (label) {
        sel.append('text')
          .attr('x', m.left - 10).attr('y', m.top + ri * ch + ch / 2 + 4).attr('text-anchor', 'end')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.8)
          .text(label);
      }
      sel.append('line')
        .attr('x1', m.left).attr('x2', width - m.right)
        .attr('y1', m.top + ri * ch + ch / 2).attr('y2', m.top + ri * ch + ch / 2)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.06);
    });

    const cells = [];
    rowNames.forEach((rowName, ri) => {
      colNames.forEach((colName, ci) => {
        const si = stats.nodeNames.indexOf(rowName);
        const ti = stats.nodeNames.indexOf(colName);
        const v = (data.matrix[si] && data.matrix[si][ti]) || 0;
        const cx = m.left + ci * cw + cw / 2;
        const cy = m.top + ri * ch + ch / 2;
        const isStar = star && star.sourceName === rowName && star.targetName === colName;

        if (!v) {
          // A real zero gets a mark of its own — a faint one — so the reader
          // can tell "this never happened" from "this cell is off the chart".
          sel.append('circle')
            .attr('cx', cx).attr('cy', cy).attr('r', 1.2)
            .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.16)
            .attr('data-vf-cell', '');
          return;
        }

        const dot = sel.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', radius(v))
          .attr('fill', isStar ? accent || base : base)
          .attr('fill-opacity', isStar ? 0.95 : 0.72)
          .attr('data-vf-cell', '')
          .style('cursor', 'pointer');
        if (isStar) dot.attr('data-vf-peak', '');
        const rec = { dot, rowName, colName, v };
        cells.push(rec);

        dot.on('pointerenter', () => {
          motion.hold();
          for (const other of cells) other.dot.style('opacity', other === rec ? 1 : 0.25);
        });
        dot.on('pointermove', () => {
          tip.show(
            `<div><b>${rowName} × ${colName}</b></div>`
            + `<div><b>${fmt(v)}</b></div>`
            + `<div style="opacity:.7">${((100 * v) / (stats.total || 1)).toFixed(1)}% of the ${fmt(stats.total)} total</div>`,
            cx, cy
          );
        });
        dot.on('pointerleave', () => {
          for (const other of cells) other.dot.style('opacity', '');
          tip.hide();
          motion.free();
        });
      });
    });

    return null;
  },
});
