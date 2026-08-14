// scripts/shapers/pie-donut.mjs
//
// BIND-01/02/04 (Phase 7 Plan 06) -- pie-donut's shaper: the bar-column
// family's first PART-TO-WHOLE technique. Reuses bar.mjs's (07-04)
// distinct-set category aggregation shape, but the value role only ever
// SUMS or COUNTS (a part-to-whole share is never meaningfully averaged --
// this technique's dataBinding.roles[value].aggregation deliberately omits
// 'mean'), and every category also carries its `share` of the whole (the
// number the angle channel actually encodes).
//
// Ordering is always value-descending (largest slice first, the
// pie/donut convention) -- unlike bar.mjs's ordinal-aware rule, since this
// technique's honestyRisks explicitly flag that ordering/start-angle can
// bias perceived size, and neither of its shipped demos (survived/died,
// energy sources) has a natural ordinal reading.

/**
 * shape(rows, bindings) -> {data:[{label,value,share,n}], stats:{total,
 * topLabel,topShare,bottomLabel,bottomShare,rowCount}}
 *
 * Categories (slices) come from the DISTINCT set of the bound
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
 *   slice chart needs at least 2 parts).
 * - more than `contract.seriesLimits.maxCategories` distinct categories (when
 *   that field is present on the passed contract): rejected naming the
 *   ceiling (BIND-04) -- this technique's own honestyRisks flag angle
 *   perception as unreliable beyond a few slices.
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
        problem: `channel 'category': ${distinctCount} distinct values in '${categoryCol}' exceeds the maximum of ${maxCategories} slices -- angle perception is unreliable beyond a few slices`,
        remedy: `bind 'category' to a column with ${maxCategories} or fewer distinct values, or use a bar chart instead`,
      },
    ];
  }

  return [];
}
