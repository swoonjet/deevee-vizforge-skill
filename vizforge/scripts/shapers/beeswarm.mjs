// scripts/shapers/beeswarm.mjs
//
// BIND-01/02/04 (Phase 7 Plan 10) -- the beeswarm technique's shaper (tier-2
// scatter-distribution family, wave 3). ONE shaper drives BOTH
// scaffolds/beeswarm.html and scaffolds/beeswarm-animated.html (they read the
// identical shape() output via regenerateFromDemoBinding's srcPath override --
// see scripts/lib/regenerate-scaffold.mjs's own doc comment, mirrors
// scripts/shapers/bump.mjs's own shared-shaper precedent). The seeded
// d3-force settle (mulberry32) itself stays INSIDE each scaffold, operating on
// this shaper's injected {category,value} points -- both scaffolds use the
// identical seed against the identical shaped data, so the settled layout is
// deterministic and identical between the two.
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed -- this file only
// adds category-cardinality (2..maxCategories, BIND-04) and a total-usable-
// point ceiling (maxPoints, BIND-04) the generic validator can't express.
//
// Category-ordering rule mirrors scripts/shapers/bar.mjs's own
// orderCategories() (ORDINAL_SETS duplicated here in miniature, same
// self-contained-pure-function rationale bar.mjs documents) -- but keyed by
// each group's MEAN rather than a single aggregated value, matching
// scripts/shapers/box-violin.mjs's own median-keyed variant for a
// per-category (not per-row) grouping.

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

function orderCategories(aggregated) {
  const labels = aggregated.map((g) => g.label);
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

  return [...aggregated].sort((a, b) => b.mean - a.mean);
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
 * stats:{categories,topLabel,topMean,othersMean,diff,rowCount}}
 *
 * `data` is the flat per-record {category,value} list -- both scaffolds
 * settle it themselves via d3-force, keyed on `stats.categories` for lane
 * order/count (never a hardcoded species array).
 *
 * stats.diff generalizes the shipped beeswarm.html's "top species runs N kg
 * heavier" finding: `topLabel` is the category with the highest MEAN value
 * (recomputed from data, matching the Phase-3 Gentoo correction lesson --
 * never assume which category is "highest" from a hardcoded label);
 * `othersMean` is every OTHER category's values pooled into one weighted
 * mean; `diff` = topLabel's mean - othersMean.
 */
export function shape(rows, bindings) {
  const points = usablePoints(rows, bindings);
  const groups = groupByCategory(points);

  const aggregated = [...groups.entries()].map(([label, values]) => ({
    label,
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  }));

  const ordered = orderCategories(aggregated);

  const top = ordered.length > 0 ? ordered.reduce((best, g) => (g.mean > best.mean ? g : best), ordered[0]) : null;
  const others = top ? ordered.filter((g) => g.label !== top.label) : [];
  const othersN = others.reduce((sum, g) => sum + g.n, 0);
  const othersMean = others.length > 0 ? others.reduce((sum, g) => sum + g.mean * g.n, 0) / othersN : null;
  const diff = top && othersMean !== null ? top.mean - othersMean : null;

  const stats = {
    categories: ordered.map((g) => g.label),
    topLabel: top ? top.label : null,
    topMean: top ? top.mean : null,
    othersMean,
    diff,
    rowCount: points.length,
  };

  return { data: points, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (a beeswarm
 *   needs at least 2 lanes to compare) -- a hardcoded structural rule.
 * - more than `contract.seriesLimits.maxCategories` distinct categories (when
 *   present) -- rejected naming the ceiling (BIND-04).
 * - more than `contract.seriesLimits.maxPoints` usable points (when present)
 *   -- rejected naming the ceiling (BIND-04); this is the graceful-failure
 *   the proof test exercises for the family (a settled force simulation over
 *   too many points also stops being individually legible).
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
      problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${bindings.category}' -- a beeswarm needs at least 2 categories to compare`,
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
