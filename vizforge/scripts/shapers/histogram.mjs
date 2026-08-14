// scripts/shapers/histogram.mjs
//
// BIND-01/02/04 (Phase 7 Plan 09) -- the histogram technique's shaper
// (tier-1 scatter-distribution family, wave 3). shape(rows, bindings) is
// pure. validate(rows, bindings, {contract, profile}) runs AFTER the
// generic validateBinding() in scripts/bind-data.mjs already passed -- this
// file only adds maxPoints/maxCategories(facet) ceilings the generic
// validator can't express (BIND-04).
//
// Bin width is ALWAYS derived from the bound `value` column (Freedman-
// Diaconis rule) -- never a hard-coded literal like the shipped scaffold's
// old fixed 250g choice (07-09-PLAN.md must_have: "bins derived from the
// data, not hard-coded").

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function quantileSorted(sorted, q) {
  const n = sorted.length;
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

/**
 * Freedman-Diaconis bin width: 2*IQR / n^(1/3). Falls back to a span/sqrt(n)
 * width when the IQR is 0 (e.g. a near-constant bound column) so binning
 * never divides by zero.
 */
function binWidthFor(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  if (iqr > 0) return 2 * iqr * Math.pow(n, -1 / 3);
  const span = sorted[n - 1] - sorted[0];
  return span > 0 ? span / Math.max(1, Math.ceil(Math.sqrt(n))) : 1;
}

/**
 * Coerces rows to usable {value, facet?} entries -- rows whose bound
 * `value` doesn't coerce to a finite number are dropped entirely.
 */
function usableRows(rows, bindings) {
  const valueCol = bindings.value;
  const facetCol = bindings.facet;
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (!isFiniteNumber(row[valueCol])) continue;
    const entry = { value: Number(row[valueCol]) };
    if (facetCol && row[facetCol] !== undefined && row[facetCol] !== null && String(row[facetCol]).trim() !== '') {
      entry.facet = String(row[facetCol]).trim();
    }
    out.push(entry);
  }
  return out;
}

/**
 * shape(rows, bindings) -> {data:[{x0,x1,total,topCount?,otherCount?}],
 * stats:{binWidth,peakBinX0,peakBinX1,peakCount,rowCount,topFacetLabel?,
 * topFacetMean?,otherFacetMean?,topFacetDiff?}}
 *
 * Bins the bound `value` column using a data-derived Freedman-Diaconis
 * width. When `bindings.facet` is bound, each bin also carries `topCount`
 * (rows from the facet category with the overall highest mean `value`) vs
 * `otherCount` (every other facet category combined) -- the generalized
 * form of the shipped Gentoo-vs-rest stacked comparison, recomputed from
 * data (matching the Phase-3 Gentoo correction lesson: independently
 * recompute, never trust a hardcoded finding).
 */
export function shape(rows, bindings) {
  const usable = usableRows(rows, bindings);
  const values = usable.map((r) => r.value);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = binWidthFor(values);
  const start = Math.floor(min / width) * width;
  const binCount = Math.max(1, Math.ceil((max - start) / width));

  const bins = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ x0: start + i * width, x1: start + (i + 1) * width, rows: [] });
  }
  for (const r of usable) {
    let idx = Math.floor((r.value - start) / width);
    if (idx >= bins.length) idx = bins.length - 1;
    if (idx < 0) idx = 0;
    bins[idx].rows.push(r);
  }

  const facetLabels = bindings.facet
    ? [...new Set(usable.map((r) => r.facet).filter((v) => v !== undefined))]
    : [];

  let topFacetLabel = null;
  let topFacetMean = null;
  let otherFacetMean = null;
  let topFacetDiff = null;

  if (facetLabels.length > 0) {
    const means = facetLabels.map((label) => {
      const vals = usable.filter((r) => r.facet === label).map((r) => r.value);
      return { label, mean: vals.reduce((a, b) => a + b, 0) / vals.length };
    });
    const top = means.reduce((best, d) => (d.mean > best.mean ? d : best), means[0]);
    topFacetLabel = top.label;
    topFacetMean = top.mean;
    const otherValues = usable.filter((r) => r.facet !== topFacetLabel).map((r) => r.value);
    otherFacetMean = otherValues.length > 0 ? otherValues.reduce((a, b) => a + b, 0) / otherValues.length : null;
    topFacetDiff = otherFacetMean !== null ? topFacetMean - otherFacetMean : null;
  }

  const data = bins.map((b) => {
    const total = b.rows.length;
    if (!topFacetLabel) return { x0: b.x0, x1: b.x1, total };
    const topCount = b.rows.filter((r) => r.facet === topFacetLabel).length;
    return { x0: b.x0, x1: b.x1, total, topCount, otherCount: total - topCount };
  });

  const peak = data.reduce((best, d) => (d.total > best.total ? d : best), data[0]);

  const stats = {
    binWidth: width,
    peakBinX0: peak ? peak.x0 : null,
    peakBinX1: peak ? peak.x1 : null,
    peakCount: peak ? peak.total : 0,
    rowCount: usable.length,
    topFacetLabel,
    topFacetMean,
    otherFacetMean,
    topFacetDiff,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 usable rows (can't derive a meaningful bin width) ->
 *   {channel:'value'}.
 * - more than `contract.seriesLimits.maxPoints` usable rows -> {channel:'value'}
 *   (BIND-04). Absent entirely -> no ceiling enforced (see scatter.mjs's own
 *   note on this convention).
 * - more than `contract.seriesLimits.maxCategories` distinct bound `facet`
 *   values (only checked when `facet` is actually bound) -> {channel:'facet'}
 *   (BIND-04).
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const usable = usableRows(rows, bindings);

  if (usable.length < 2) {
    errors.push({
      channel: 'value',
      problem: `channel 'value': only ${usable.length} usable row(s) after coercing '${bindings.value}' -- a histogram needs at least 2 numeric rows`,
      remedy: `bind 'value' to a column with at least 2 numeric rows`,
    });
  }

  const maxPoints =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxPoints === 'number'
      ? contract.seriesLimits.maxPoints
      : undefined;
  if (maxPoints !== undefined && usable.length > maxPoints) {
    errors.push({
      channel: 'value',
      problem: `channel 'value': ${usable.length} usable rows exceeds the maximum of ${maxPoints}`,
      remedy: `bind to a dataset with ${maxPoints} or fewer rows, or pre-aggregate/sample down`,
    });
  }

  if (bindings.facet) {
    const distinct = new Set(usable.map((r) => r.facet).filter((v) => v !== undefined));
    const maxCategories =
      contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
        ? contract.seriesLimits.maxCategories
        : undefined;
    if (maxCategories !== undefined && distinct.size > maxCategories) {
      errors.push({
        channel: 'facet',
        problem: `channel 'facet': ${distinct.size} distinct values in '${bindings.facet}' exceeds the maximum of ${maxCategories}`,
        remedy: `bind 'facet' to a column with ${maxCategories} or fewer distinct values`,
      });
    }
  }

  return errors;
}
