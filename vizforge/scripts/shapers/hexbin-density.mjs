// scripts/shapers/hexbin-density.mjs
//
// DEN-01 (Phase 23 Plan 02) -- the hexbin-density technique's shaper (tier-2
// scatter-distribution family fragment; meta.family="density" lives in the
// scaffold sidecar, a separate field -- see skill/manifest/hexbin-density.json's
// header comment). Mirrors scripts/shapers/scatter.mjs's usablePoints()
// convention: extract the two bound continuous columns, coerce to numbers,
// drop any row that isn't coercible on EITHER column, and return the clean
// point set plus true extents.
//
// NO BINNING HAPPENS HERE. Hex-binning is a screen-space operation (points
// must first be projected through x/y scales before the hex lattice can be
// laid over them), so it lives entirely in scaffolds/src/hexbin-density.src.html
// via the inlined assets/snippets/hexbin.js hexbin() factory. This shaper's
// only job is the data layer: clean {x,y} points + their true min/max extent
// (never a padded/rounded extent -- the scaffold pads for display itself).

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * Coerces rows to usable {x,y} points -- rows whose bound x/y don't BOTH
 * coerce to finite numbers are dropped entirely (never a NaN-poisoned point
 * in the output).
 */
function usablePoints(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (!isFiniteNumber(row[xCol]) || !isFiniteNumber(row[yCol])) continue;
    points.push({ x: Number(row[xCol]), y: Number(row[yCol]) });
  }
  return points;
}

/**
 * shape(rows, bindings) -> { points:[{x,y}], xExtent:[min,max],
 * yExtent:[min,max], n }
 *
 * `n` is the count of valid (usable) points -- exactly the overplotting the
 * hexbin de-clutters. `xExtent`/`yExtent` are the TRUE data min/max of the
 * clean point set (never padded/rounded here -- the scaffold's scales apply
 * their own display padding on top of these true bounds).
 */
export function shape(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const xValues = points.map((d) => d.x);
  const yValues = points.map((d) => d.y);

  const xExtent = points.length > 0 ? [Math.min(...xValues), Math.max(...xValues)] : [0, 0];
  const yExtent = points.length > 0 ? [Math.min(...yValues), Math.max(...yValues)] : [0, 0];

  return {
    points,
    xExtent,
    yExtent,
    n: points.length,
  };
}

/**
 * validate(rows, bindings, {contract}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 usable x/y points after coercion (e.g. a column that is
 *   entirely non-numeric): rejected -- a hex density field needs a real
 *   point cloud, not a single dot.
 */
export function validate(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const problems = [];

  if (points.length < 2) {
    problems.push({
      channel: 'x',
      problem: `channel 'x': only ${points.length} usable point(s) after coercing '${bindings.x}'/'${bindings.y}' -- a hexbin density field needs a real point cloud`,
      remedy: `bind 'x'/'y' to two continuous columns with at least 2 coercible numeric rows`,
    });
  }

  return problems;
}
