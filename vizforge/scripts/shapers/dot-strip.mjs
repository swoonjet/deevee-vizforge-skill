// scripts/shapers/dot-strip.mjs
//
// BIND-01/02/04 (Phase 7 Plan 10) -- the dot-strip technique's shaper (tier-2
// scatter-distribution family, wave 3). Copies the reference pattern
// scripts/shapers/bar.mjs / box-violin.mjs established: shape(rows, bindings)
// is pure. validate(rows, bindings, {contract, profile}) runs AFTER the
// generic validateBinding() in scripts/bind-data.mjs already passed -- this
// file only adds category-cardinality (2..maxCategories, BIND-04) and a
// total-usable-point ceiling (maxPoints, BIND-04) the generic validator can't
// express.
//
// Category-ordering rule mirrors scripts/shapers/bar.mjs's own
// orderCategories() (ORDINAL_SETS duplicated here in miniature, same
// self-contained-pure-function rationale bar.mjs documents), but the
// non-ordinal/non-numeric fallback sorts alphabetically -- unlike bar.mjs's
// value-descending fallback, a strip plot's per-category "value" isn't a
// single reducible number until AFTER shape() computes each category's range,
// so there is no natural aggregate to sort columns by ahead of that.

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

function orderLabels(labels) {
  const lower = labels.map((l) => l.toLowerCase());
  const matchedSet = ORDINAL_SETS.find((set) => lower.every((v) => set.includes(v)));

  if (matchedSet) {
    return [...labels].sort((a, b) => matchedSet.indexOf(a.toLowerCase()) - matchedSet.indexOf(b.toLowerCase()));
  }

  if (labels.every((l) => isCoercibleNumber(l))) {
    return [...labels].sort((a, b) => Number(a) - Number(b));
  }

  return [...labels].sort((a, b) => a.localeCompare(b));
}

function usablePoints(rows, bindings) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    const rawCat = row[categoryCol];
    if (rawCat === undefined || rawCat === null || String(rawCat).trim() === '') continue;
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    points.push({ category: String(rawCat).trim(), value: num });
  }
  return points;
}

function groupByCategory(points) {
  const groups = new Map();
  for (const p of points) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p.value);
  }
  return groups;
}

/**
 * shape(rows, bindings) -> {data:[{category,value}],
 * stats:{categories,tightestLabel,tightestRange,otherRangeMin,otherRangeMax,
 * rowCount}}
 *
 * `data` is the flat per-record {category,value} list -- every record is
 * plotted individually, strictly positioned at its category's lane center
 * (no jitter, no force-settle -- variationAxes: jitter-vs-strict).
 *
 * stats generalizes the shipped dot-strip.html's "tightest spread" finding:
 * `tightestLabel` is the category with the SMALLEST min-max range
 * (recomputed from data, matching the Phase-3 Gentoo correction lesson --
 * never assume which category is tightest from a hardcoded label);
 * `otherRangeMin`/`otherRangeMax` bound every OTHER category's own range.
 */
export function shape(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const groups = groupByCategory(points);

  const aggregated = [...groups.entries()].map(([label, values]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { label, n: values.length, min, max, range: max - min };
  });

  const orderedLabels = orderLabels(aggregated.map((g) => g.label));
  const byLabel = new Map(aggregated.map((g) => [g.label, g]));
  const ordered = orderedLabels.map((label) => byLabel.get(label));

  const byRangeAsc = [...ordered].sort((a, b) => a.range - b.range);
  const tightest = byRangeAsc.length > 0 ? byRangeAsc[0] : null;
  const others = byRangeAsc.slice(1);
  const otherRanges = others.map((o) => o.range);

  const stats = {
    categories: orderedLabels,
    tightestLabel: tightest ? tightest.label : null,
    tightestRange: tightest ? tightest.range : null,
    otherRangeMin: otherRanges.length > 0 ? Math.min(...otherRanges) : null,
    otherRangeMax: otherRanges.length > 0 ? Math.max(...otherRanges) : null,
    rowCount: points.length,
  };

  return { data: points, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (a strip plot
 *   needs at least 2 lanes to compare) -- a hardcoded structural rule.
 * - more than `contract.seriesLimits.maxCategories` distinct categories (when
 *   present) -- rejected naming the ceiling (BIND-04).
 * - more than `contract.seriesLimits.maxPoints` usable points (when present)
 *   -- rejected naming the ceiling (BIND-04); this is the graceful-failure
 *   the proof test exercises for the family.
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const points = usablePoints(rows, bindings);
  const groups = groupByCategory(points);
  const distinctCount = groups.size;

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;
  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;

  if (distinctCount < 2) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${bindings.category}' -- a strip plot needs at least 2 categories to compare`,
      remedy: `bind 'category' to a column with at least 2 distinct values`,
    });
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': ${distinctCount} distinct values in '${bindings.category}' exceeds the maximum of ${maxCategories} lanes`,
      remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
    });
  }

  if (maxPoints !== undefined && points.length > maxPoints) {
    errors.push({
      channel: 'value',
      problem: `channel 'value': ${points.length} usable points exceeds the maximum of ${maxPoints}`,
      remedy: `bind to a dataset with ${maxPoints} or fewer rows, or pre-aggregate/sample down`,
    });
  }

  return errors;
}
