// scripts/shapers/bar.mjs
//
// BIND-01/02/04 (Phase 7 Plan 04) -- the bar technique's shaper. Reference
// pattern for every trivial table-shape technique that groups rows by a
// DISTINCT category column and aggregates a value column (waves 3 copy this).
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure --
// identical rows+bindings in, identical output out. validate(rows, bindings,
// {contract, profile}) runs AFTER the generic validateBinding() in
// scripts/bind-data.mjs already passed (required-ness, bound-column
// existence, declared type, aggregation-choice membership) -- this file only
// adds the technique-specific rule the generic validator can't express:
// category cardinality (min 2 to compare, and an optional
// contract.seriesLimits.maxCategories ceiling -- BIND-04).

// Known-set ordinal matching -- mirrors scripts/profile.mjs's own
// ORDINAL_SETS (private to that file; duplicated here in miniature so this
// shaper stays a fully self-contained, dependency-free pure function per the
// shaper contract, rather than importing the profiler's internals).
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

/**
 * Category-ordering rule (07-RESEARCH.md Open Q1):
 *   - a recognized ORDINAL_SET (case-insensitive) -> that set's natural order
 *   - all-numeric-looking labels (a low-cardinality quantitative-coded
 *     category, e.g. Titanic's Pclass 1/2/3) -> ascending numeric order
 *   - otherwise (genuine unordered nominal) -> value-descending
 */
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
 * shape(rows, bindings) -> {data:[{label,value,n}], stats:{ratio,topLabel,
 * bottomLabel,worstLabel,worstValue,rowCount}}
 *
 * Categories come from the DISTINCT set of the bound `bindings.category`
 * column actually present in `rows` -- never a literal hardcoded array.
 * `bindings.aggregation.value` selects sum|mean|count (default 'mean',
 * mirroring this technique's dataBinding.roles[value].defaultAggregation).
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

  const byValueDesc = [...aggregated].sort((a, b) => b.value - a.value);
  const top = byValueDesc[0];
  const bottom = byValueDesc[byValueDesc.length - 1];

  const stats = {
    ratio: top && bottom && bottom.value !== 0 ? top.value / bottom.value : null,
    topLabel: top ? top.label : null,
    bottomLabel: bottom ? bottom.label : null,
    worstLabel: bottom ? bottom.label : null,
    worstValue: bottom ? bottom.value : null,
    rowCount: rows.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (a bar chart
 *   needs at least 2 categories to compare) -- a hardcoded structural rule,
 *   independent of any manifest field.
 * - more than `contract.seriesLimits.maxCategories` distinct categories (when
 *   that field is present on the passed contract): rejected naming the
 *   ceiling (BIND-04). Absent entirely -> no ceiling enforced here (the
 *   framework's demo/regeneration path passes `contract:fragment.dataBinding`
 *   only; a caller that also wants the ceiling enforced merges in
 *   `fragment.seriesLimits` itself -- see scripts/tests/integration/shapers-bar-line.test.mjs).
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

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (distinctCount < 2) {
    return [
      {
        channel: 'category',
        problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${categoryCol}' -- a bar chart needs at least 2 categories to compare`,
        remedy: `bind 'category' to a column with at least 2 distinct values`,
      },
    ];
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    return [
      {
        channel: 'category',
        problem: `channel 'category': ${distinctCount} distinct values in '${categoryCol}' exceeds the maximum of ${maxCategories} bars`,
        remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
      },
    ];
  }

  return [];
}
