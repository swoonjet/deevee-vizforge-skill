// assets/modules/cat-shape.js
//
// THE CATEGORICAL FAMILY — one category, one measure, optionally split.
//
// The fourth ingestion shape in this library after time series (ts-shape),
// hierarchy (hier-shape), edges (edge-shape) and two-numerics (xy-shape). It is
// the plainest of the five and was the last to exist, which is why the gallery
// had no bar chart and no pie: hier-shape needs TWO nesting levels and refuses
// a single flat category, so the most ordinary table in the world had nowhere
// to go.
//
// WHAT IT OWNS. A shaper's job in this library is the handful of rules a form
// cannot show for itself, decided once so every form on the shape agrees:
//
//   1. A BLANK IS NOT A ZERO. Rows whose measure will not parse are dropped and
//      counted, and the count is disclosed in the source line. Plotting them as
//      zero invents a category that measured nothing.
//   2. REPEATED CATEGORIES SUM. A table with twelve rows for "EMEA" is twelve
//      observations of one category, and a bar per row would draw the same
//      category twelve times at a twelfth of its size.
//   3. A RATE DOES NOT ADD UP. When the measure's NAME reads like an average,
//      a percentage or a score, summing it produces a total that does not
//      exist. Flagged as `rateLike` so a form can say so, or refuse.
//   4. NEGATIVES SURVIVE. Unlike hier-shape (where a negative area is
//      meaningless) a bar can honestly sit below its baseline, so signed values
//      are KEPT and `hasNegative` is raised. Part-to-whole forms — a pie has no
//      way to draw minus eight percent — refuse on that flag rather than
//      quietly dropping rows.
//
// WHAT IT DOES NOT DO: sort. Order is a reading decision that belongs to the
// form (a pie runs biggest-first; a bar over an ordinal category must keep the
// table's own order or it invents a ranking), so both orders travel and the
// module picks.

import { num } from './d3-piece.js';
import { formatNumber, UNLABELLED, assignColors, looksLikeRate } from './vf-core.js';

/**
 * rows + {category, value?, series?} -> {data, stats}
 *
 * `data` is `[{ name, value, seq, parts:[{name, value}] }]` in DESCENDING value
 * order. `parts` is empty unless `series` was bound; when it is, each part is
 * one series' contribution to that category and `value` is their sum.
 *
 * With no `value` column bound the shaper COUNTS rows, which is what makes
 * "how many of each?" answerable from a table that holds no measure at all.
 */
export function catShape(rows, bindings = {}) {
  const catCol = bindings.category;
  const valueCol = bindings.value;
  const seriesCol = bindings.series;
  const counting = valueCol === undefined || valueCol === null || valueCol === '';

  const label = (row, col) => {
    const raw = row[col];
    const s = raw === undefined || raw === null ? '' : String(raw).trim();
    return s === '' ? UNLABELLED : s;
  };

  const byCat = new Map();
  const seriesSeen = new Map();
  let nonNumeric = 0;
  let kept = 0;
  let seq = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const v = counting ? 1 : num(row[valueCol]);
    // Rule 1: a value that will not parse is a row we cannot place, not a zero.
    if (!Number.isFinite(v)) { nonNumeric += 1; continue; }

    const name = label(row, catCol);
    let entry = byCat.get(name);
    if (!entry) {
      entry = { name, value: 0, seq: seq++, parts: new Map() };
      byCat.set(name, entry);
    }
    // Rule 2: the same category twice is one category, twice observed.
    entry.value += v;

    if (seriesCol !== undefined && seriesCol !== null && seriesCol !== '') {
      const sName = label(row, seriesCol);
      entry.parts.set(sName, (entry.parts.get(sName) || 0) + v);
      if (!seriesSeen.has(sName)) seriesSeen.set(sName, seriesSeen.size);
    }
    kept += 1;
  }

  // Every category carries every series, zero-filled, so a grouped bar has the
  // same number of bars in every group and a stack does not silently reorder
  // itself where one series happens to be absent.
  const seriesNames = [...seriesSeen.keys()];
  const data = [...byCat.values()].map((e) => ({
    name: e.name,
    value: e.value,
    seq: e.seq,
    parts: seriesNames.map((s) => ({ name: s, value: e.parts.get(s) || 0 })),
  }));

  const ranked = [...data].sort((a, b) => b.value - a.value);
  const values = data.map((d) => d.value);
  const total = values.reduce((s, v) => s + v, 0);
  const hasNegative = values.some((v) => v < 0);

  return {
    data: ranked,
    stats: {
      // Both orders travel: `data` is ranked, `order` is the table's own.
      order: [...data].sort((a, b) => a.seq - b.seq).map((d) => d.name),
      total,
      categoryCount: data.length,
      categoryName: String(catCol ?? 'category'),
      valueName: counting ? 'rows' : String(valueCol),
      counting,
      // Rule 3 and Rule 4, raised for the form to act on.
      rateLike: !counting && looksLikeRate(valueCol),
      hasNegative,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      biggest: ranked[0] ? { ...ranked[0], share: total > 0 ? ranked[0].value / total : 0 } : null,
      smallest: ranked.length ? ranked[ranked.length - 1] : null,
      topShare: total > 0 && ranked[0] ? ranked[0].value / total : 0,
      // The two largest together — the one comparison a part-to-whole form can
      // make well, so it is worth stating in the dek.
      topTwoShare: total > 0 ? ranked.slice(0, 2).reduce((s, d) => s + d.value, 0) / total : 0,
      seriesNames,
      seriesLabel: seriesCol ? String(seriesCol) : '',
      // The palette request: one colour per series where there is a split, one
      // per category otherwise (a pie colours its own slices).
      seriesCount: Math.max(1, seriesNames.length || data.length),
      rowsKept: kept,
      dropped: { nonNumeric },
    },
  };
}

export const catRoles = {
  category: { types: ['nominal', 'ordinal'], required: true, label: 'Category' },
  value: { types: ['quantitative'], required: false, label: 'Measure (leave empty to count rows)' },
  series: { types: ['nominal', 'ordinal'], required: false, label: 'Split by' },
};

/** What the measure is, said the way the reader bound it. */
export function catMeasure(stats) {
  return stats.counting ? 'rows' : stats.valueName;
}

/** The source line: the form's own claim, then whatever this table cost us. */
export function catNote(stats, formNote) {
  const parts = [formNote];
  if (stats.dropped && stats.dropped.nonNumeric) {
    const n = stats.dropped.nonNumeric;
    parts.push(`${n} ${n === 1 ? 'row had' : 'rows had'} no readable ${stats.valueName} and ${n === 1 ? 'is' : 'are'} `
      + 'not drawn — a blank is not a zero');
  }
  if (stats.rateLike) {
    // The honest version of "we added up your averages".
    parts.push(`"${stats.valueName}" reads as a rate, and rates do not add up — the totals here are sums of it, `
      + 'which may not be a quantity that exists');
  }
  return parts.filter(Boolean).join(' · ');
}

/** Colours keyed by whatever the eye is being asked to compare. */
export function catColors(stats, colors, accent) {
  const names = stats.seriesNames.length ? stats.seriesNames : stats.order;
  return assignColors(names, colors, { accent, star: stats.biggest ? stats.biggest.name : undefined });
}
