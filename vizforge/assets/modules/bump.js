// assets/modules/bump.js
//
// BUMP — the gallery's `conv-bump` ("Ten years to dethrone JavaScript"), ported
// to rank any category by any value across any ordered column.
//
// HONESTY, and it is the one thing a bump chart must say out loud: RANK HIDES
// MAGNITUDE. A series can climb this chart while its actual value falls, and
// two adjacent ranks can be a rounding error apart or an order of magnitude.
// So the source line states it, and the hover always reads the real value
// beside the rank rather than the rank alone.

import { d3Piece, num, coerceKey } from './d3-piece.js';
import { formatTemporal, formatNumber } from './vf-core.js';

export const slug = 'bump';

export const roles = {
  x: { types: ['temporal', 'quantitative'], required: true, label: 'Period' },
  series: { types: ['nominal', 'ordinal'], required: true, label: 'Series (one line each)' },
  y: { types: ['quantitative'], required: true, label: 'Value to rank by' },
};

export function shape(rows, bindings = {}) {
  const { x: xCol, series: sCol, y: yCol } = bindings;
  const byPeriod = new Map();
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
    const slot = byPeriod.get(k.value) || new Map();
    slot.set(name, (slot.get(name) || 0) + v);
    byPeriod.set(k.value, slot);
  }

  const periods = [...byPeriod.keys()].sort((a, b) => a - b);
  const seriesNames = [...names].sort();

  // Rank within each period, best value = rank 1. Ties keep registry order,
  // which is stable across renders rather than shuffling.
  const ranks = periods.map((p) => {
    const slot = byPeriod.get(p);
    const present = [...slot.entries()].sort((a, b) => b[1] - a[1]);
    const map = new Map();
    present.forEach(([name, value], i) => map.set(name, { rank: i + 1, value }));
    return { x: p, map };
  });

  const series = seriesNames.map((name) => ({
    name,
    points: ranks
      .map((r) => (r.map.has(name) ? { x: r.x, ...r.map.get(name) } : null))
      .filter(Boolean),
  })).filter((s) => s.points.length > 0);

  const movers = series.map((s) => {
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    return { name: s.name, from: a.rank, to: b.rank, climb: a.rank - b.rank, endValue: b.value };
  }).sort((x2, y2) => y2.climb - x2.climb);

  const leader = ranks.length
    ? [...ranks[ranks.length - 1].map.entries()].find(([, v]) => v.rank === 1)
    : null;

  return {
    data: series,
    stats: {
      periods,
      seriesNames: series.map((s) => s.name),
      seriesCount: series.length,
      maxRank: Math.max(1, ...ranks.map((r) => r.map.size)),
      temporal,
      firstX: periods[0] ?? null,
      lastX: periods[periods.length - 1] ?? null,
      climber: movers[0] || null,
      faller: movers[movers.length - 1] || null,
      leader: leader ? { name: leader[0], value: leader[1].value } : null,
    },
  };
}

const fmtX = (stats) => (v) => (stats.temporal
  ? formatTemporal(v, stats.lastX - stats.firstX) : formatNumber(v));

export default d3Piece({
  slug,
  title: 'Bump',
  roles,
  shape,
  build: 'trace',
  rest: 'walk',
  restSelect: '[data-vf-rankline]',
  dur: 4600,
  aspect: 0.52,
  hoverNote: 'Hover a line to follow it.',

  headline(stats) {
    const { climber, faller, leader } = stats;
    if (climber && climber.climb > 0 && faller && faller.climb < 0 && climber.name !== faller.name) {
      return `${climber.name} climbed ${climber.climb} ${climber.climb === 1 ? 'place' : 'places'} `
        + `as ${faller.name} fell ${Math.abs(faller.climb)}`;
    }
    if (leader) return `${leader.name} finishes first at ${formatNumber(leader.value)}`;
    return `${stats.seriesCount} series ranked across ${stats.periods.length} periods`;
  },

  dek(stats) {
    const f = fmtX(stats);
    return `${stats.seriesCount} series ranked at each of ${stats.periods.length} periods, `
      + `${f(stats.firstX)} to ${f(stats.lastX)}.`;
  },

  note: 'position is RANK, not value — a series can climb this chart while its own number falls, so the exact value is on every hover',

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt } = ctx;
    if (!data.length || !stats.periods.length) return null;

    const f = fmtX(stats);
    const labelRoom = Math.min(180, Math.max(84, width * 0.15));
    const m = { top: 18, right: labelRoom, bottom: 32, left: 44 };

    const x = d3.scalePoint().domain(stats.periods).range([m.left, width - m.right]).padding(0.06);
    const y = d3.scalePoint().domain(d3.range(1, stats.maxRank + 1)).range([m.top, height - m.bottom]).padding(0.5);

    // Rank gridlines and their ordinals — the ladder the lines climb.
    const grid = sel.append('g');
    for (let r = 1; r <= stats.maxRank; r += 1) {
      grid.append('line')
        .attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(r)).attr('y2', y(r))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.08);
      grid.append('text')
        .attr('x', m.left - 12).attr('y', y(r)).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .text(r);
    }
    for (const p of stats.periods) {
      grid.append('text')
        .attr('x', x(p)).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.62)
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .text(f(p));
    }

    const line = d3.line().x((d) => x(d.x)).y((d) => y(d.rank)).curve(d3.curveMonotoneX);
    const g = sel.append('g');

    data.forEach((s, i) => {
      const color = colors[i % colors.length];
      const path = g.append('path')
        .attr('d', line(s.points))
        .attr('fill', 'none').attr('stroke', color)
        .attr('stroke-width', 2.4).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
        .attr('data-vf-rankline', '')
        .style('cursor', 'pointer');

      for (const pt of s.points) {
        g.append('circle')
          .attr('cx', x(pt.x)).attr('cy', y(pt.rank)).attr('r', 4.2)
          .attr('fill', color).attr('stroke', 'var(--_paper)').attr('stroke-width', 1.6);
      }

      const last = s.points[s.points.length - 1];
      sel.append('text')
        .attr('x', width - m.right + 12).attr('y', y(last.rank))
        .attr('dominant-baseline', 'middle')
        .attr('fill', color).attr('font-family', 'var(--_fl)')
        .attr('font-size', 12.5).attr('font-weight', 600)
        .text(s.name);

      // Hover: follow one line, and always show the VALUE beside the rank.
      const enter = (event) => {
        ctx.motion.hold();
        g.selectAll('[data-vf-rankline]').style('opacity', 0.18);
        path.style('opacity', 1);
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        let near = s.points[0];
        for (const p of s.points) if (Math.abs(x(p.x) - px) < Math.abs(x(near.x) - px)) near = p;
        tip.show(
          '<div style="color:' + color + '"><b>' + s.name + '</b></div>'
          + '<div>' + f(near.x) + ' &middot; rank <b>' + near.rank + '</b> of ' + stats.maxRank + '</div>'
          + '<div style="opacity:.75">value ' + fmt(near.value) + '</div>',
          x(near.x), y(near.rank)
        );
      };
      path.on('pointerenter', enter).on('pointermove', enter);
      path.on('pointerleave', () => {
        g.selectAll('[data-vf-rankline]').style('opacity', '');
        tip.hide();
        ctx.motion.free();
      });
    });

    return null;
  },
});
