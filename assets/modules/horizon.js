// HORIZON (unc-horizon) — many series folded into colour bands so dozens fit
// in the vertical space one line chart would need.
//
// HONESTY: the folding is the whole trick and it has to be declared. Each band
// is a FIXED slice of the value range; when a series exceeds one slice the
// excess is folded back to the baseline and drawn in a deeper tone. So colour
// depth counts bands — it is not a second measure — and the band size is
// printed on the piece. A reader who does not know the fold height cannot read
// a horizon at all.
import { d3Piece } from './d3-piece.js';
import { tsShape, tsRoles, tsFmtX, tsHeadline, tsTicks } from './ts-shape.js';
import { formatNumber } from './vf-core.js';

export const slug = 'horizon';
export const roles = { ...tsRoles, series: { ...tsRoles.series, required: true } };
export const shape = tsShape;

const BANDS = 3;

export default d3Piece({
  slug, title: 'Horizon', roles, shape,
  build: 'rise', rest: 'timescan', dur: 4200, aspect: 0.5,
  hoverNote: 'Hover for the value at any moment.',
  headline: tsHeadline,
  dek(stats) {
    const step = stats.maxY / BANDS;
    return `${stats.seriesCount} series folded into ${BANDS} bands of `
      + `${formatNumber(step)} each, so they read in a fraction of the height.`;
  },
  note: () => `each band is a fixed slice of the range and the excess folds back in a deeper tone — colour depth counts BANDS and is not a second measure`,

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt } = ctx;
    if (!data.length) return null;
    const f = tsFmtX(stats);

    const longest = Math.max(...data.map((s) => String(s.name).length));
    const m = { top: 12, right: 22, bottom: 30, left: Math.min(190, Math.max(70, longest * 7.2)) };
    const rowH = Math.max(18, (height - m.top - m.bottom) / data.length);
    const x = d3.scaleLinear().domain([stats.firstX, stats.lastX]).range([m.left, width - m.right]);

    // ONE band height for every series — that is what makes the rows
    // comparable. A per-series fold would make each row a different chart.
    const step = (stats.maxY || 1) / BANDS;

    for (const t of tsTicks(d3, stats, Math.max(2, Math.round(width / 150)))) {
      sel.append('text').attr('x', x(t)).attr('y', height - m.bottom + 20)
        .attr('text-anchor', 'middle').attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
        .attr('font-family', 'var(--_ff)').attr('font-size', 11).text(f(t));
    }

    data.forEach((s, i) => {
      const top = m.top + i * rowH;
      const color = colors[i % colors.length];
      const g = sel.append('g');
      const y = d3.scaleLinear().domain([0, step]).range([top + rowH - 2, top + 2]);

      // One filled area per band, each clipped to the row, deeper as it folds.
      for (let b = 0; b < BANDS; b += 1) {
        const area = d3.area()
          .x((p) => x(p.x))
          .y0(top + rowH - 2)
          .y1((p) => y(Math.max(0, Math.min(step, p.y - b * step))))
          .curve(d3.curveMonotoneX);
        g.append('path')
          .attr('d', area(s.points))
          .attr('fill', color)
          .attr('fill-opacity', 0.26 + b * 0.27)
          .attr('data-vf-layer', '');
      }

      sel.append('text').attr('x', m.left - 10).attr('y', top + rowH / 2)
        .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.86)
        .attr('font-family', 'var(--_fl)').attr('font-size', 11.5).text(s.name);

      const hit = sel.append('rect')
        .attr('x', m.left).attr('y', top).attr('width', Math.max(1, width - m.right - m.left))
        .attr('height', rowH).attr('fill', 'transparent').style('cursor', 'crosshair');
      hit.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const xv = x.invert(px);
        let near = s.points[0];
        for (const p of s.points) if (Math.abs(p.x - xv) < Math.abs(near.x - xv)) near = p;
        tip.show('<div style="color:' + color + '"><b>' + s.name + '</b></div>'
          + '<div>' + f(near.x) + ' &middot; <b>' + fmt(near.y) + '</b></div>'
          + '<div style="opacity:.7">band ' + Math.min(BANDS, Math.floor(near.y / step) + 1) + ' of ' + BANDS + '</div>',
          x(near.x), top + rowH / 2);
      });
      hit.on('pointerleave', () => tip.hide());
    });
    return { scanBox: { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom } };
  },
});
