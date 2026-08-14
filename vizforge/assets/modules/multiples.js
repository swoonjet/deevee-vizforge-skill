// SMALL MULTIPLES (conv-multiples) — one panel per series, all on ONE shared
// scale so panels are comparable to each other. That shared scale is the whole
// point and is stated in the source line; per-panel scales would make six
// unrelated charts that look like a comparison.
import { d3Piece } from './d3-piece.js';
import { tsShape, tsRoles, tsFmtX, tsHeadline, tsDek } from './ts-shape.js';

export const slug = 'multiples';
export const roles = tsRoles;
export const shape = tsShape;

export default d3Piece({
  slug, title: 'Small multiples', roles, shape,
  build: 'trace', rest: 'peak', dur: 5400, aspect: 0.55,
  hoverNote: 'Hover a panel for its values.',
  headline: tsHeadline,
  dek: (s) => tsDek(s, 'one panel each, all on one shared scale'),
  note: 'every panel shares one y-scale, so panel heights compare directly',

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt } = ctx;
    if (!data.length) return null;
    const f = tsFmtX(stats);

    const cols = Math.min(data.length, Math.max(2, Math.round(width / 260)));
    const rows = Math.ceil(data.length / cols);
    const pad = { top: 26, right: 14, bottom: 22, left: 40 };
    const cw = width / cols;
    const ch = height / rows;

    const y = d3.scaleLinear().domain([Math.min(0, stats.minY), stats.maxY]).nice()
      .range([ch - pad.bottom, pad.top]);
    const x = d3.scaleLinear().domain([stats.firstX, stats.lastX]);

    data.forEach((s, i) => {
      const gx = (i % cols) * cw;
      const gy = Math.floor(i / cols) * ch;
      const g = sel.append('g').attr('transform', 'translate(' + gx + ',' + gy + ')');
      x.range([pad.left, cw - pad.right]);

      g.append('text').attr('x', pad.left).attr('y', 15)
        .attr('fill', 'var(--_ink)').attr('font-family', 'var(--_fl)')
        .attr('font-size', 12).attr('font-weight', 600).text(s.name || 'All');

      for (const t of y.ticks(3)) {
        g.append('line').attr('x1', pad.left).attr('x2', cw - pad.right)
          .attr('y1', y(t)).attr('y2', y(t))
          .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.08);
        if (i % cols === 0) {
          g.append('text').attr('x', pad.left - 7).attr('y', y(t))
            .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
            .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
            .attr('font-family', 'var(--_ff)').attr('font-size', 9.5).text(fmt(t));
        }
      }

      // The FAINT context lines: every other series behind this one, so a panel
      // is read against the whole set rather than in isolation.
      for (const other of data) {
        if (other === s) continue;
        g.append('path')
          .attr('d', d3.line().x((p) => x(p.x)).y((p) => y(p.y))(other.points))
          .attr('fill', 'none').attr('stroke', 'var(--_ink)')
          .attr('stroke-opacity', 0.1).attr('stroke-width', 1);
      }

      const color = colors[i % colors.length];
      g.append('path')
        .attr('d', d3.line().x((p) => x(p.x)).y((p) => y(p.y))(s.points))
        .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.1)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');

      const hit = g.append('rect')
        .attr('x', pad.left).attr('y', pad.top)
        .attr('width', Math.max(1, cw - pad.right - pad.left))
        .attr('height', Math.max(1, ch - pad.bottom - pad.top))
        .attr('fill', 'transparent').style('cursor', 'crosshair');
      hit.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width - gx;
        const xv = x.invert(px);
        let near = s.points[0];
        for (const p of s.points) if (Math.abs(p.x - xv) < Math.abs(near.x - xv)) near = p;
        tip.show('<div style="color:' + color + '"><b>' + (s.name || 'All') + '</b></div>'
          + '<div>' + f(near.x) + ' &middot; <b>' + fmt(near.y) + '</b></div>',
          gx + x(near.x), gy + y(near.y));
      });
      hit.on('pointerleave', () => tip.hide());
    });
    return null;
  },
});
