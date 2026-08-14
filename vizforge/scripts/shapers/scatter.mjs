// scripts/shapers/scatter.mjs
//
// BIND-01/02/04 (Phase 7 Plan 09) -- the scatter technique's shaper (tier-1
// scatter-distribution family, wave 3). Copies the reference pattern
// scripts/shapers/bar.mjs / line.mjs established: shape(rows, bindings) is
// pure -- identical rows+bindings in, identical output out. validate(rows,
// bindings, {contract, profile}) runs AFTER the generic validateBinding() in
// scripts/bind-data.mjs already passed (required-ness, bound-column
// existence, declared type, aggregation-choice membership) -- this file only
// adds the technique-specific rules the generic validator can't express:
// hue cardinality (contract.seriesLimits.maxCategories) and total usable
// point count (contract.seriesLimits.maxPoints), both BIND-04.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * Coerces rows to usable {x,y,hue?,size?} points -- rows whose bound x/y
 * don't coerce to finite numbers are dropped entirely (never a
 * NaN-poisoned point in the output). `hue`/`size` are omitted per-point
 * when not bound or not present/coercible on that row.
 */
function usablePoints(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const hueCol = bindings.hue;
  const sizeCol = bindings.size;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (!isFiniteNumber(row[xCol]) || !isFiniteNumber(row[yCol])) continue;
    const point = { x: Number(row[xCol]), y: Number(row[yCol]) };
    if (hueCol && row[hueCol] !== undefined && row[hueCol] !== null && String(row[hueCol]).trim() !== '') {
      point.hue = String(row[hueCol]).trim();
    }
    if (sizeCol && isFiniteNumber(row[sizeCol])) {
      point.size = Number(row[sizeCol]);
    }
    points.push(point);
  }
  return points;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

/**
 * shape(rows, bindings) -> {data:[{x,y,hue?,size?}], stats:{correlation,
 * gainLow,gainHigh,rowCount}}
 *
 * stats.gainLow/gainHigh recompute the same "diminishing returns" x-quartile
 * comparison the shipped scatter.html's headline cited (07-RESEARCH.md /
 * Phase-3 Gentoo lesson: independently recompute, never trust a hardcoded
 * number) -- generalized to whatever x/y is bound: split usable points into
 * x-ascending quartiles, compare the mean-y gain moving quartile 1->2
 * against the gain moving quartile 3->4. `null` when fewer than 4 usable
 * points (validate() rejects that case anyway, but shape() itself never
 * crashes on a short input).
 */
export function shape(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const n = points.length;

  const byX = [...points].sort((a, b) => a.x - b.x);
  const qSize = Math.floor(n / 4);
  const quartileGroups =
    n >= 4
      ? [0, 1, 2, 3].map((i) => {
          const start = i * qSize;
          const end = i === 3 ? n : start + qSize;
          return byX.slice(start, end);
        })
      : [];
  const qMeanY = quartileGroups.map((g) => g.reduce((a, d) => a + d.y, 0) / g.length);

  const stats = {
    correlation: n > 1 ? pearson(points.map((d) => d.x), points.map((d) => d.y)) : null,
    gainLow: qMeanY.length === 4 ? qMeanY[1] - qMeanY[0] : null,
    gainHigh: qMeanY.length === 4 ? qMeanY[3] - qMeanY[2] : null,
    rowCount: n,
  };

  return { data: points, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 4 usable x/y points: the quartile-gain finding needs at least
 *   4 points to split into quartiles (structural rule, always enforced).
 * - more than `contract.seriesLimits.maxPoints` usable points -> a named
 *   {channel:'x'} error (BIND-04). Absent entirely -> no ceiling enforced
 *   here, mirroring bar.mjs's own `contract.seriesLimits` convention (the
 *   framework's demo/regeneration path passes `contract:fragment.dataBinding`
 *   only; a caller that also wants the ceiling enforced merges in
 *   `fragment.seriesLimits` itself).
 * - more than `contract.seriesLimits.maxCategories` distinct bound `hue`
 *   values (only checked when `hue` is actually bound) -> a named
 *   {channel:'hue'} error (BIND-04).
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const points = usablePoints(rows, bindings);

  if (points.length < 4) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': only ${points.length} usable point(s) after coercing '${bindings.x}'/'${bindings.y}' -- a scatter needs at least 4 points`,
      remedy: `bind 'x'/'y' to a dataset/column pair with at least 4 numeric rows`,
    });
  }

  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;
  if (maxPoints !== undefined && points.length > maxPoints) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': ${points.length} usable points exceeds the maximum of ${maxPoints}`,
      remedy: `bind to a dataset with ${maxPoints} or fewer rows, or pre-aggregate/sample down`,
    });
  }

  if (bindings.hue) {
    const distinctHue = new Set(points.filter((d) => d.hue !== undefined).map((d) => d.hue));
    const maxCategories =
      contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
        ? contract.seriesLimits.maxCategories
        : undefined;
    if (maxCategories !== undefined && distinctHue.size > maxCategories) {
      errors.push({
        channel: 'hue',
        problem: `channel 'hue': ${distinctHue.size} distinct values in '${bindings.hue}' exceeds the maximum of ${maxCategories}`,
        remedy: `bind 'hue' to a column with ${maxCategories} or fewer distinct values`,
      });
    }
  }

  return errors;
}
