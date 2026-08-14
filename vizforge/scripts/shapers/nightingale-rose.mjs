// scripts/shapers/nightingale-rose.mjs
//
// RAD-01 (Phase 23 Plan 01) -- the Nightingale rose / polar-area (coxcomb)
// technique's shaper. Distinct from scripts/shapers/radial-cyclical.mjs
// (a polar LINE on a genuinely cyclical axis): this technique renders 12
// EQUAL-ANGLE wedges (one per month) whose AREA -- not radius -- encodes
// magnitude, the classic "Nightingale honesty correction"
// (docs/honesty-rules.md's Area rule; scripts/qa/checks/area-encoding.check.mjs,
// 19-03/FND-03).
//
// HONESTY (23-CONTEXT.md, 23-01-PLAN.md) -- THE LOAD-BEARING PROPERTY:
// outerRadius = k*sqrt(value), NEVER outerRadius = k*value directly (which
// would double the perceived magnitude of differences). Angle carries
// NOTHING but cycle position (month) -- every wedge spans exactly
// 2*PI/12, regardless of that month's value; only radius/area varies.
//
// RE-BASING: the bound seasonal signal (e.g. co2_radial_cyclical.csv's
// `dev` column, average - deseasonalized) oscillates +/- around zero, so a
// raw area encoding is undefined for negative values. This shaper
// aggregates MEAN value per distinct cycle position (mirrors
// radial-cyclical.mjs's own meanByKey aggregation), then RE-BASES every
// mean by subtracting the minimum -- the seasonal-trough month lands
// exactly at value 0 (innerRadius=0, "wedges radiate from the
// seasonal-trough month at the center"). The subtracted amount (`offset`)
// is returned in `stats` so the scaffold's baseline disclosure can name it.
//
// Layout is pre-computed HERE (Node-side), exactly like
// scripts/shapers/circle-packing.mjs's d3.pack() precedent -- deterministic,
// no re-layout in the browser -- against a FIXED internal canvas
// (CANVAS_WIDTH/CANVAS_HEIGHT/MAX_RADIUS below); the scaffold duplicates
// these same three constants (comment-linked) purely to size its SVG
// viewBox, never to recompute radius.

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 700;
const MAX_RADIUS = 260;
const WEDGE_COUNT = 12;

function coerceNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  return Number(v);
}

function normalizedRows(rows, bindings) {
  const posCol = bindings.cyclePosition;
  const valCol = bindings.value;
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const cyclePosition = coerceNumber(row[posCol]);
    const value = coerceNumber(row[valCol]);
    if (!Number.isFinite(cyclePosition) || !Number.isFinite(value)) continue;
    out.push({ cyclePosition, value });
  }
  return out;
}

function meanByCyclePosition(points) {
  const groups = new Map();
  for (const p of points) {
    if (!groups.has(p.cyclePosition)) groups.set(p.cyclePosition, []);
    groups.get(p.cyclePosition).push(p.value);
  }
  const means = new Map();
  for (const [pos, values] of groups) {
    means.set(pos, values.reduce((a, b) => a + b, 0) / values.length);
  }
  return means;
}

/**
 * sqrtRadius honesty helper -- mirrors assets/snippets/scale-helpers.js's
 * browser-inlined sqrtRadius() formula exactly (radius scaled by the
 * square root of the value ratio, so AREA is proportional to value). This
 * shaper computes the layout Node-side (like circle-packing.mjs's
 * d3.pack()), never re-derives it at render time.
 */
function sqrtRadius(value, maxValue, maxRadius) {
  if (maxValue <= 0) return 0;
  const ratio = Math.max(0, value) / maxValue;
  return Math.sqrt(ratio) * maxRadius;
}

/**
 * shape(rows, bindings) -> {
 *   data: [{ cyclePosition, value, rawMean, innerRadius, outerRadius,
 *            startAngle, endAngle }],
 *   stats: { monthCount, offset, maxValue, peakCyclePosition, peakValue,
 *            troughCyclePosition, troughValue, rowCount }
 * }
 *
 * Exactly `positions.length` wedges (the shaper does not force 12 -- that
 * is validate()'s job, see below), each spanning an EQUAL angle
 * (2*PI / positions.length). `value` is the RE-BASED (non-negative) mean;
 * `rawMean` is the original (possibly negative) mean, kept for the
 * baseline disclosure's "re-based from its raw seasonal deviation" framing.
 * `outerRadius` scales as sqrt(value / maxValue) * MAX_RADIUS -- AREA, not
 * radius, is proportional to value. Deterministic: no Math.random, no
 * wall-clock read.
 */
export function shape(rows, bindings) {
  const points = normalizedRows(rows, bindings);
  const means = meanByCyclePosition(points);
  const positions = Array.from(means.keys()).sort((a, b) => a - b);

  const rawMeans = positions.map((p) => means.get(p));
  const offset = rawMeans.length > 0 ? Math.min(...rawMeans) : 0;

  const rebased = positions.map((cyclePosition) => ({
    cyclePosition,
    rawMean: means.get(cyclePosition),
    value: means.get(cyclePosition) - offset,
  }));

  const maxValue = rebased.length > 0 ? Math.max(...rebased.map((d) => d.value), 0) : 0;
  const wedgeAngle = positions.length > 0 ? (2 * Math.PI) / positions.length : 0;

  const data = rebased.map((d, i) => ({
    cyclePosition: d.cyclePosition,
    value: d.value,
    rawMean: d.rawMean,
    innerRadius: 0,
    outerRadius: sqrtRadius(d.value, maxValue, MAX_RADIUS),
    startAngle: i * wedgeAngle,
    endAngle: (i + 1) * wedgeAngle,
  }));

  const peak = rebased.length > 0 ? rebased.reduce((a, b) => (b.rawMean > a.rawMean ? b : a), rebased[0]) : null;
  const trough = rebased.length > 0 ? rebased.reduce((a, b) => (b.rawMean < a.rawMean ? b : a), rebased[0]) : null;

  const stats = {
    monthCount: positions.length,
    offset,
    maxValue,
    peakCyclePosition: peak ? peak.cyclePosition : null,
    peakValue: peak ? peak.rawMean : null,
    troughCyclePosition: trough ? trough.cyclePosition : null,
    troughValue: trough ? trough.rawMean : null,
    rowCount: points.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - exactly WEDGE_COUNT (12) distinct cycle positions required -- fewer or
 *   more cannot render as 12 equal 30-degree monthly wedges; a row set
 *   that fails this is rejected before shape() ever runs.
 */
export function validate(rows, bindings) {
  const points = normalizedRows(rows, bindings);
  const distinct = new Set(points.map((p) => p.cyclePosition));
  const errors = [];

  if (distinct.size !== WEDGE_COUNT) {
    errors.push({
      channel: 'cyclePosition',
      problem: `channel 'cyclePosition': ${distinct.size} distinct cycle position(s) found -- a Nightingale rose needs exactly ${WEDGE_COUNT} (one per month) to render 12 equal-angle wedges`,
      remedy: `bind 'cyclePosition' to a column with exactly ${WEDGE_COUNT} distinct monthly cycle-position values (1-12)`,
    });
  }

  return errors;
}

export const __canvas = { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_RADIUS, WEDGE_COUNT };
