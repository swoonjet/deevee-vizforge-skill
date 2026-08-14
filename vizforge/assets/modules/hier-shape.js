// assets/modules/hier-shape.js
//
// ONE SHAPER FOR THE WHOLE HIERARCHY FAMILY.
//
// Treemap, sunburst and circle packing bind the same columns — a group, an item
// inside it, and a size — and all three want the same nested object out of them.
// The time-series family already proved the pattern (ts-shape.js): write the
// shaper once and a new piece is only its draw().
//
// THREE HONESTY RULES LIVE HERE, not in the draws, because all three forms
// encode the value as AREA and an area encoding has no way to show any of them:
//
//   1. A NON-POSITIVE VALUE CANNOT BE AN AREA. Zero has no area and a negative
//      one has no meaning; d3's treemap and pack silently produce overlapping
//      or inverted geometry from them. So they are dropped and COUNTED, and the
//      piece says how many — a partition that quietly omits rows is claiming to
//      be a whole when it is not.
//   2. REPEATED (group, item) PAIRS SUM. Transactional rows are the common
//      case; keeping only the last would shrink the tile to one transaction.
//   3. THE TOTAL MUST BE A REAL TOTAL. Every one of these forms states a whole
//      and divides it, so summing a RATE (a price per unit, an average, a
//      score) makes a total that does not exist. The shaper cannot know for
//      certain, but the column NAME is a strong signal, and `stats.rateLike`
//      carries it through to the source line rather than swallowing it.
//
// The output is a plain nested object rather than a d3 hierarchy: the shaper
// stays free of d3 (it is exercised in Node by the smoke tests) and each draw
// calls d3.hierarchy() on it with the accessor its own layout wants.

import { num } from './d3-piece.js';
import { formatNumber, UNLABELLED, assignColors, looksLikeRate } from './vf-core.js';

/**
 * rows + {levels|parent|child, value} -> {data, stats}
 *
 * `data` is `{name:'', children:[{name, children:[{name, value}]}]}`, always
 * rooted, always the depth the binding asked for.
 */
export function hierShape(rows, bindings = {}) {
  const levels = (Array.isArray(bindings.levels) && bindings.levels.length
    ? bindings.levels
    : [bindings.parent, bindings.child]
  ).filter((c) => c !== undefined && c !== null && c !== '');
  const valueCol = bindings.value;

  const label = (row, col) => {
    const raw = row[col];
    const s = raw === undefined || raw === null ? '' : String(raw).trim();
    return s === '' ? UNLABELLED : s;
  };

  // A nested Map keyed by level, so an arbitrary number of levels costs nothing.
  const root = { name: '', children: new Map(), value: 0 };
  let nonNumeric = 0;
  let nonPositive = 0;
  let kept = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const v = valueCol === undefined ? 1 : num(row[valueCol]);
    if (!Number.isFinite(v)) { nonNumeric += 1; continue; }
    if (v <= 0) { nonPositive += 1; continue; }

    let node = root;
    for (const col of levels) {
      const name = label(row, col);
      if (!node.children.has(name)) node.children.set(name, { name, children: new Map(), value: 0 });
      node = node.children.get(name);
      node.value += v;
    }
    root.value += v;
    kept += 1;
  }

  // Maps -> arrays, biggest first at every level, leaves keeping their value.
  // `seq` remembers the order the names ARRIVED in before the sort, because a
  // cyclical form needs January to follow December and a value sort would put
  // the busiest month first — a rose drawn in rank order is not a cycle.
  const toPlain = (node, depth) => {
    const kids = [...node.children.values()]
      .map((child, i) => ({ ...toPlain(child, depth + 1), seq: i }))
      .sort((a, b) => b.value - a.value);
    return kids.length
      ? { name: node.name, value: node.value, depth, children: kids }
      : { name: node.name, value: node.value, depth };
  };

  const data = toPlain(root, 0);
  const groups = data.children || [];
  const leaves = [];
  const walk = (node, parent) => {
    if (node.children) { for (const k of node.children) walk(k, node); return; }
    leaves.push({ name: node.name, parent: parent ? parent.name : '', value: node.value });
  };
  walk(data, null);
  leaves.sort((a, b) => b.value - a.value);

  const total = data.value || 0;
  const share = (v) => (total > 0 ? v / total : 0);
  const top = groups[0] || null;
  const leaf = leaves[0] || null;
  const topThree = leaves.slice(0, 3).reduce((s, l) => s + l.value, 0);

  return {
    data,
    stats: {
      total,
      levels,
      levelCount: levels.length,
      valueName: valueCol === undefined ? 'rows' : String(valueCol),
      counting: valueCol === undefined,
      rateLike: valueCol !== undefined && looksLikeRate(valueCol),
      groupCount: groups.length,
      leafCount: leaves.length,
      // seriesCount is the harness's palette request — one colour per GROUP,
      // because that is the level the eye is asked to compare.
      seriesCount: Math.max(1, groups.length),
      rowsKept: kept,
      dropped: { nonNumeric, nonPositive },
      biggestGroup: top ? { name: top.name, value: top.value, share: share(top.value) } : null,
      biggestLeaf: leaf ? { ...leaf, share: share(leaf.value) } : null,
      topThreeShare: share(topThree),
      groupNames: groups.map((g) => g.name),
      // The groups in the order the data listed them, for the forms that read
      // as a sequence rather than a ranking.
      groupOrder: [...groups].sort((a, b) => a.seq - b.seq).map((g) => g.name),
    },
  };
}

