// assets/modules/xy-shape.js
//
// ONE SHAPER FOR THE TWO-NUMERIC FAMILY — hexbin, contour, connected scatter
// and the linked brush. All four bind two measurements off the same row, and
// the difference between them is only what they do about OVERPLOTTING: bin it,
// smooth it, thread it in time, or let the reader select through it.
//
// TWO RULES LIVE HERE:
//
//   1. A ROW IS ONLY A POINT IF BOTH NUMBERS ARE READABLE. A row missing either
//      is dropped and counted — not coerced to zero, which would pile a false
//      cluster onto the axes' origin. (`Number('')` is 0 and finite, which is
//      exactly how that bug ships.)
//   2. THE EXTENT IS THE DATA'S, NOT A ROUND NUMBER. These forms are about
//      WHERE the points are, so padding the domain to a nice tick would move
//      every mark relative to the frame. The draws round the AXIS LABELS
//      instead, and the domain stays honest.
//
// It also carries the hex lattice, because a hexbin needs one and a module may
// not import assets/snippets/. Same geometry as that file (pointy-top, radius
// r, dx = 2·sin(60°)·r, dy = 1.5·r, alternate rows offset by dx/2) and the same
// two-candidate nearest-centre test, which is exact and deterministic.

import { num } from './d3-piece.js';
import { formatNumber } from './vf-core.js';

/** rows + {x, y, series?, t?} -> {data:{points}, stats} */
export function xyShape(rows, bindings = {}) {
  const { x: xCol, y: yCol, series: sCol, t: tCol } = bindings;
  const points = [];
  let dropped = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const x = num(row[xCol]);
    const y = num(row[yCol]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { dropped += 1; continue; }
    const p = { x, y };
    if (sCol !== undefined) p.series = String(row[sCol] ?? '');
    if (tCol !== undefined) {
      const raw = row[tCol];
      const n = Number(raw);
      p.t = Number.isFinite(n) ? n : Date.parse(String(raw));
      if (!Number.isFinite(p.t)) p.t = null;
    }
    points.push(p);
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const seriesNames = sCol === undefined ? [] : [...new Set(points.map((p) => p.series))].sort();
  const mean = (v) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0);

  return {
    data: { points },
    stats: {
      pointCount: points.length,
      dropped,
      seriesNames,
      seriesCount: Math.max(1, seriesNames.length),
      xName: String(xCol ?? 'x'),
      yName: String(yCol ?? 'y'),
      xMin: xs.length ? Math.min(...xs) : 0,
      xMax: xs.length ? Math.max(...xs) : 1,
      yMin: ys.length ? Math.min(...ys) : 0,
      yMax: ys.length ? Math.max(...ys) : 1,
      xMean: mean(xs),
      yMean: mean(ys),
      // Pearson's r, for the one sentence a two-numeric piece can honestly
      // lead with — and always with the caveat that it is not causation.
      correlation: pearson(xs, ys),
    },
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (!(sxx > 0 && syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export const xyRoles = {
  x: { types: ['quantitative'], required: true, label: 'Horizontal measure' },
  y: { types: ['quantitative'], required: true, label: 'Vertical measure' },
};

export function xyNote(stats, formNote) {
  const parts = [formNote];
  if (stats.dropped) {
    parts.push(`${stats.dropped} ${stats.dropped === 1 ? 'row was' : 'rows were'} missing one of the two `
      + 'numbers and are not plotted — a blank is not a zero');
  }
  return parts.filter(Boolean).join(' · ');
}

/** The relationship, stated with its own limits. */
export function xyHeadline(stats) {
  const r = stats.correlation;
  if (r === null) {
    return `${stats.pointCount} points of ${stats.xName} against ${stats.yName}`;
  }
  const strength = Math.abs(r) > 0.7 ? 'move closely together'
    : Math.abs(r) > 0.4 ? 'move together loosely'
      : 'barely move together at all';
  return `${stats.xName} and ${stats.yName} ${strength} (r = ${r.toFixed(2)})`;
}

export function xyDek(stats, what) {
  const parts = [`${formatNumber(stats.pointCount)} points`];
  if (typeof what === 'string' && what) parts.push(what);
  return `${parts.join(' — ')}.`;
}

// --- the hex lattice --------------------------------------------------------

/** An SVG path for one pointy-top hexagon of radius r, centred on the origin. */
export function hexagonPath(radius) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(radius * Math.cos(a)).toFixed(3)},${(radius * Math.sin(a)).toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * Bins screen-space points onto a hex lattice. Returns [{x, y, count, points}]
 * where x/y are the CENTRE of the hex, never a member point.
 */
export function hexBins(pts, radius) {
  const dx = radius * 2 * Math.sin(Math.PI / 3);
  const dy = radius * 1.5;
  const byKey = new Map();

  const centre = (px, py) => {
    const at = (row) => {
      const offset = row & 1 ? dx / 2 : 0;
      const col = Math.round((px - offset) / dx);
      return { row, col, cx: col * dx + offset, cy: row * dy };
    };
    const row1 = Math.round(py / dy);
    const c1 = at(row1);
    const c2 = at(row1 + (py < c1.cy ? -1 : 1));
    const d1 = (px - c1.cx) ** 2 + (py - c1.cy) ** 2;
    const d2 = (px - c2.cx) ** 2 + (py - c2.cy) ** 2;
    return d2 < d1 ? c2 : c1;
  };

  for (const p of pts) {
    const c = centre(p.px, p.py);
    const key = `${c.row},${c.col}`;
    let bin = byKey.get(key);
    if (!bin) { bin = { x: c.cx, y: c.cy, count: 0, points: [] }; byKey.set(key, bin); }
    bin.count += 1;
    bin.points.push(p);
  }
  return [...byKey.values()];
}
