// DOT STRIP (unc-strip) — one row per series, one dot per EVENT. No
// aggregation: every record is a mark, so overlapping dots are overlapping
// events rather than a single bigger one. Said in the source line because a
// dense cluster otherwise reads as one heavy point.
import { d3Piece } from './d3-piece.js';
import { tsShape, tsRoles, tsFmtX, tsTicks } from './ts-shape.js';
import { formatNumber } from './vf-core.js';

export const slug = 'strip';
export const roles = { ...tsRoles, series: { ...tsRoles.series, required: true }, y: { ...tsRoles.y, required: false } };
export const shape = tsShape;

export default d3Piece({
  slug, title: 'Dot strip', roles, shape,
  build: 'rain', rest: 'peak', dur: 4000, aspect: 0.5,
  hoverNote: 'Hover a dot for its date.',

  headline(stats) {
    const busiest = stats.seriesNames
      .map((n, i) => ({ n, c: 0, i }))
      .map((o) => o);
    return `${stats.pointCount} events across ${stats.seriesCount} `
      + (stats.seriesCount === 1 ? 'track' : 'tracks');
  },
  dek(stats) {
    const f = tsFmtX(stats);
    return `Every event plotted on its own row, ${f(stats.firstX)} to ${f(stats.lastX)}.`;
  },
  note: 'one dot per record and nothing is aggregated — overlapping dots are overlapping events, not a larger one',

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip } = ctx;
    if (!data.length) return null;
    const f = tsFmtX(stats);

    const longest = Math.max(...data.map((s) => String(s.name).length));
    const m = { top: 16, right: 26, bottom: 30, left: Math.min(200, Math.max(70, longest * 7.4)) };
    const x = d3.scaleLinear().domain([stats.firstX, stats.lastX]).range([m.left, width - m.right]);
    const band = d3.scalePoint().domain(stats.seriesNames).range([m.top + 10, height - m.bottom - 10]).padding(0.5);

    for (const t of tsTicks(d3, stats, Math.max(2, Math.round(width / 150)))) {
      sel.append('text').attr('x', x(t)).attr('y', height - m.bottom + 20)
        .attr('text-anchor', 'middle').attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
        .attr('font-family', 'var(--_ff)').attr('font-size', 11).text(f(t));
    }

    data.forEach((s, i) => {
      const color = colors[i % colors.length];
      const yy = band(s.name);
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right)
        .attr('y1', yy).attr('y2', yy)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.09);
      sel.append('text').attr('x', m.left - 10).attr('y', yy)
        .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.86)
        .attr('font-family', 'var(--_fl)').attr('font-size', 12).text(s.name);

      for (const p of s.points) {
        const dot = sel.append('circle')
          .attr('cx', x(p.x)).attr('cy', yy).attr('r', 4.4)
          .attr('fill', color).attr('fill-opacity', 0.62)
          .attr('data-vf-part', 'dot').style('cursor', 'pointer');
        dot.on('pointerenter', () => {
          dot.attr('fill-opacity', 1).attr('r', 6);
          tip.show('<div style="color:' + color + '"><b>' + s.name + '</b></div>'
            + '<div>' + f(p.x) + (p.y !== 1 ? ' &middot; <b>' + formatNumber(p.y) + '</b>' : '') + '</div>',
            x(p.x), yy);
        });
        dot.on('pointerleave', () => { dot.attr('fill-opacity', 0.62).attr('r', 4.4); tip.hide(); });
      }
    });
    return null;
  },
});
