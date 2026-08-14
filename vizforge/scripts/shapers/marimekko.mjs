// scripts/shapers/marimekko.mjs
//
// MOS-01 (Phase 23 Plan 03) -- the marimekko/mosaic technique's shaper. The
// only 2-categorical part-to-whole form in the atlas: a cross-tab of
// xCategory x yCategory counts (or an optional summed `value`) laid out as
// nested rectangles whose BOTH axes are true proportions --
//
//   column WIDTH  proportional to that x-category's TOTAL (its share of the
//                 grand total), Sigma(column widths) === plotWidth
//   segment HEIGHT proportional to that y-category's share WITHIN its own
//                 column, per-column Sigma(segment heights) === plotHeight
//
// Therefore every rect's AREA (width * height) is the JOINT proportion of
// (xCategory, yCategory) -- the marimekko's honest signature (23-CONTEXT.md,
// 23-03-PLAN.md <interfaces> TRUE-PROPORTION GEOMETRY). No third variable is
// ever encoded on these rects -- color identifies the y-category only (an
// identity channel, not a second quantitative one).

// Known-set ordinal matching -- mirrors scripts/shapers/bar.mjs's own
// ORDINAL_SETS (duplicated here in miniature, per the shaper contract: each
// shaper stays a fully self-contained, dependency-free pure function rather
// than importing another shaper's internals).
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
 * Deterministic category ordering (mirrors bar.mjs's orderCategories rule,
 * applied here to a bare array of distinct label strings rather than
 * aggregated {label,value} rows, since BOTH the x-category and y-category
 * axes need the same ordering rule applied independently):
 *   - a recognized ORDINAL_SET (case-insensitive) -> that set's natural order
 *   - all-numeric-looking labels (e.g. Titanic's Pclass 1/2/3, Survived 0/1)
 *     -> ascending numeric order
 *   - otherwise (genuine unordered nominal) -> alphabetical (stable, not
 *     value-dependent -- unlike bar.mjs, a cross-tab has no single scalar
 *     "value" per label to sort by until AFTER this ordering already fixed
 *     which rows/columns exist)
 */
function orderKeys(keys) {
  const lower = keys.map((k) => k.toLowerCase());
  const matchedSet = ORDINAL_SETS.find((set) => lower.every((v) => set.includes(v)));

  if (matchedSet) {
    return [...keys].sort((a, b) => matchedSet.indexOf(a.toLowerCase()) - matchedSet.indexOf(b.toLowerCase()));
  }

  if (keys.every((k) => isCoercibleNumber(k))) {
    return [...keys].sort((a, b) => Number(a) - Number(b));
  }

  return [...keys].sort();
}

const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 520;

/**
 * shape(rows, bindings) -> {
 *   columns: [{ key, total, x, width, segments: [{ key, count, y, height }] }],
 *   plotWidth, plotHeight, yKeys,
 *   stats: { grandTotal, columnCount, segmentCount, rowCount,
 *            topColumnKey, topColumnTotal, topColumnShare,
 *            bottomColumnKey, bottomColumnTotal, bottomColumnShare,
 *            highlightSegmentKey,
 *            topHighlightColumnKey, topHighlightShare,
 *            bottomHighlightColumnKey, bottomHighlightShare }
 * }
 *
 * `bindings.xCategory`/`bindings.yCategory` select the two categorical
 * columns actually present in `rows`; `bindings.value` is OPTIONAL -- when
 * absent, each (xCategory,yCategory) cell is the row COUNT; when bound, the
 * cell is the SUM of that numeric column (matches `dataBinding.roles.value`'s
 * declared aggregation: sum|count, default count).
 *
 * Column x-offsets/widths and per-column segment y-offsets/heights are laid
 * out left-to-right / top-to-bottom over the shaper's own fixed
 * [PLOT_WIDTH, PLOT_HEIGHT] coordinate space -- the scaffold renders this
 * space 1:1 into an SVG viewBox (circle-packing.mjs precedent), so no
 * re-layout ever happens client-side. Zero gutter between columns/segments
 * (23-03-PLAN.md <interfaces>: "prefer zero/near-zero gutter for honesty") --
 * true proportion is preserved exactly, not approximated around a layout gap.
 */
export function shape(rows, bindings) {
  const xCol = bindings.xCategory;
  const yCol = bindings.yCategory;
  const valueCol = bindings.value;

  const cross = new Map(); // xKey -> Map(yKey -> amount)
  const xKeysSet = new Set();
  const yKeysSet = new Set();
  let rowCount = 0;

  for (const row of rows) {
    if (!row) continue;
    const rawX = row[xCol];
    const rawY = row[yCol];
    if (rawX === undefined || rawX === null || String(rawX).trim() === '') continue;
    if (rawY === undefined || rawY === null || String(rawY).trim() === '') continue;

    let amount = 1;
    if (valueCol) {
      const num = Number(row[valueCol]);
      if (!Number.isFinite(num)) continue;
      amount = num;
    }

    const xKey = String(rawX).trim();
    const yKey = String(rawY).trim();
    xKeysSet.add(xKey);
    yKeysSet.add(yKey);
    rowCount += 1;

    if (!cross.has(xKey)) cross.set(xKey, new Map());
    const yMap = cross.get(xKey);
    yMap.set(yKey, (yMap.get(yKey) || 0) + amount);
  }

  const xKeys = orderKeys([...xKeysSet]);
  const yKeys = orderKeys([...yKeysSet]);

  const xTotals = xKeys.map((xKey) => {
    const yMap = cross.get(xKey) || new Map();
    let total = 0;
    for (const yKey of yKeys) total += yMap.get(yKey) || 0;
    return total;
  });
  const grandTotal = xTotals.reduce((a, b) => a + b, 0);

  let xCursor = 0;
  const columns = xKeys.map((xKey, i) => {
    const total = xTotals[i];
    const width = grandTotal > 0 ? (total / grandTotal) * PLOT_WIDTH : 0;
    const x = xCursor;
    xCursor += width;

    const yMap = cross.get(xKey) || new Map();
    let yCursor = 0;
    const segments = yKeys.map((yKey) => {
      const count = yMap.get(yKey) || 0;
      const height = total > 0 ? (count / total) * PLOT_HEIGHT : 0;
      const y = yCursor;
      yCursor += height;
      return { key: yKey, count, y, height };
    });

    return { key: xKey, total, x, width, segments };
  });

  // Stats -- generic (never domain-specific), mirroring bar.mjs's
  // top/bottom-by-value framing. `highlightSegmentKey` is the LAST y-key in
  // this shaper's own deterministic order (e.g. Survived's numeric-ascending
  // order puts "0" then "1", so highlightSegmentKey is "1") -- a computed
  // convention, not a hardcoded domain label, so the same shaper narrates
  // any bound categorical pair.
  const byTotalDesc = [...columns].sort((a, b) => b.total - a.total);
  const topColumn = byTotalDesc[0];
  const bottomColumn = byTotalDesc[byTotalDesc.length - 1];

  const highlightSegmentKey = yKeys.length > 0 ? yKeys[yKeys.length - 1] : null;
  const highlightShares = columns.map((col) => {
    const seg = col.segments.find((s) => s.key === highlightSegmentKey);
    const share = seg && col.total > 0 ? seg.count / col.total : 0;
    return { key: col.key, share };
  });
  const byHighlightShareDesc = [...highlightShares].sort((a, b) => b.share - a.share);
  const topHighlight = byHighlightShareDesc[0];
  const bottomHighlight = byHighlightShareDesc[byHighlightShareDesc.length - 1];

  const stats = {
    grandTotal,
    columnCount: xKeys.length,
    segmentCount: yKeys.length,
    rowCount,
    topColumnKey: topColumn ? topColumn.key : null,
    topColumnTotal: topColumn ? topColumn.total : null,
    topColumnShare: topColumn && grandTotal > 0 ? topColumn.total / grandTotal : null,
    bottomColumnKey: bottomColumn ? bottomColumn.key : null,
    bottomColumnTotal: bottomColumn ? bottomColumn.total : null,
    bottomColumnShare: bottomColumn && grandTotal > 0 ? bottomColumn.total / grandTotal : null,
    highlightSegmentKey,
    topHighlightColumnKey: topHighlight ? topHighlight.key : null,
    topHighlightShare: topHighlight ? topHighlight.share : null,
    bottomHighlightColumnKey: bottomHighlight ? bottomHighlight.key : null,
    bottomHighlightShare: bottomHighlight ? bottomHighlight.share : null,
  };

  return { columns, plotWidth: PLOT_WIDTH, plotHeight: PLOT_HEIGHT, yKeys, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct xCategory values: rejected (a marimekko needs at
 *   least 2 columns to compare).
 * - fewer than 2 distinct yCategory values: rejected (needs at least 2
 *   stacked segments to show within-column composition -- a single segment
 *   would just be a bar chart, not a mosaic).
 * - more than `contract.seriesLimits.maxCategories` distinct values in
 *   EITHER axis (when that field is present on the passed contract):
 *   rejected naming the ceiling and which axis exceeded it (mirrors
 *   bar.mjs's BIND-04 pattern, applied independently to both categorical
 *   roles since either axis growing unboundedly breaks the form -- too many
 *   thin columns, or too many stacked slivers exceeding the house palette's
 *   hue cap).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const xCol = bindings.xCategory;
  const yCol = bindings.yCategory;

  const distinctX = new Set(
    (rows || [])
      .map((r) => (r ? r[xCol] : undefined))
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v) => String(v).trim())
  );
  const distinctY = new Set(
    (rows || [])
      .map((r) => (r ? r[yCol] : undefined))
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v) => String(v).trim())
  );

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  const problems = [];

  if (distinctX.size < 2) {
    problems.push({
      channel: 'xCategory',
      problem: `channel 'xCategory': only ${distinctX.size} distinct value(s) found in '${xCol}' -- a marimekko needs at least 2 x-categories (columns) to compare`,
      remedy: `bind 'xCategory' to a column with at least 2 distinct values`,
    });
  } else if (maxCategories !== undefined && distinctX.size > maxCategories) {
    problems.push({
      channel: 'xCategory',
      problem: `channel 'xCategory': ${distinctX.size} distinct values in '${xCol}' exceeds the maximum of ${maxCategories} columns`,
      remedy: `bind 'xCategory' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
    });
  }

  if (distinctY.size < 2) {
    problems.push({
      channel: 'yCategory',
      problem: `channel 'yCategory': only ${distinctY.size} distinct value(s) found in '${yCol}' -- a marimekko needs at least 2 y-categories (stacked segments) to show within-column composition`,
      remedy: `bind 'yCategory' to a column with at least 2 distinct values`,
    });
  } else if (maxCategories !== undefined && distinctY.size > maxCategories) {
    problems.push({
      channel: 'yCategory',
      problem: `channel 'yCategory': ${distinctY.size} distinct values in '${yCol}' exceeds the maximum of ${maxCategories} segments`,
      remedy: `bind 'yCategory' to a column with ${maxCategories} or fewer distinct values, or pre-aggregate rarer categories together`,
    });
  }

  return problems;
}
