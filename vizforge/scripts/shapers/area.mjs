// scripts/shapers/area.mjs
//
// BIND-01/02/04 (Phase 7 Plan 07) -- the area technique's shaper. Copies
// line.mjs's (07-04) x/y pattern verbatim: area is CONFIRMED single-column
// x/y (07-RESEARCH.md's tertiary multi-column guess was wrong -- a source
// read of scaffolds/src/area.src.html shows it reads exactly ONE quantitative
// solar column, filtered to a single 'World' entity row set already present
// in data/electricity_prod_world.csv). NOT a multi-column stack like
// streamgraph (07-12) -- this is the trivial table-shape case.
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed. This file's own
// validate() re-asserts the orderable-x rule (belt-and-suspenders, mirrors
// line.mjs) plus a minimum-2-usable-rows floor.
//
// stats captures the shipped finding -- the original scaffold's "grew N× over
// the prior decade" headline is generalized to a technique-agnostic
// "value N x-units prior" comparison (a decade is simply a 10-x-unit window;
// nothing here is solar/TWh-specific), computed from the nearest actual bound
// point to (lastX - 10).

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function coerceX(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * shape(rows, bindings) -> {data:[{x,y}], stats:{peakX,peakY,firstX,firstY,
 * lastX,lastY,tenPriorX,tenPriorY,growthMultiplierDecade,rowCount}}
 *
 * Maps rows to {x,y}, coercing to numbers and sorting ascending by x. Rows
 * that don't coerce to finite x/y are dropped (never NaN-poisoned output).
 */
export function shape(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;

  const data = [];
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x) || !isFiniteNumber(row[yCol])) continue;
    data.push({ x, y: Number(row[yCol]) });
  }

  data.sort((a, b) => a.x - b.x);

  const first = data[0] || null;
  const last = data[data.length - 1] || null;
  const peak = data.length > 0 ? data.reduce((a, b) => (b.y > a.y ? b : a), data[0]) : null;

  let tenPrior = null;
  let growthMultiplierDecade = null;
  if (last) {
    const targetX = last.x - 10;
    tenPrior = data.reduce(
      (best, d) => (Math.abs(d.x - targetX) < Math.abs(best.x - targetX) ? d : best),
      data[0]
    );
    growthMultiplierDecade = tenPrior && tenPrior.y > 0 ? last.y / tenPrior.y : null;
  }

  const stats = {
    peakX: peak ? peak.x : null,
    peakY: peak ? peak.y : null,
    firstX: first ? first.x : null,
    firstY: first ? first.y : null,
    lastX: last ? last.x : null,
    lastY: last ? last.y : null,
    tenPriorX: tenPrior ? tenPrior.x : null,
    tenPriorY: tenPrior ? tenPrior.y : null,
    growthMultiplierDecade,
    rowCount: data.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound x column's profiled type is nominal (not orderable) -> a named
 *   {channel:'x'} error (belt-and-suspenders: area.json's x role only
 *   accepts temporal|quantitative, so the generic validator already rejects
 *   this in production -- this direct check guards any caller that bypasses
 *   the generic validator too).
 * - fewer than 2 rows survive x/y coercion -> a named {channel:'x'} error (an
 *   area needs at least 2 points to draw a fill).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const xCol = bindings.x;
  const yCol = bindings.y;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === xCol) : undefined;
  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal -- not orderable for an area's x-axis`,
      remedy: `bind 'x' to a temporal or quantitative column`,
    });
  }

  const usableRowCount = (rows || []).filter(
    (r) => r && Number.isFinite(coerceX(r[xCol])) && isFiniteNumber(r[yCol])
  ).length;
  if (usableRowCount < 2) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': fewer than 2 usable rows after coercing '${xCol}'/'${yCol}' -- an area needs at least 2 points`,
      remedy: `bind to a dataset/column pair with at least 2 numeric rows`,
    });
  }

  return errors;
}
