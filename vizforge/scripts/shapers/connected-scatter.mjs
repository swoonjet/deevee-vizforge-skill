// scripts/shapers/connected-scatter.mjs
//
// BIND-01/02/04 (Phase 7 Plan 10) -- the connected-scatter technique's shaper
// (tier-2 scatter-distribution family, wave 3). Copies the reference pattern
// scripts/shapers/bar.mjs / scatter.mjs established: shape(rows, bindings) is
// pure. validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed -- the generic
// validator ALREADY rejects a `time` binding whose profiled type isn't
// temporal|quantitative (this technique's dataBinding.roles[time].types), so
// this file only adds the two rules the generic validator can't express: a
// minimum-2-point floor (a path needs a start and an end) and the
// `seriesLimits.maxPoints` ceiling (BIND-04).
//
// The path's order comes EXCLUSIVELY from the bound `time` role, sorted
// ascending -- never row order (07-10-PLAN.md key_link). `x`/`y` are plotted
// as position; `time` only orders the path and is never itself plotted.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Coerces a bound `time` value to a plottable/orderable number -- handles
// both a plain quantitative number and a genuine temporal value (mirrors
// scripts/shapers/bump.mjs's own coerceX, duplicated here per the shaper
// contract's self-contained-file convention).
function coerceTime(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Coerces rows to usable {x,y,t} points -- rows whose bound x/y/time don't
 * all coerce to finite numbers are dropped entirely (never a NaN-poisoned
 * point in the output), then sorted ascending by `t` (the path's order comes
 * from the bound time role, never row order).
 */
function usablePoints(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const timeCol = bindings.time;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (!isFiniteNumber(row[xCol]) || !isFiniteNumber(row[yCol])) continue;
    const t = coerceTime(row[timeCol]);
    if (!Number.isFinite(t)) continue;
    points.push({ x: Number(row[xCol]), y: Number(row[yCol]), t });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * shape(rows, bindings) -> {data:[{x,y,t}], stats:{rowCount,firstT,lastT,
 * peakT,peakX,giveback,monotonicRise}}
 *
 * `data` is the path, already ordered ascending by the bound `time` role.
 *
 * stats generalizes the shipped connected-scatter.html's "peaked, then gave
 * back N% of the gain; the other axis kept rising every period" finding:
 * `peakT`/`peakX` are the path's own highest-`x` point (recomputed from data,
 * matching the Phase-3 Gentoo correction lesson -- never a hardcoded
 * country/year); `giveback` is the percent of that peak's `x` value lost by
 * the path's last point; `monotonicRise` is whether `y` strictly increased at
 * every consecutive step in time order.
 */
export function shape(rows, bindings) {
  const ordered = usablePoints(rows, bindings);
  const n = ordered.length;

  const first = n > 0 ? ordered[0] : null;
  const last = n > 0 ? ordered[n - 1] : null;
  const peak = n > 0 ? ordered.reduce((best, p) => (p.x > best.x ? p : best), ordered[0]) : null;
  const giveback = peak && last && peak.x !== 0 ? ((peak.x - last.x) / peak.x) * 100 : null;

  let monotonicRise = n > 1;
  for (let i = 1; i < n; i++) {
    if (ordered[i].y <= ordered[i - 1].y) {
      monotonicRise = false;
      break;
    }
  }

  const stats = {
    rowCount: n,
    firstT: first ? first.t : null,
    lastT: last ? last.t : null,
    peakT: peak ? peak.t : null,
    peakX: peak ? peak.x : null,
    giveback,
    monotonicRise: n > 1 ? monotonicRise : null,
  };

  return { data: ordered, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 usable x/y/time points: a connected-scatter path needs a
 *   start and an end (structural rule, always enforced).
 * - more than `contract.seriesLimits.maxPoints` usable points (when present
 *   on the passed contract) -- rejected naming the ceiling (BIND-04); this is
 *   the family's graceful-failure the proof test exercises.
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const points = usablePoints(rows, bindings);

  if (points.length < 2) {
    errors.push({
      channel: 'time',
      problem: `channel 'time': only ${points.length} usable point(s) after coercing '${bindings.x}'/'${bindings.y}'/'${bindings.time}' -- a connected-scatter path needs at least 2 points`,
      remedy: `bind 'x'/'y'/'time' to a dataset/column set with at least 2 usable rows`,
    });
  }

  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;
  if (maxPoints !== undefined && points.length > maxPoints) {
    errors.push({
      channel: 'time',
      problem: `channel 'time': ${points.length} usable points exceeds the maximum of ${maxPoints}`,
      remedy: `bind to a dataset with ${maxPoints} or fewer rows (e.g. one entity's own time series), or pre-aggregate/sample down`,
    });
  }

  return errors;
}
