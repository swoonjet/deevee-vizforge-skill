// scripts/shapers/small-multiples.mjs
//
// BIND-01/02/04 (Phase 7 Plan 07) -- the small-multiples technique's shaper.
// Groups rows by the bound `series` column (the facet) into one x/y point
// array per facet -- a faceted extension of line.mjs's (07-04) x/y pattern,
// with bar.mjs's (07-04) distinct-category-cardinality ceiling reused for
// the facet count instead of a bar's category count.
//
// demoBinding binds against scripts/tests/fixtures/binding/co2_smallmultiples_facets.csv
// -- CO2's monthly rows pre-processed ONCE into a relative in-decade month
// index (0-119) per decade facet (the shipped scaffold's own reshape). This
// shaper NEVER special-cases CO2's real year/month columns; it only ever
// reads bindings.x/y/series.
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
 * Facet-ordering rule (mirrors bar.mjs's orderCategories, Open Q1): all
 * facet labels numeric-looking (e.g. co2's "1960s"/"1970s" decade labels
 * share the same leading-digits-numeric shape) -> ascending numeric order
 * on the leading digit run; otherwise -> first-appearance (insertion) order
 * (never an invented alphabetical order for a genuine unordered nominal set).
 */
function orderFacets(facets) {
  const leadingNum = (label) => {
    const m = String(label).match(/^-?\d+/);
    return m ? Number(m[0]) : null;
  };
  const nums = facets.map((f) => leadingNum(f.series));
  if (nums.every((n) => n !== null)) {
    return facets
      .map((f, i) => ({ f, n: nums[i] }))
      .sort((a, b) => a.n - b.n)
      .map((entry) => entry.f);
  }
  return facets;
}

/**
 * shape(rows, bindings) -> {data:[{series,points:[{x,y}],delta}],
 * stats:{facetCount,minDelta,minDeltaSeries,maxDelta,maxDeltaSeries,rowCount}}
 *
 * Facets come from the DISTINCT set of the bound `bindings.series` column
 * actually present in `rows` (never a literal hardcoded list). Each facet's
 * points are coerced to numbers and sorted ascending by x; `delta` is the
 * facet's last-minus-first y value (the per-facet honesty-relevant summary
 * the shipped piece's own "every decade added at least N" finding reads).
 */
export function shape(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;

  const groups = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const rawSeries = row[seriesCol];
    if (rawSeries === undefined || rawSeries === null || String(rawSeries).trim() === '') continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x) || !isFiniteNumber(row[yCol])) continue;
    const key = String(rawSeries).trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ x, y: Number(row[yCol]) });
  }

  const rawFacets = [...groups.entries()].map(([series, points]) => {
    const sorted = points.slice().sort((a, b) => a.x - b.x);
    const delta = sorted.length > 0 ? sorted[sorted.length - 1].y - sorted[0].y : null;
    return { series, points: sorted, delta };
  });

  const data = orderFacets(rawFacets);

  const withDelta = data.filter((f) => f.delta !== null);
  const minFacet = withDelta.length > 0 ? withDelta.reduce((a, b) => (b.delta < a.delta ? b : a), withDelta[0]) : null;
  const maxFacet = withDelta.length > 0 ? withDelta.reduce((a, b) => (b.delta > a.delta ? b : a), withDelta[0]) : null;

  const stats = {
    facetCount: data.length,
    minDelta: minFacet ? minFacet.delta : null,
    minDeltaSeries: minFacet ? minFacet.series : null,
    maxDelta: maxFacet ? maxFacet.delta : null,
    maxDeltaSeries: maxFacet ? maxFacet.series : null,
    rowCount: (rows || []).length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound facets: always rejected (small multiples
 *   needs at least 2 panels to compare) -- a hardcoded structural rule.
 * - more than `contract.seriesLimits.maxCategories` distinct facets (when
 *   that field is present on the passed contract) -> rejected naming the
 *   ceiling (BIND-04, mirrors bar.mjs's maxCategories pattern).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const seriesCol = bindings.series;
  const distinct = new Set(
    (rows || [])
      .map((r) => (r ? r[seriesCol] : undefined))
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v) => String(v).trim())
  );
  const distinctCount = distinct.size;

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (distinctCount < 2) {
    return [
      {
        channel: 'series',
        problem: `channel 'series': only ${distinctCount} distinct value(s) found in '${seriesCol}' -- small multiples needs at least 2 facets to compare`,
        remedy: `bind 'series' to a column with at least 2 distinct values`,
      },
    ];
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    return [
      {
        channel: 'series',
        problem: `channel 'series': ${distinctCount} distinct values in '${seriesCol}' exceeds the maximum of ${maxCategories} facets`,
        remedy: `bind 'series' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer facets together`,
      },
    ];
  }

  return [];
}
