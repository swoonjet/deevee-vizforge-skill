// scripts/shapers/line.mjs
//
// BIND-01/02/04 (Phase 7 Plan 04) -- the line technique's shaper. Reference
// pattern for every trivial table-shape technique that maps rows to a tall
// x/y (optionally +series) series (waves 3 copy this).
//
// Pitfall 2 (07-RESEARCH.md): this shaper has NO wide->long / month-column
// reshape branch. GISTEMP's native wide format (Year + Jan..Dec columns) is
// pre-processed ONCE into scripts/tests/fixtures/binding/gistemp_glb_monthly_tall.csv
// (a tall {year,month,decDate,val} fixture) -- the demoBinding binds against
// THAT tall fixture, so this shaper only ever sees a plain x/y table, exactly
// like any other tall dataset a user brings.
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed (required-ness,
// bound-column existence, declared type membership against dataBinding.roles
// -- which already rejects a nominal x column, since line.json's x role only
// accepts temporal|quantitative). This file's own validate() re-asserts the
// orderable-x rule directly (belt-and-suspenders, mirrors bind-data.mjs's own
// style) plus a minimum-2-usable-rows floor the generic validator can't express.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * Coerces a bound x value to a plottable number. Handles BOTH x role types
 * this technique's dataBinding declares: a plain quantitative number (e.g. a
 * decimal year like GISTEMP's tall fixture's `decDate`) OR a genuine temporal
 * value (an ISO-ish date string) -- falls back to `Date.parse()` (epoch ms,
 * still ascending-sortable and linearly plottable) when the raw value isn't
 * numeric-looking. Returns NaN for anything that coerces to neither.
 */
function coerceX(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * shape(rows, bindings) -> {data:[{x,y,series?}], stats:{peakX,peakY,firstX,
 * firstY,lastX,lastY,rowCount}}
 *
 * Maps rows to {x,y,series?} (series omitted entirely when bindings.series
 * is not bound), coercing x/y to numbers and sorting ascending by x. Rows
 * that don't coerce to finite x/y are dropped (never NaN-poisoned output).
 */
export function shape(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;

  const data = [];
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x) || !isFiniteNumber(row[yCol])) continue;
    const point = { x, y: Number(row[yCol]) };
    if (seriesCol) point.series = row[seriesCol];
    data.push(point);
  }

  data.sort((a, b) => a.x - b.x);

  const first = data[0] || null;
  const last = data[data.length - 1] || null;
  const peak = data.length > 0 ? data.reduce((a, b) => (b.y > a.y ? b : a), data[0]) : null;

  const stats = {
    peakX: peak ? peak.x : null,
    peakY: peak ? peak.y : null,
    firstX: first ? first.x : null,
    firstY: first ? first.y : null,
    lastX: last ? last.x : null,
    lastY: last ? last.y : null,
    rowCount: data.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound x column's profiled type is nominal (not orderable) -> a named
 *   {channel:'x'} error (belt-and-suspenders: the generic validateBinding()
 *   already rejects this via dataBinding.roles[x].types, since this project's
 *   line.json only accepts temporal|quantitative for the x role).
 * - fewer than 2 rows survive x/y coercion -> a named {channel:'x'} error (a
 *   line needs at least 2 points to draw).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const xCol = bindings.x;
  const yCol = bindings.y;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === xCol) : undefined;
  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal -- not orderable for a line's x-axis`,
      remedy: `bind 'x' to a temporal or quantitative column`,
    });
  }

  const usableRowCount = (rows || []).filter(
    (r) => r && Number.isFinite(coerceX(r[xCol])) && isFiniteNumber(r[yCol])
  ).length;
  if (usableRowCount < 2) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': fewer than 2 usable rows after coercing '${xCol}'/'${yCol}' -- a line needs at least 2 points`,
      remedy: `bind to a dataset/column pair with at least 2 numeric rows`,
    });
  }

  return errors;
}
