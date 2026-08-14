// scripts/shapers/slope.mjs
//
// BIND-01/02/04 (Phase 7 Plan 07) -- the slope technique's shaper. A slope
// chart is a two-time-point special case of the trivial table-shape contract:
// bindings.x has EXACTLY two distinct values (the two time points compared),
// bindings.y is the compared quantitative value, bindings.series identifies
// which line each row belongs to (one slope line per distinct series value
// present at BOTH time points -- a series present at only one time point
// can't form a pair and is silently dropped, same as the shipped scaffold's
// own yearAMap/yearBMap intersection).
//
// demoBinding binds against scripts/tests/fixtures/binding/gapminder_slope_1952_2007.csv
// -- a pre-processed, header-commented, 20-country legible subset (the ten
// smallest + ten largest life-expectancy deltas across the full 142-country
// population, 1952 vs 2007) mirroring the shipped scaffold's own
// subset-selection craft. Gapminder's raw 12-year-wide file is NEVER bound
// directly: this shaper's "exactly 2 distinct x values" rule and the
// seriesLimits.maxPoints:24 legibility ceiling both require a pre-filtered,
// two-time-point, <=24-series dataset -- exactly what a real user binding
// their own two-time-point comparison would also naturally provide.
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed.

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
 * distinctSortedX(rows, xCol) -> number[] (ascending, deduped, NaN-filtered)
 */
function distinctSortedX(rows, xCol) {
  const set = new Set();
  for (const row of rows || []) {
    const x = coerceX(row ? row[xCol] : undefined);
    if (Number.isFinite(x)) set.add(x);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * pairSeries(rows, bindings) -> {series, x1, y1, x2, y2, delta}[]
 * Pure helper shared by shape() and validate() (belt-and-suspenders series-count
 * check): groups rows by bindings.series, keeps only series present at BOTH the
 * min and max distinct x value, sorted ascending by delta (mirrors the shipped
 * scaffold's own ascending-delta sort before its ten-smallest/ten-largest slice).
 */
function pairSeries(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;

  const xValues = distinctSortedX(rows, xCol);
  if (xValues.length < 2) return { x1: null, x2: null, pairs: [] };
  const x1 = xValues[0];
  const x2 = xValues[xValues.length - 1];

  const atX1 = new Map();
  const atX2 = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    const seriesKey = row[seriesCol];
    if (seriesKey === undefined || seriesKey === null || String(seriesKey).trim() === '') continue;
    if (!isFiniteNumber(row[yCol])) continue;
    if (x === x1) atX1.set(String(seriesKey).trim(), Number(row[yCol]));
    else if (x === x2) atX2.set(String(seriesKey).trim(), Number(row[yCol]));
  }

  const pairs = [];
  for (const [series, y1] of atX1) {
    if (!atX2.has(series)) continue;
    const y2 = atX2.get(series);
    pairs.push({ series, x1, y1, x2, y2, delta: y2 - y1 });
  }
  pairs.sort((a, b) => a.delta - b.delta);

  return { x1, x2, pairs };
}

/**
 * shape(rows, bindings) -> {data:[{series,x1,y1,x2,y2,delta}], stats:{x1,x2,
 * seriesCount,declineCount,maxGainSeries,maxGainDelta,maxLossSeries,
 * maxLossDelta,rowCount}}
 */
export function shape(rows, bindings) {
  const { x1, x2, pairs } = pairSeries(rows, bindings);

  const declineCount = pairs.filter((p) => p.delta < 0).length;
  const maxLoss = pairs.length > 0 ? pairs[0] : null;
  const maxGain = pairs.length > 0 ? pairs[pairs.length - 1] : null;

  const stats = {
    x1,
    x2,
    seriesCount: pairs.length,
    declineCount,
    maxGainSeries: maxGain ? maxGain.series : null,
    maxGainDelta: maxGain ? maxGain.delta : null,
    maxLossSeries: maxLoss ? maxLoss.series : null,
    maxLossDelta: maxLoss ? maxLoss.delta : null,
    rowCount: (rows || []).length,
  };

  return { data: pairs, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound x column has other than exactly 2 distinct values -> a named
 *   {channel:'x'} error (a slope chart compares exactly two time points).
 * - fewer than 1 series present at BOTH time points -> a named
 *   {channel:'series'} error (nothing to draw).
 * - more than `contract.seriesLimits.maxPoints` valid series pairs (when that
 *   field is present) -> rejected naming the ceiling (BIND-04, mirrors
 *   bar.mjs's maxCategories pattern) -- past ~24 lines the shipped piece's
 *   own honestyRisks flag legibility collapse.
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const xCol = bindings.x;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === xCol) : undefined;
  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal -- not orderable for a slope's two time points`,
      remedy: `bind 'x' to a temporal or quantitative column with exactly 2 distinct values`,
    });
  }

  const distinctX = distinctSortedX(rows, xCol);
  if (distinctX.length !== 2) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': found ${distinctX.length} distinct value(s) in '${xCol}' -- a slope chart requires EXACTLY 2 distinct x values (two time points)`,
      remedy: `bind 'x' to a column/dataset pre-filtered to exactly 2 distinct values`,
    });
    return errors; // pairSeries() below assumes >=2 distinct x values are meaningful
  }

  const { pairs } = pairSeries(rows, bindings);

  if (pairs.length < 1) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': no series has data at both of the 2 bound x values -- nothing to draw`,
      remedy: `bind 'series' to a column where at least one value has rows at both time points`,
    });
  }

  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;

  if (maxPoints !== undefined && pairs.length > maxPoints) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': ${pairs.length} distinct series exceeds the maximum of ${maxPoints} slope lines`,
      remedy: `bind 'series' to a column with ${maxPoints} or fewer distinct values, or pre-filter to a legible subset`,
    });
  }

  return errors;
}
