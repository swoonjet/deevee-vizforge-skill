// assets/modules/ts-shape.js
//
// ONE SHAPER FOR THE WHOLE TIME-SERIES FAMILY.
//
// Line, bump, small multiples, horizon, dot strip and streamgraph all bind the
// same three columns — a date, a series, a value — and all want the same thing
// out of them. Writing that six times is what made the first two ports slow.
// Everything below is shared; a piece is then only its draw().

import { num, coerceKey } from './d3-piece.js';
import { formatTemporal, formatNumber } from './vf-core.js';

/** rows + {x, series, y} -> {data:[{name,points:[{x,y}]}], stats} */
export function tsShape(rows, bindings = {}) {
  const { x: xCol, series: sCol, y: yCol } = bindings;
  const bag = new Map();
  let temporal = false;
  let points = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const k = coerceKey(row[xCol]);
    if (!Number.isFinite(k.value)) continue;
    if (k.type === 'temporal') temporal = true;
    const y = yCol === undefined ? 1 : num(row[yCol]);
    if (!Number.isFinite(y)) continue;
    const name = sCol === undefined ? '' : String(row[sCol] ?? '');
    if (!bag.has(name)) bag.set(name, new Map());
    const line = bag.get(name);
    // Repeated (series, x) SUM — transactional rows are the common case and
    // dropping duplicates would silently shrink a series.
    line.set(k.value, (line.get(k.value) || 0) + y);
    points += 1;
  }

  const data = [...bag.entries()]
    .map(([name, m]) => ({
      name,
      points: [...m.entries()].map(([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x),
    }))
    .filter((s) => s.points.length)
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  const all = data.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);

  const moves = data.map((s) => {
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    const change = a.y !== 0 ? (b.y - a.y) / Math.abs(a.y) : null;
    return { name: s.name, first: a.y, last: b.y, change, peak: Math.max(...s.points.map((p) => p.y)) };
  }).filter((m) => m.change !== null).sort((a, b) => b.change - a.change);

  return {
    data,
    stats: {
      seriesNames: data.map((s) => s.name),
      seriesCount: data.length,
      pointCount: points,
      periods: [...new Set(xs)].sort((a, b) => a - b),
      temporal,
      firstX: xs.length ? Math.min(...xs) : null,
      lastX: xs.length ? Math.max(...xs) : null,
      minY: ys.length ? Math.min(...ys) : 0,
      maxY: ys.length ? Math.max(...ys) : 1,
      gainer: moves[0] || null,
      loser: moves.length > 1 ? moves[moves.length - 1] : null,
    },
  };
}

export const tsRoles = {
  x: { types: ['temporal', 'quantitative'], required: true, label: 'Time' },
  series: { types: ['nominal', 'ordinal'], required: false, label: 'Series' },
  y: { types: ['quantitative'], required: true, label: 'Value' },
};

/** Formats an x value the way its own type deserves. */
export const tsFmtX = (stats) => (v) => (stats.temporal
  ? formatTemporal(v, stats.lastX - stats.firstX)
  : formatNumber(v));

/** The finding, stated. Shared because every one of these answers the same question. */
export function tsHeadline(stats) {
  const { gainer, loser } = stats;
  const pct = (c) => Math.round(Math.abs(c) * 100) + '%';
  if (gainer && loser && gainer.name !== loser.name && gainer.change > 0 && loser.change < 0) {
    return `${gainer.name} rose ${pct(gainer.change)} while ${loser.name} fell ${pct(loser.change)}`;
  }
  if (gainer) {
    return `${gainer.name || 'The series'} ${gainer.change >= 0 ? 'rose' : 'fell'} `
      + `${pct(gainer.change)} from ${formatNumber(gainer.first)} to ${formatNumber(gainer.last)}`;
  }
  return `${stats.seriesCount} series over ${stats.periods.length} periods`;
}

export function tsDek(stats, what) {
  const f = tsFmtX(stats);
  return `${stats.seriesCount} ${stats.seriesCount === 1 ? 'series' : 'series'}, `
    + `${stats.pointCount} points, ${f(stats.firstX)} to ${f(stats.lastX)}${what ? ` — ${what}` : ''}.`;
}

/** Axis marks that land on real calendar boundaries when x is a date. */
export function tsTicks(d3, stats, want) {
  if (!stats.temporal) return d3.scaleLinear().domain([stats.firstX, stats.lastX]).ticks(want);
  const span = stats.lastX - stats.firstX;
  const step = Math.max(1, Math.ceil(stats.periods.length / want));
  return stats.periods.filter((_, i) => i % step === 0);
}
