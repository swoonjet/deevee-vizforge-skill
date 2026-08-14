// scripts/shapers/waffle-isotype.mjs
//
// BIND-01/02/04 (Phase 7 Plan 06) -- waffle-isotype's shaper: the family's
// second PART-TO-WHOLE technique, structurally identical to pie-donut.mjs's
// (07-06) category-aggregation-with-share shape (each shaper stays a fully
// self-contained, dependency-free pure function per scripts/shapers/README.md
// -- small duplication across shapers is intentional, not an oversight).
// The 100-unit-square grid layout + largest-remainder rounding allocation
// (largest-remainder-rounding-must-be-disclosed-when-squares-dont-divide-evenly,
// this technique's own honestyRisks) is a RENDERING concern computed in
// scaffolds/src/waffle-isotype.src.html from this shaper's `share` field --
// mirroring how bar.src.html's scaleBand/scaleLinear and pie-donut.src.html's
// d3.pie() both live in the scaffold, not the shaper.

/**
 * shape(rows, bindings) -> {data:[{label,value,share,n}], stats:{total,
 * topLabel,topShare,bottomLabel,bottomShare,rowCount}}
 *
 * Categories (parts) come from the DISTINCT set of the bound
 * `bindings.category` column actually present in `rows` -- never a literal
 * hardcoded array. `bindings.aggregation.value` selects sum|count (default
 * 'sum'). `share` = category value / total value across ALL categories.
 */
export function shape(rows, bindings) {
  const categoryCol = bindings.category;
  const valueCol = bindings.value;
  const aggName = (bindings.aggregation && bindings.aggregation.value) || 'sum';

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
    const value = aggName === 'count' ? n : values.reduce((a, b) => a + b, 0);
    return { label, value, n };
  });

  const total = aggregated.reduce((sum, d) => sum + d.value, 0);
  const withShare = aggregated.map((d) => ({ ...d, share: total > 0 ? d.value / total : 0 }));
  const data = withShare.slice().sort((a, b) => b.value - a.value);

  const top = data[0] || null;
  const bottom = data.length > 0 ? data[data.length - 1] : null;

  const stats = {
    total,
    topLabel: top ? top.label : null,
    topShare: top ? top.share : null,
    bottomLabel: bottom ? bottom.label : null,
    bottomShare: bottom ? bottom.share : null,
    rowCount: rows.length,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct bound categories: always rejected (a part-to-whole
 *   chart needs at least 2 parts).
 * - more than `contract.seriesLimits.maxCategories` distinct categories (when
 *   that field is present on the passed contract): rejected naming the
 *   ceiling (BIND-04) -- more than a handful of isotype groups stop being
 *   individually countable/legible.
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
        problem: `channel 'category': only ${distinctCount} distinct value(s) found in '${categoryCol}' -- a part-to-whole chart needs at least 2 parts`,
        remedy: `bind 'category' to a column with at least 2 distinct values`,
      },
    ];
  }

  if (maxCategories !== undefined && distinctCount > maxCategories) {
    return [
      {
        channel: 'category',
        problem: `channel 'category': ${distinctCount} distinct values in '${categoryCol}' exceeds the maximum of ${maxCategories} groups -- more groups stop being individually countable`,
        remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
      },
    ];
  }

  return [];
}
