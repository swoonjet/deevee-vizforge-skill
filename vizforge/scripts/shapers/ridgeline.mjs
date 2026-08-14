// scripts/shapers/ridgeline.mjs
//
// BIND-01/02/04 (Phase 7 Plan 11) -- the ridgeline technique's shaper.
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed -- this file only
// adds category-cardinality (2..maxCategories:20, BIND-04) the generic
// validator can't express.
//
// The demo reuses 07-04's shared tall GISTEMP fixture
// (scripts/tests/fixtures/binding/gistemp_glb_monthly_tall.csv) READ-ONLY --
// `category` bound to its `year` column (profiles temporal, 147 distinct
// bare-year values), `value` bound to `val`. bucketKey() below is horizon.mjs's
// own generic bare-year->decade fold, reused verbatim (duplicated per the
// shaper self-contained-file convention): any bound category value that
// looks like a bare 4-digit year in a sane calendar range folds to its
// decade; any other bound value groups literally (its own trimmed string) --
// a fully dataset-agnostic rule, never GISTEMP-specific.
//
// KDE moves INTO the shaper (mirrors box-violin.mjs's own precedent, 07-09):
// a Gaussian kernel with Silverman's rule-of-thumb bandwidth, sampled across
// the GLOBAL value range (shared across every row) so every ridge is
// comparable on the same x-axis -- bandwidth is now data-driven per group,
// never a fixed magnitude-specific constant (the old shipped scaffold's
// Epanechnikov kernel + hardcoded 0.12 bandwidth was tuned to GISTEMP's own
// anomaly-degree scale, not general).

const BARE_YEAR = /^\d{4}$/;

function bucketKey(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (BARE_YEAR.test(v)) {
    const year = Number(v);
    if (year >= 1500 && year <= 2100) return String(Math.floor(year / 10) * 10);
  }
  return v;
}

function groupRows(rows, bindings) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;
  const groups = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const rawCat = row[categoryCol];
    if (rawCat === undefined || rawCat === null || String(rawCat).trim() === '') continue;
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    const key = bucketKey(rawCat);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(num);
  }
  return groups;
}

function orderLabels(labels) {
  return [...labels].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

// Gaussian KDE, Silverman's rule-of-thumb bandwidth -- mirrors box-violin.mjs's
// own kde() (duplicated per the shaper self-contained-file convention).
function kde(values, domainMin, domainMax, points = 120) {
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

/**
 * shape(rows, bindings) -> {data:[{label,n,mean,density:[{x,y}]}],
 * stats:{groupCount,firstLabel,firstMean,lastLabel,lastMean,delta,rowCount,
 * globalMin,globalMax}}
 *
 * Rows ordered oldest-row-first (numeric-ascending for a bucketed/numeric
 * label, else alphabetical) -- `firstLabel`/`lastLabel` are simply the first
 * and last entries in that order, generalizing the shipped ridgeline.html's
 * "typical value shifted from the first row to the last row" finding to
 * WHATEVER category is bound (never a hardcoded "decade").
 */
export function shape(rows, bindings) {
  const groups = groupRows(rows, bindings);
  const labels = orderLabels([...groups.keys()]);

  const allValues = [];
  labels.forEach((l) => groups.get(l).forEach((v) => allValues.push(v)));
  const globalMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const globalMax = allValues.length > 0 ? Math.max(...allValues) : 0;

  const data = labels.map((label) => {
    const values = groups.get(label);
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    return { label, n, mean, density: kde(values, globalMin, globalMax) };
  });

  const first = data.length > 0 ? data[0] : null;
  const last = data.length > 0 ? data[data.length - 1] : null;

  const stats = {
    groupCount: data.length,
    firstLabel: first ? first.label : null,
    firstMean: first ? first.mean : null,
    lastLabel: last ? last.label : null,
    lastMean: last ? last.mean : null,
    delta: first && last ? last.mean - first.mean : null,
    rowCount: allValues.length,
    globalMin,
    globalMax,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bucketed categories: always rejected (a ridgeline
 *   needs at least 2 rows to compare) -- a hardcoded structural rule.
 * - more than `contract.seriesLimits.maxCategories` (BIND-04, this
 *   technique's own ceiling is 20) distinct bucketed categories -- rejected
 *   naming the ceiling, counted AFTER bucketing (a bare-year category is
 *   judged on its decade count, mirrors horizon.mjs's own precedent).
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const groups = groupRows(rows, bindings);
  const distinctCount = groups.size;

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (distinctCount < 2) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${bindings.category}' -- a ridgeline needs at least 2 rows to compare`,
      remedy: `bind 'category' to a column (or a bare-year column, folded to decade) with at least 2 distinct groups`,
    });
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': ${distinctCount} distinct rows exceeds the maximum of ${maxCategories} ridges`,
      remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct groups`,
    });
  }

  return errors;
}
