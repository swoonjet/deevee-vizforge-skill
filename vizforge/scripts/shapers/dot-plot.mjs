// scripts/shapers/dot-plot.mjs
//
// BIND-01/02/04 (Phase 7 Plan 06) -- dot-plot's shaper. Reuses bar.mjs's
// (07-04) distinct-set category/value aggregation + Open-Q1 ordering rule
// verbatim (each shaper stays a fully self-contained, dependency-free pure
// function per scripts/shapers/README.md -- small duplication across
// shapers is intentional, not an oversight).
//
// A Cleveland dot plot's "points" ARE its distinct bound categories -- one
// dot per category, plotted by POSITION (never bar length, docs/qa-schemas.md
// tier-1 default reroute note). Its own ceiling is `seriesLimits.maxPoints`
// (not `maxCategories`) -- same validate() shape as bar.mjs, different field
// name, since a dot plot's honesty risk is graph-illegibility from too many
// rows, not a miscounted comparison.
//
// The demo binds against a pre-selected fixture
// (scripts/tests/fixtures/binding/gapminder_2007_lifeexp_extremes.csv --
// Gapminder's 2007 top-10 + bottom-10 life-expectancy countries, the exact
// subset the shipped piece plotted) rather than the full multi-year,
// 142-country-per-year gapminder_five_year.csv -- selecting "the extreme N
// of a single year out of a multi-year table" is a bespoke reshape no
// general category/value binding can express, mirroring line.mjs's
// tall-GISTEMP-fixture precedent (07-04 Pitfall 2).

const ORDINAL_SETS = [
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ],
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['q1', 'q2', 'q3', 'q4'],
];

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Category-ordering rule (07-RESEARCH.md Open Q1), identical to bar.mjs:
//   - a recognized ORDINAL_SET (case-insensitive) -> that set's natural order
//   - all-numeric-looking labels -> ascending numeric order
//   - otherwise (genuine unordered nominal, e.g. country names) -> value-descending
function orderCategories(aggregated) {
  const labels = aggregated.map((d) => d.label);
  const lower = labels.map((l) => l.toLowerCase());
  const matchedSet = ORDINAL_SETS.find((set) => lower.every((v) => set.includes(v)));

  if (matchedSet) {
    return [...aggregated].sort(
      (a, b) => matchedSet.indexOf(a.label.toLowerCase()) - matchedSet.indexOf(b.label.toLowerCase())
    );
  }

  if (labels.every((l) => isCoercibleNumber(l))) {
    return [...aggregated].sort((a, b) => Number(a.label) - Number(b.label));
  }

  return [...aggregated].sort((a, b) => b.value - a.value);
}

/**
 * shape(rows, bindings) -> {data:[{label,value,n}], stats:{span,topLabel,
 * topValue,bottomLabel,bottomValue,rowCount}}
 *
 * Points come from the DISTINCT set of the bound `bindings.category` column
 * actually present in `rows` -- never a literal hardcoded array.
 * `bindings.aggregation.value` selects sum|mean|count (default 'mean').
 * `stats.span` is the gap between the highest and lowest plotted value --
 * the number a Cleveland dot plot's headline names.
 */
export function shape(rows, bindings) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;
  const aggName = (bindings.aggregation && bindings.aggregation.value) || 'mean';

  const groups = new Map();
  for (const row of rows) {
    if (!row) continue;
    const rawCat = row[categoryCol];
    if (rawCat === undefined || rawCat === null || String(rawCat).trim() === '') continue;
    const key = String(rawCat).trim();
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(num);
  }

  const aggregated = [...groups.entries()].map(([label, values]) => {
    const n = values.length;
    let value;
    if (aggName === 'sum') value = values.reduce((a, b) => a + b, 0);
    else if (aggName === 'count') value = n;
    else value = values.reduce((a, b) => a + b, 0) / n; // 'mean' (default)
    return { label, value, n };
  });

  const data = orderCategories(aggregated);

  const top = data[0] || null;
  const bottom = data.length > 0 ? data[data.length - 1] : null;

  const stats = {
    span: top && bottom ? top.value - bottom.value : null,
    topLabel: top ? top.label : null,
    topValue: top ? top.value : null,
    bottomLabel: bottom ? bottom.label : null,
    bottomValue: bottom ? bottom.value : null,
    rowCount: rows.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (a dot plot
 *   needs at least 2 points to compare).
 * - more than `contract.seriesLimits.maxPoints` distinct categories (when
 *   that field is present on the passed contract): rejected naming the
 *   ceiling (BIND-04). Absent entirely -> no ceiling enforced here (mirrors
 *   bar.mjs's own seriesLimits contract-threading note).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const categoryCol = bindings.category;
  const distinct = new Set(
    (rows || [])
      .map((r) => (r ? r[categoryCol] : undefined))
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v) => String(v).trim())
  );
  const distinctCount = distinct.size;

  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;

  if (distinctCount < 2) {
    return [
      {
        channel: 'category',
        problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${categoryCol}' -- a dot plot needs at least 2 points to compare`,
        remedy: `bind 'category' to a column with at least 2 distinct values`,
      },
    ];
  }

  if (maxPoints !== undefined && distinctCount > maxPoints) {
    return [
      {
        channel: 'category',
        problem: `channel 'category': ${distinctCount} distinct values in '${categoryCol}' exceeds the maximum of ${maxPoints} points`,
        remedy: `bind 'category' to a column with ${maxPoints} or fewer distinct values, or pre-select the subset of interest`,
      },
    ];
  }

  return [];
}
