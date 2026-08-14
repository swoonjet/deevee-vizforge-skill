// scripts/shapers/box-violin.mjs
//
// BIND-01/02/04 (Phase 7 Plan 09) -- the box-violin technique's shaper
// (tier-1 scatter-distribution family, wave 3). shape(rows, bindings) is
// pure. validate(rows, bindings, {contract, profile}) runs AFTER the
// generic validateBinding() in scripts/bind-data.mjs already passed -- this
// file only adds category-cardinality (2..maxCategories, BIND-04) and a
// minimum-per-group sample-size rule the generic validator can't express.
//
// Category-ordering rule mirrors scripts/shapers/bar.mjs's own
// orderCategories() (ORDINAL_SETS duplicated here in miniature, same
// self-contained-pure-function rationale bar.mjs documents) -- but keyed by
// each group's MEDIAN rather than a single aggregated value, since a
// box/violin group has no single "value" the way a bar category does.

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

function quantilesOf(sortedValues) {
  const n = sortedValues.length;
  const q1 = sortedValues[Math.floor(n * 0.25)];
  const q3 = sortedValues[Math.floor(n * 0.75)];
  const median = n % 2 ? sortedValues[(n - 1) / 2] : (sortedValues[n / 2 - 1] + sortedValues[n / 2]) / 2;
  return { q1, median, q3 };
}

/**
 * Gaussian KDE, Silverman's rule-of-thumb bandwidth -- sampled at `points`
 * evenly-spaced locations across `[domainMin, domainMax]` (the GLOBAL value
 * range across every group, so every group's density curve is comparable on
 * the same x-axis). Falls back to a small fixed bandwidth when a group's
 * sample variance is 0 (all-identical values) so density never divides by
 * zero.
 */
function kde(values, domainMin, domainMax, points = 32) {
  const n = values.length;
  if (n === 0 || domainMax <= domainMin) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const bandwidth = sd > 0 ? 1.06 * sd * Math.pow(n, -1 / 5) : (domainMax - domainMin) / 20 || 1;
  const step = (domainMax - domainMin) / (points - 1);
  const density = [];
  for (let i = 0; i < points; i++) {
    const x = domainMin + i * step;
    let sum = 0;
    for (const v of values) {
      const u = (x - v) / bandwidth;
      sum += Math.exp(-0.5 * u * u);
    }
    density.push({ x, y: sum / (n * bandwidth * Math.sqrt(2 * Math.PI)) });
  }
  return density;
}

function orderGroups(aggregated) {
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

  return [...aggregated].sort((a, b) => b.median - a.median);
}

function groupRows(rows, categoryCol, valueCol) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const rawCat = row[categoryCol];
    if (rawCat === undefined || rawCat === null || String(rawCat).trim() === '') continue;
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    const key = String(rawCat).trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(num);
  }
  return groups;
}

/**
 * shape(rows, bindings) -> {data:[{label,n,min,max,q1,median,q3,
 * whiskerLow,whiskerHigh,outliers,density}], stats:{topLabel,topMin,
 * othersMax,overlap,rowCount,globalMin,globalMax}}
 *
 * Per-category quartiles/IQR/whiskers (1.5*IQR fence, matching the shipped
 * box-violin.html's own convention) + a Gaussian KDE density curve for a
 * future violin overlay (variationAxes: box-vs-violin).
 *
 * stats.overlap recomputes the shipped piece's "does the top group's range
 * overlap the rest" finding, generalized: `topLabel` is the group with the
 * highest MEDIAN (recomputed from data, matching the Phase-3 Gentoo
 * correction lesson -- never assume which group is "highest" from a
 * hardcoded species name); `overlap` = (max across every OTHER group) -
 * (topLabel's own min) -- positive means a sliver of overlap, zero/negative
 * means no overlap at all.
 */
export function shape(rows, bindings) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;

  const groups = groupRows(rows, categoryCol, valueCol);

  const aggregated = [...groups.entries()].map(([label, rawValues]) => {
    const values = rawValues.slice().sort((a, b) => a - b);
    const n = values.length;
    const { q1, median, q3 } = quantilesOf(values);
    const iqr = q3 - q1;
    const fenceLow = q1 - 1.5 * iqr;
    const fenceHigh = q3 + 1.5 * iqr;
    const inFence = values.filter((v) => v >= fenceLow && v <= fenceHigh);
    const outliers = values.filter((v) => v < fenceLow || v > fenceHigh);
    return {
      label,
      n,
      min: values[0],
      max: values[n - 1],
      q1,
      median,
      q3,
      whiskerLow: inFence.length > 0 ? inFence[0] : values[0],
      whiskerHigh: inFence.length > 0 ? inFence[inFence.length - 1] : values[n - 1],
      outliers,
      values,
    };
  });

  const ordered = orderGroups(aggregated);

  const globalMin = Math.min(...ordered.map((g) => g.min));
  const globalMax = Math.max(...ordered.map((g) => g.max));

  const data = ordered.map((g) => ({
    label: g.label,
    n: g.n,
    min: g.min,
    max: g.max,
    q1: g.q1,
    median: g.median,
    q3: g.q3,
    whiskerLow: g.whiskerLow,
    whiskerHigh: g.whiskerHigh,
    outliers: g.outliers,
    density: kde(g.values, globalMin, globalMax),
  }));

  const top = ordered.length > 0 ? ordered.reduce((best, g) => (g.median > best.median ? g : best), ordered[0]) : null;
  const others = top ? ordered.filter((g) => g.label !== top.label) : [];
  const othersMax = others.length > 0 ? Math.max(...others.map((g) => g.max)) : null;
  const overlap = top && othersMax !== null ? othersMax - top.min : null;

  const stats = {
    topLabel: top ? top.label : null,
    topMin: top ? top.min : null,
    othersMax,
    overlap,
    rowCount: ordered.reduce((sum, g) => sum + g.n, 0),
    globalMin,
    globalMax,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (needs at least
 *   2 groups to compare) -- a hardcoded structural rule.
 * - more than `contract.seriesLimits.maxCategories` distinct categories
 *   (when present on the passed contract) -- rejected naming the ceiling
 *   (BIND-04). This is the graceful-failure the proof test exercises.
 * - any group with fewer than 2 values: quartiles/IQR are meaningless (or
 *   crash-prone) on a 0/1-length sample -- rejected naming the offending
 *   group(s).
 */
export function validate(rows, bindings, { contract } = {}) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;
  const groups = groupRows(rows, categoryCol, valueCol);
  const distinctCount = groups.size;

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  const errors = [];

  if (distinctCount < 2) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${categoryCol}' -- a box/violin needs at least 2 groups to compare`,
      remedy: `bind 'category' to a column with at least 2 distinct values`,
    });
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': ${distinctCount} distinct values in '${categoryCol}' exceeds the maximum of ${maxCategories} groups`,
      remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
    });
  }

  const tooSmall = [...groups.entries()].filter(([, values]) => values.length < 2);
  if (tooSmall.length > 0) {
    errors.push({
      channel: 'value',
      problem: `channel 'value': group(s) ${tooSmall.map(([label]) => `"${label}"`).join(', ')} have fewer than 2 values in '${valueCol}' -- cannot compute quartiles`,
      remedy: `bind 'category' to a column where every group has at least 2 rows`,
    });
  }

  return errors;
}
