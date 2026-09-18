// MARIMEKKO — the gallery's `unc-marimekko` ("The cloud market grew
// seven-fold"), ported to take any group / segment / value table.
//
// HONESTY: BOTH AXES ARE SHARES, which is what makes this form worth the
// trouble. A column's WIDTH is that group's share of the whole, a segment's
// HEIGHT is its share of its own column, and therefore every rectangle's AREA
// is its real share of the total. Read a tile against any other tile and the
// comparison holds — which is not true of a stacked bar chart with equal
// widths, the form this one is usually mistaken for.
//
// The consequence to state plainly: neither axis carries a UNIT. The numbers on
// the piece are percentages of a stated whole, and the whole is printed.

import { d3Piece } from './d3-piece.js';
import {
  hierShape, hierRoles, hierNote, groupColors, colorOf,
} from './hier-shape.js';
import { resolveAccent, fitText, formatNumber } from './vf-core.js';

export const slug = 'marimekko';
export const roles = {
  parent: { ...hierRoles.parent, label: 'Column' },
  child: { ...hierRoles.child, label: 'Split inside the column' },
  value: { ...hierRoles.value, label: 'Amount' },
};
export const shape = hierShape;

export default d3Piece({
  slug, title: 'Marimekko', roles, shape,
  build: 'grow',
  rest: 'peak',
  dur: 3600,
  aspect: 0.56,
  hoverNote: 'Hover a block for its share of its column and of the whole.',

  headline(stats) {
    const g = stats.biggestGroup;
    if (!g) return 'Nothing to divide';
    return `${g.name} is ${Math.round(g.share * 100)}% of the ${formatNumber(stats.total)} total`;
  },
  dek(stats) {
    return `${stats.groupCount} columns split ${stats.leafCount} ways — column width is each column's share of `
      + 'the whole, and the split inside it is that column\'s own 100%.';
  },
  note: (stats) => hierNote(stats,
    'both axes are shares, so every rectangle\'s AREA is its real share of the total — unlike a stacked bar, '
    + 'where the columns are all the same width'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    if (!data.children || !data.children.length) return null;

    const m = { top: 26, right: 8, bottom: 34, left: 44 };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);
    const gap = Math.min(4, plotW / (data.children.length * 8));

    const star = stats.biggestGroup ? stats.biggestGroup.name : null;
    const palette = groupColors(stats, colors, { accent: resolveAccent(ctx.el), star });

    // The y axis is a PERCENTAGE axis and says so, because the heights are
    // shares of each column rather than of the whole.
    for (const p of [0, 25, 50, 75, 100]) {
      const yy = m.top + plotH * (1 - p / 100);
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', yy).attr('y2', yy)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', p === 0 ? 0.3 : 0.08);
      sel.append('text').attr('x', m.left - 8).attr('y', yy + 4).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
        .text(`${p}%`);
    }

    const tiles = [];
    let x = m.left;

    data.children.forEach((group, gi) => {
      const w = Math.max(1, (group.value / (stats.total || 1)) * (plotW - gap * (data.children.length - 1)));
      const colour = colorOf(palette, colors, group.name);
      const kids = group.children || [{ name: group.name, value: group.value }];
      let y = m.top;

      kids.forEach((kid, ki) => {
        const h = Math.max(1, (kid.value / (group.value || 1)) * plotH);
        const rect = sel.append('rect')
          .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
          .attr('fill', colour)
          // The only thing the tint carries is "further down this column", so
          // it steps evenly and never near the ends where it would read as a
          // second measure.
          .attr('fill-opacity', 0.9 - Math.min(0.45, ki * 0.13))
          .attr('stroke', 'var(--_paper)').attr('stroke-width', 1)
          .attr('data-vf-grow', 'up')
          .attr('data-vf-order', gi)
          .attr('data-name', kid.name);
        if (group.name === star && ki === 0) rect.attr('data-vf-peak', '');

        const label = w > 54 && h > 26 ? fitText(kid.name, w - 12, 11.5) : null;
        if (label) {
          sel.append('text')
            .attr('x', x + 6).attr('y', y + 16)
            .attr('font-family', 'var(--_fl)').attr('font-size', 11.5).attr('font-weight', 600)
            .attr('fill', 'var(--_paper)').attr('pointer-events', 'none')
            .text(label);
          if (h > 40) {
            sel.append('text')
              .attr('x', x + 6).attr('y', y + 31)
              .attr('font-family', 'var(--_ff)').attr('font-size', 10)
              .attr('fill', 'var(--_paper)').attr('fill-opacity', 0.85).attr('pointer-events', 'none')
              .text(`${Math.round((100 * kid.value) / (group.value || 1))}%`);
          }
        }

        const rec = { rect, group: group.name };
        tiles.push(rec);
        rect.on('pointerenter', () => {
          motion.hold();
          for (const t of tiles) t.rect.style('opacity', t === rec ? 1 : (t.group === group.name ? 0.5 : 0.16));
        });
        rect.on('pointermove', (event) => {
          const box = ctx.svg.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * width;
          const py = ((event.clientY - box.top) / box.height) * height;
          tip.show(
            `<div style="color:${colour}"><b>${kid.name}</b></div>`
            + `<div><b>${fmt(kid.value)}</b> &middot; ${Math.round((100 * kid.value) / (group.value || 1))}% of ${group.name}</div>`
            + `<div style="opacity:.7">${((100 * kid.value) / (stats.total || 1)).toFixed(1)}% of the ${fmt(stats.total)} whole</div>`,
            px, py
          );
        });
        rect.on('pointerleave', () => {
          for (const t of tiles) t.rect.style('opacity', '');
          tip.hide();
          motion.free();
        });

        y += h;
      });

      // The column's own name and its width-share, under the axis.
      const head = fitText(group.name, w + 6, 11);
      if (head) {
        sel.append('text')
          .attr('x', x + w / 2).attr('y', height - m.bottom + 15).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11).attr('font-weight', 600)
          .attr('fill', group.name === star ? 'var(--_accent)' : 'var(--_ink)')
          .attr('fill-opacity', group.name === star ? 1 : 0.8)
          .text(head);
        sel.append('text')
          .attr('x', x + w / 2).attr('y', height - m.bottom + 28).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_ff)').attr('font-size', 10)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
          .text(`${Math.round((100 * group.value) / (stats.total || 1))}%`);
      }

      x += w + gap;
    });

    return null;
  },
});
