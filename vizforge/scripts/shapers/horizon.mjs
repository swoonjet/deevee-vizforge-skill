// scripts/shapers/horizon.mjs
//
// BIND-01/02/04 (Phase 7 Plan 08) -- the horizon technique's shaper. A
// horizon chart FOLDS one or more continuous series into stacked rows; this
// project's demo folds ONE long GISTEMP series into decade-length rows --
// but the technique itself is a generic "one folded row per distinct bound
// `series` value" grouping, exactly like bar.mjs groups by `category`.
//
// The demo reuses 07-04's shared tall GISTEMP fixture (scripts/tests/fixtures/
// binding/gistemp_glb_monthly_tall.csv) READ-ONLY -- no new gistemp reshape,
// no decade column added to any fixture. Its `year` column profiles as
// `temporal` (147 distinct bare-year values, scripts/profile.mjs's own
// name-hint rule) and is bound directly to the `series` role. bucketKey()
// below is a fully GENERIC rule (not GISTEMP-specific): any bound series
// value that itself looks like a bare 4-digit year in a sane calendar range
// is folded to its decade -- exactly mirroring bar.mjs's own precedent of a
// data-shape-driven generic rule (its ORDINAL_SETS/numeric-ascending/
// value-descending category ordering), never a per-dataset special case.
// Any other bound series value groups literally (its own trimmed string),
// unaffected by the year-folding rule -- a user binding `series` to a real
// nominal column (e.g. company/ticker) gets one row per literal value.

const BARE_YEAR = /^\d{4}$/;

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Mirrors line.mjs/bump.mjs's own coerceX (duplicated per the shaper
// contract's self-contained-file convention).
function coerceX(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * bucketKey(raw) -> string
 * A bare 4-digit year in [1500,2100] folds to its decade ("1987" -> "1980");
 * anything else is grouped by its own trimmed literal value.
 */
function bucketKey(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (BARE_YEAR.test(v)) {
    const year = Number(v);
    if (year >= 1500 && year <= 2100) return String(Math.floor(year / 10) * 10);
  }
  return v;
}

function groupRows(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;

  const groups = new Map(); // bucketKey -> [{x,y}]
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x) || !isFiniteNumber(row[yCol])) continue;
    const rawSeries = row[seriesCol];
    if (rawSeries === undefined || rawSeries === null || String(rawSeries).trim() === '') continue;
    const key = bucketKey(rawSeries);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ x, y: Number(row[yCol]) });
  }
  return groups;
}

/**
 * shape(rows, bindings) -> {data:[{series,points:[{x,y}]}], stats:{bandCount,
 * warmestSeries,warmestMean,positiveCount,rowCount,maxAbsY}}
 *
 * One row (`data` entry) per bucketed series key, points sorted ascending by
 * x. `maxAbsY` is the real max |y| across ALL bands' points -- the shared,
 * data-driven scale every row's fold must use (the "shared-scale-across-all-
 * rows" precondition), never a per-band rescale.
 */
export function shape(rows, bindings) {
  const groups = groupRows(rows, bindings);

  const bandKeys = Array.from(groups.keys()).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const bands = bandKeys.map((key) => {
    const points = groups.get(key).slice().sort((a, b) => a.x - b.x);
    const mean = points.reduce((acc, p) => acc + p.y, 0) / points.length;
    return { series: key, points, mean };
  });

  const data = bands.map((b) => ({ series: b.series, points: b.points }));

  let warmest = null;
  bands.forEach((b) => {
    if (!warmest || b.mean > warmest.mean) warmest = b;
  });
  const positiveCount = bands.filter((b) => b.mean > 0).length;

  const allY = [];
  bands.forEach((b) => b.points.forEach((p) => allY.push(p.y)));
  const maxAbsY = allY.length > 0 ? Math.max(...allY.map((v) => Math.abs(v))) : 0;

  const stats = {
    bandCount: bands.length,
    warmestSeries: warmest ? warmest.series : null,
    warmestMean: warmest ? warmest.mean : null,
    positiveCount,
    rowCount: allY.length,
    maxAbsY,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound x column's profiled type is nominal -> named {channel:'x'}
 *   error (belt-and-suspenders, mirrors line.mjs).
 * - fewer than 2 distinct bucketed series -> a horizon chart needs at least
 *   2 folded rows to compare.
 * - more than `contract.seriesLimits.maxCategories` distinct bucketed series
 *   -> rejected naming the ceiling (BIND-04), counted AFTER bucketing (so a
 *   bare-year series column is judged on its decade count, not its raw
 *   distinct-year count).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const xCol = bindings.x;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === xCol) : undefined;
  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal -- not orderable for horizon's x-axis`,
      remedy: `bind 'x' to a temporal or quantitative column`,
    });
  }

  const groups = groupRows(rows, bindings);
  const distinctCount = groups.size;

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (distinctCount < 2) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': only ${distinctCount} distinct row(s) after grouping '${bindings.series}' -- a horizon chart needs at least 2 folded rows to compare`,
      remedy: `bind 'series' to a column (or a bare-year column, folded to decade) with at least 2 distinct groups`,
    });
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': ${distinctCount} distinct rows exceeds the maximum of ${maxCategories} folded rows`,
      remedy: `bind 'series' to a column with ${maxCategories} or fewer distinct groups`,
    });
  }

  return errors;
}
