// scripts/shapers/sunburst.mjs
//
// HIER-02 (Phase 21 Plan 02) -- the radial-hierarchy (sunburst) technique's
// shaper. Consumes a NESTED JSON TREE directly (never a flat table/edges
// list, unlike every other shaper in this project) -- data/us_budget_hierarchy.json's
// shape is `{name, children:[{name, children:[...]}, ...]}` with `value` only
// on leaves. scripts/profile.mjs wraps a genuine tree root as a single-element
// `rows` array (`rows: [treeRoot]`, additive JSON-branch support added
// alongside this shaper) precisely so `shape([treeRoot], bindings)` can pull
// `rows[0]` straight through to `d3.hierarchy()` -- this file's own contract
// mirrors every other shaper's `shape(rows, bindings)` / `validate(rows,
// bindings, {contract, profile})` signature even though `bindings` itself is
// unused (a hierarchy's entire nested structure IS the binding; there is no
// per-column table to select roles from).
//
// HONESTY (21-CONTEXT.md, 21-02-PLAN.md): d3.partition()'s radial (y)
// dimension is DEPTH-based by construction -- every node spans EXACTLY
// [depth, depth+1] in y before the scaffold maps that to pixels, so ring
// thickness is constant BY CONSTRUCTION, never proportional to value. The
// angular (x) dimension is the ONLY quantitative channel: `sum()` makes a
// parent's angular extent the sum of its children's, so a node's angular
// extent is proportional to value/parentValue -- angle-of-arc = value. The
// well-known sunburst caveat (equal angular value sweeps a LARGER pixel area
// at an outer/wider ring than an inner one) is real but purely a function of
// polar geometry at constant angle, not of this encoding -- it is disclosed
// verbatim in the rendered piece (scaffolds/src/sunburst.src.html) and in
// skill/references/atlas/tier-2/sunburst.md, never mechanically suppressed.
//
// `.sort((a,b) => b.value - a.value)` is applied for deterministic, stable
// layout (largest wedge first, clockwise from 12 o'clock) -- identical
// rows+bindings in, identical angles out.

import * as d3 from 'd3';

function isTreeNode(node) {
  return !!node && typeof node === 'object' && Array.isArray(node.children);
}

// Recursively collects every leaf `value` in the raw (unhierarchized) tree,
// for validate()'s negative-value scan -- runs BEFORE d3.hierarchy() ever
// touches the data, so a malformed tree can be rejected without throwing
// inside d3 itself.
function collectLeafValues(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (const child of node.children) collectLeafValues(child, out);
    return;
  }
  if (node.value !== undefined) out.push(node.value);
}

/**
 * shape(rows, bindings) -> {
 *   data: [{ id, name, depth, branch, value, x0, x1, y0, y1 }],
 *   stats: { totalValue, maxDepth, topBranchName, topBranchValue,
 *            topLeafName, topLeafValue, leafCount, branchCount }
 * }
 *
 * `rows` is profile.mjs's wrapped `[treeRoot]` (see this file's header) --
 * `rows[0]` is the actual nested tree. `bindings` is accepted for contract
 * symmetry with every other shaper but unused: a tree has no bindable
 * per-column roles.
 *
 * d3.hierarchy(tree).sum(d => d.value ?? 0) aggregates every ancestor's
 * value as the sum of its descendants' leaf values (department totals are
 * NEVER read from a hand-entered field -- always computed from the real
 * bureau leaves, so a department total can never silently drift from its
 * own children). `.sort((a,b) => b.value - a.value)` orders siblings
 * largest-first for a deterministic, stable layout.
 *
 * d3.partition().size([2*Math.PI, root.height + 1]) gives every node a
 * y-span of EXACTLY 1 (constant ring thickness by construction, per this
 * file's header) and an x-span (x1 - x0) proportional to value/parentValue
 * (angle-of-arc = value, the sole quantitative channel).
 */
export function shape(rows, bindings) {
  const tree = rows && rows[0];

  const root = d3
    .hierarchy(tree)
    .sum((d) => (typeof d.value === 'number' ? d.value : 0))
    .sort((a, b) => b.value - a.value);

  d3.partition().size([2 * Math.PI, root.height + 1])(root);

  const nodes = root.descendants().map((d) => {
    const branch = d.depth === 0 ? null : d.depth === 1 ? d.data.name : d.ancestors().find((a) => a.depth === 1).data.name;
    return {
      id: d.ancestors().reverse().map((a) => a.data.name).join(' / '),
      name: d.data.name,
      depth: d.depth,
      branch,
      value: d.value,
      x0: d.x0,
      x1: d.x1,
      y0: d.y0,
      y1: d.y1,
    };
  });

  const leaves = root.leaves();
  const branches = root.children || [];
  const topBranch = [...branches].sort((a, b) => b.value - a.value)[0];
  const topLeaf = [...leaves].sort((a, b) => b.value - a.value)[0];

  const stats = {
    totalValue: root.value,
    maxDepth: root.height,
    topBranchName: topBranch ? topBranch.data.name : null,
    topBranchValue: topBranch ? topBranch.value : null,
    topLeafName: topLeaf ? topLeaf.data.name : null,
    topLeafValue: topLeaf ? topLeaf.value : null,
    leafCount: leaves.length,
    branchCount: branches.length,
  };

  return { data: nodes, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - `rows[0]` must be a genuine tree node ({children: [...]}) -- a missing
 *   or malformed tree is rejected before d3.hierarchy() ever runs.
 * - any negative leaf `value` is rejected -- a part-to-whole radial
 *   encoding cannot represent a negative angular sweep; a negative value
 *   signals the wrong column/dataset was bound.
 * - fewer than 2 top-level branches: rejected (a sunburst needs at least 2
 *   department-level wedges to compare).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const tree = rows && rows[0];

  if (!isTreeNode(tree)) {
    return [
      {
        channel: 'tree',
        problem: `channel 'tree': expected a nested tree object ({name, children:[...]}) but got ${JSON.stringify(tree)}`,
        remedy: 'bind a nested JSON tree dataset (e.g. data/us_budget_hierarchy.json)',
      },
    ];
  }

  const leafValues = [];
  collectLeafValues(tree, leafValues);
  const negativeCount = leafValues.filter((v) => typeof v === 'number' && v < 0).length;

  const problems = [];

  if (negativeCount > 0) {
    problems.push({
      channel: 'value',
      problem: `channel 'value': ${negativeCount} negative leaf value(s) found -- a part-to-whole radial encoding cannot represent a negative angular sweep`,
      remedy: 'bind a tree whose leaf values are all non-negative',
    });
  }

  const branchCount = Array.isArray(tree.children) ? tree.children.length : 0;
  if (branchCount < 2) {
    problems.push({
      channel: 'tree',
      problem: `channel 'tree': only ${branchCount} top-level branch(es) found -- a sunburst needs at least 2 to compare`,
      remedy: 'bind a tree with at least 2 top-level children',
    });
  }

  return problems;
}