export const hierRoles = {
  parent: { types: ['nominal', 'ordinal'], required: true, label: 'Group' },
  child: { types: ['nominal', 'ordinal'], required: true, label: 'Item inside the group' },
  value: { types: ['quantitative'], required: true, label: 'Size' },
};

/** The finding, stated: what dominates, and by how much. */
export function hierHeadline(stats) {
  const { biggestGroup, biggestLeaf, total, groupCount, leafCount } = stats;
  const pct = (s) => Math.round(s * 100);
  const amount = stats.counting ? `${formatNumber(total)} rows` : `${formatNumber(total)} total`;
  if (biggestGroup && groupCount > 1) {
    return `${biggestGroup.name} takes ${pct(biggestGroup.share)}% of the ${amount}`;
  }
  if (biggestLeaf) {
    return `${biggestLeaf.name} is the largest of ${leafCount} at ${formatNumber(biggestLeaf.value)}`;
  }
  return 'Nothing left to draw once the non-positive values were removed';
}

export function hierDek(stats, what) {
  const parts = [];
  parts.push(`${stats.leafCount} ${stats.leafCount === 1 ? 'item' : 'items'}`
    + (stats.groupCount > 1 ? ` across ${stats.groupCount} groups` : '')
    + `, ${stats.counting ? `${formatNumber(stats.total)} rows` : formatNumber(stats.total)} in total`);
  if (stats.biggestLeaf && stats.leafCount > 3) {
    parts.push(`the largest three hold ${Math.round(stats.topThreeShare * 100)}% of it`);
  }
  // The harness calls dek(stats, state) — a second argument that is NOT a
  // clause. Printing it produced "[object Object]" in the dek of all three
  // pieces, which no unit test could see and every reader could.
  if (typeof what === 'string' && what) parts.push(what);
  return `${parts.join(' — ')}.`;
}

/**
 * The disclosures every hierarchy piece owes its reader, appended to whatever
 * the form's own honesty note says.
 *
 * Written here rather than in three draws because forgetting one of them in one
 * piece is exactly the failure that makes a library untrustworthy.
 */
export function hierNote(stats, formNote) {
  const parts = [formNote];
  const { nonPositive, nonNumeric } = stats.dropped;
  if (nonPositive) {
    parts.push(`${nonPositive} ${nonPositive === 1 ? 'row was' : 'rows were'} zero or negative and could not be `
      + `drawn as an area, so ${nonPositive === 1 ? 'it is' : 'they are'} not in the total`);
  }
  if (nonNumeric) {
    parts.push(`${nonNumeric} ${nonNumeric === 1 ? 'row had' : 'rows had'} no readable value`);
  }
  if (stats.rateLike) {
    parts.push(`"${stats.valueName}" reads like a rate rather than an amount — this form adds the values up to `
      + 'make the whole, and rates do not add up');
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * Group name -> colour. Every piece in the family colours BY GROUP, and the
 * three of them must agree or the same table reads as three unrelated charts.
 *
 * WHY THE SWAP. The house ramp deliberately contains the accent hue (Flarepop
 * sits at --vf-cat-3, so a third series can be told apart), and these forms use
 * the accent a SECOND time to mark the group the headline names. With seven
 * groups that puts the same magenta on the finding and on whichever group
 * happens to land third, which is two peaks and no emphasis. So when the ramp
 * really does contain the accent, that entry is given to the STAR — "Flarepop
 * where the story peaks", the gallery's own law — and the group that would have
 * had it takes the star's colour instead. When the ramp does not contain the
 * accent, nothing moves.
 */
export function groupColors(stats, colors, opts = {}) {
  return assignColors(stats.groupNames, colors, opts);
}

/** One group's colour out of that map, with a safe fallback. */
export function colorOf(map, colors, name) {
  return map.get(name) || colors[0];
}

/** Value + its share of a stated whole, the phrasing all three tooltips use. */
export function shareOf(value, whole) {
  if (!(whole > 0)) return formatNumber(value);
  return `${formatNumber(value)} · ${((value / whole) * 100).toFixed(value / whole < 0.1 ? 1 : 0)}%`;
}
