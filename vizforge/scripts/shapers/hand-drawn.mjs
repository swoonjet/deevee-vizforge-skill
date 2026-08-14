// scripts/shapers/hand-drawn.mjs
//
// BIND-01/02/04 (Phase 7 Plan 11) -- the hand-drawn (TIER 3) technique's
// shaper. Contract (scripts/shapers/README.md): shape(rows, bindings) is
// pure. validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed.
//
// Tier-3 convention (skill/manifest/hand-drawn.json's own `mapping[]` block,
// KEPT unchanged by this plan): only the POSITION channel (x/y) gains a
// genuine dataBinding role here -- the "dot color + annotation label per
// cluster" mapping entry hardcodes `species` as its dataField, exactly like
// this shaper hardcodes the literal column name `species` below (never a
// rebindable role). This mirrors the mapping[] block's own fixed convention:
// hand-drawn's demoBinding is ALWAYS data/penguins.csv, so `species` is
// always present on the bound rows -- the shaper reads it directly as a
// convenience pass-through field, not a formal contract role.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

function usablePoints(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (!isFiniteNumber(row[xCol]) || !isFiniteNumber(row[yCol])) continue;
    const point = { x: Number(row[xCol]), y: Number(row[yCol]) };
    const rawGroup = row.species;
    if (rawGroup !== undefined && rawGroup !== null && String(rawGroup).trim() !== '') {
      point.group = String(rawGroup).trim();
    }
    points.push(point);
  }
  return points;
}

/**
 * shape(rows, bindings) -> {data:[{x,y,group?}], stats:{correlation,
 * rowCount,groupCount,topXGroup,topYGroup,sameGroup}}
 *
 * `topXGroup`/`topYGroup` recompute the shipped hand-drawn.html's "same
 * species leads both axes" finding, generalized: the group (mapping-fixed
 * `species`) with the highest mean x, and the group with the highest mean y
 * -- independently recomputed from the bound data (Phase-3 Gentoo-correction
 * lesson: never assume which group is "highest"), `null`/`false` when no
 * `species` values are present at all (e.g. a future non-penguins dataset
 * bound only via x/y).
 */
export function shape(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const n = points.length;

  const correlation = n > 1 ? pearson(points.map((p) => p.x), points.map((p) => p.y)) : null;

  const groupNames = Array.from(new Set(points.map((p) => p.group).filter((g) => g !== undefined))).sort();

  let topXGroup = null;
  let topYGroup = null;
  let sameGroup = false;

  if (groupNames.length > 0) {
    const byGroup = groupNames.map((g) => {
      const gp = points.filter((p) => p.group === g);
      return { group: g, meanX: mean(gp.map((p) => p.x)), meanY: mean(gp.map((p) => p.y)) };
    });
    topXGroup = byGroup.slice().sort((a, b) => b.meanX - a.meanX)[0].group;
    topYGroup = byGroup.slice().sort((a, b) => b.meanY - a.meanY)[0].group;
    sameGroup = topXGroup === topYGroup;
  }

  const stats = {
    correlation,
    rowCount: n,
    groupCount: groupNames.length,
    topXGroup,
    topYGroup,
    sameGroup,
  };

  return { data: points, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 4 usable x/y points -- mirrors scatter.mjs's own structural
 *   floor (a scatter-family point cloud needs at least 4 points).
 * - more than `contract.seriesLimits.maxPoints` usable points, when present
 *   on the passed contract -- BIND-04 (hand-drawn.json declares no
 *   seriesLimits today, so this is currently a no-op defensive check).
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const points = usablePoints(rows, bindings);

  if (points.length < 4) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': only ${points.length} usable point(s) after coercing '${bindings.x}'/'${bindings.y}' -- hand-drawn needs at least 4 points`,
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

  return errors;
}
