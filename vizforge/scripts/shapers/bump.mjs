// scripts/shapers/bump.mjs
//
// BIND-01/02/04 (Phase 7 Plan 08) -- the bump technique's shaper. ONE shaper
// drives BOTH scaffolds/bump.html and scaffolds/bump-animated.html (they read
// the identical shape() output via regenerateFromDemoBinding's srcPath
// override -- see scripts/lib/regenerate-scaffold.mjs's own doc comment).
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// bump's dataBinding is a plain table shape: x (time), y (the RANK itself --
// already derived+documented in the demo fixture, honoring the
// "derived-rank-column-documented-not-a-new-dataset" precondition -- lower is
// better), series (required -- one line per distinct value).
//
// seriesLimits.maxCategories:10 is NOT a flat total-distinct-series ceiling
// (unlike bar.mjs's category check) -- a bump chart's real constraint is how
// many series are visible AT ANY SINGLE x (e.g. "top 10" rank slots per
// time point); a series that occupies different rank slots across MANY x
// values can perfectly honestly total more than 10 distinct series overall
// (the demo fixture itself has 13 countries total, only ever 10 per year).
// validate() therefore checks the MAX per-x distinct-series count against
// the ceiling, not the total-ever count.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Coerces a bound x value to a plottable number -- handles both a plain
// quantitative number and a genuine temporal value (mirrors
// scripts/shapers/line.mjs's own coerceX, duplicated here per the shaper
// contract's self-contained-file convention, see bar.mjs's own duplicated
// ORDINAL_SETS for precedent).
function coerceX(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function normalizedRows(rows, bindings) {
  const xCol = bindings.x;
  const yCol = bindings.y;
  const seriesCol = bindings.series;

  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x) || !isFiniteNumber(row[yCol])) continue;
    const rawSeries = row[seriesCol];
    if (rawSeries === undefined || rawSeries === null || String(rawSeries).trim() === '') continue;
    out.push({ x, y: Number(row[yCol]), series: String(rawSeries).trim() });
  }
  return out;
}

/**
 * shape(rows, bindings) -> {data:[{x,y,series}], stats:{rowCount,seriesCount,
 * xCount,firstX,lastX,biggestFallSeries,biggestFallDelta,biggestFallFirstY,
 * biggestFallLastY,newEntrants,newEntrantCount}}
 *
 * `data` is a flat table (one row per bound input row) -- the scaffold
 * groups it by `series` itself, exactly mirroring line.mjs's convention of
 * leaving consumer-side grouping to the scaffold.
 *
 * Stats generalize the pre-refactor scaffold's exact "biggest faller" +
 * "new entrants" computation: among series present at BOTH the first and
 * last bound x, the one whose y increased the most (a HIGHER rank number is
 * a WORSE position, so a positive delta = fell furthest); series present at
 * the last x but absent at the first are new entrants.
 */
export function shape(rows, bindings) {
  const data = normalizedRows(rows, bindings);
  data.sort((a, b) => a.x - b.x || a.series.localeCompare(b.series));

  const xs = Array.from(new Set(data.map((d) => d.x))).sort((a, b) => a - b);
  const firstX = xs.length > 0 ? xs[0] : null;
  const lastX = xs.length > 0 ? xs[xs.length - 1] : null;

  const seriesSet = new Set(data.map((d) => d.series));

  const atFirst = new Map();
  const atLast = new Map();
  data.forEach((d) => {
    if (d.x === firstX) atFirst.set(d.series, d.y);
    if (d.x === lastX) atLast.set(d.series, d.y);
  });

  let biggestFallSeries = null;
  let biggestFallDelta = -Infinity;
  let biggestFallFirstY = null;
  let biggestFallLastY = null;
  atFirst.forEach((y1, series) => {
    if (atLast.has(series)) {
      const y2 = atLast.get(series);
      const delta = y2 - y1;
      if (delta > biggestFallDelta) {
        biggestFallDelta = delta;
        biggestFallSeries = series;
        biggestFallFirstY = y1;
        biggestFallLastY = y2;
      }
    }
  });

  const newEntrants = Array.from(atLast.keys())
    .filter((series) => !atFirst.has(series))
    .sort();

  const stats = {
    rowCount: data.length,
    seriesCount: seriesSet.size,
    xCount: xs.length,
    firstX,
    lastX,
    biggestFallSeries,
    biggestFallDelta: Number.isFinite(biggestFallDelta) ? biggestFallDelta : null,
    biggestFallFirstY,
    biggestFallLastY,
    newEntrants,
    newEntrantCount: newEntrants.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound x column's profiled type is nominal -> named {channel:'x'} error
 *   (belt-and-suspenders, mirrors line.mjs).
 * - fewer than 2 distinct x values -> a rank-over-time chart needs at least 2
 *   time points to show any movement.
 * - fewer than 2 distinct series -> nothing to compare rank against.
 * - the MAX number of distinct series present at any single x exceeds
 *   `contract.seriesLimits.maxCategories` (when present) -> named
 *   {channel:'series'} error (BIND-04) -- see the top-of-file note on why
 *   this is a per-x ceiling, not a total-ever-appearing ceiling.
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const xCol = bindings.x;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === xCol) : undefined;
  if (field && field.type === 'nominal') {
    errors.push({
      channel: 'x',
      problem: `channel 'x': column '${xCol}' is nominal -- not orderable for a rank-over-time chart's x-axis`,
      remedy: `bind 'x' to a temporal or quantitative column`,
    });
  }

  const data = normalizedRows(rows, bindings);
  const xSet = new Set(data.map((d) => d.x));
  const seriesSet = new Set(data.map((d) => d.series));

  const perX = new Map();
  data.forEach((d) => {
    if (!perX.has(d.x)) perX.set(d.x, new Set());
    perX.get(d.x).add(d.series);
  });
  const maxPerX = perX.size > 0 ? Math.max(...Array.from(perX.values()).map((set) => set.size)) : 0;

  if (xSet.size < 2) {
    errors.push({
      channel: 'x',
      problem: `channel 'x': fewer than 2 distinct x values -- a rank-over-time chart needs at least 2 time points`,
      remedy: `bind 'x' to a column with at least 2 distinct values`,
    });
  }

  if (seriesSet.size < 2) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': fewer than 2 distinct values -- bump needs at least 2 series to compare rank`,
      remedy: `bind 'series' to a column with at least 2 distinct values`,
    });
  }

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (maxCategories !== undefined && maxPerX > maxCategories) {
    errors.push({
      channel: 'series',
      problem: `channel 'series': ${maxPerX} distinct series bound at a single x value exceeds the maximum of ${maxCategories} concurrently ranked series`,
      remedy: `bind 'series' (or pre-filter rows) so no single x has more than ${maxCategories} distinct series`,
    });
  }

  return errors;
}
