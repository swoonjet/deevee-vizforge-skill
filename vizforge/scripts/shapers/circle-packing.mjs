// scripts/shapers/circle-packing.mjs
//
// HIER-03 (Phase 21 Plan 03) -- the circle-packing technique's shaper.
// Consumes a NESTED JSON TREE directly (mirrors scripts/shapers/sunburst.mjs,
// 21-02) -- data/us_budget_hierarchy.json's shape is
// `{name, children:[{name, children:[...]}, ...]}` with `value` only on
// leaves. scripts/profile.mjs wraps a genuine tree root as a single-element
// `rows` array (`rows: [treeRoot]`, additive JSON-branch support landed
// alongside 21-02's sunburst shaper) precisely so `shape([treeRoot],
// bindings)` can pull `rows[0]` straight through to `d3.hierarchy()`. This
// file's own contract mirrors every other shaper's `shape(rows, bindings)` /
// `validate(rows, bindings, {contract, profile})` signature even though
// `bindings` itself is unused (a hierarchy's entire nested structure IS the
// binding; there is no per-column table to select roles from).
//
// HONESTY (21-CONTEXT.md, 21-03-PLAN.md) -- THE LOAD-BEARING PROPERTY:
// d3.pack() sizes every circle so its AREA (pi*r^2) is proportional to its
// subtree's summed value -- i.e. radius = sqrt(value), NEVER radius = value
// directly (which would double the perceived magnitude of differences; see
// scripts/qa/checks/area-encoding.check.mjs, 19-03). This shaper's job is
// only to preserve that property through a deterministic, explicit-sort
// layout (`.sort((a,b) => b.value - a.value)`, largest circle first) --
// never to compute radius by any other formula. Every descendant (both leaf
// bureaus and department branches) is returned so the scaffold can render
// the full nested-circle picture; `branch` names the top-level department a
// node belongs to (itself, for a department node) for hue mapping.

import * as d3 from 'd3';

const WIDTH = 1100;
const HEIGHT = 620;
const PADDING = 3;

function isTreeNode(node) {
  return !!node && typeof node === 'object' && Array.isArray(node.children);
}

// Recursively collects every leaf `value` in the raw (unhierarchized) tree,
// for validate()'s negative-value scan -- runs BEFORE d3.hierarchy() ever
// touches the data, so a malformed tree can be rejected without throwing
// inside d3 itself (a negative subtree sum would otherwise surface as a
// NaN/undefined radius deep inside d3.pack, not a clear structured error).
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
 *   data: [{ name, depth, branch, value, x, y, r }],
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
 * bureau leaves). `.sort((a,b) => b.value - a.value)` orders siblings
 * largest-first for a deterministic, stable layout. `d3.pack().size([WIDTH,
 * HEIGHT]).padding(PADDING)` then sizes every node's radius so AREA is
 * proportional to its (summed) value -- the honest area encoding this
 * technique exists to demonstrate.
 */
export function shape(rows, bindings) {
  const tree = rows && rows[0];

  const root = d3
    .hierarchy(tree)
    .sum((d) => (typeof d.value === 'number' ? d.value : 0))
    .sort((a, b) => b.value - a.value);

  d3.pack().size([WIDTH, HEIGHT]).padding(PADDING)(root);

  const nodes = root.descendants().filter((d) => d.depth > 0);

  const data = nodes.map((d) => ({
    name: d.data.name,
    depth: d.depth,
    branch: d.depth === 1 ? d.data.name : d.ancestors().find((a) => a.depth === 1).data.name,
    value: d.value,
    x: d.x,
    y: d.y,
    r: d.r,
  }));

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

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - `rows[0]` must be a genuine tree node ({children: [...]}) -- a missing
 *   or malformed tree is rejected before d3.hierarchy()/d3.pack() ever runs.
 * - any negative leaf `value` is rejected -- d3.pack's radius = sqrt(value)
 *   is undefined for a negative subtree sum; a negative value signals the
 *   wrong column/dataset was bound.
 * - fewer than 2 top-level branches: rejected (a circle-packing view needs
 *   at least 2 department-level circles to show nesting).
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
      problem: `channel 'value': ${negativeCount} negative leaf value(s) found -- a circle-pack area encoding (radius = sqrt(value)) is undefined for a negative value`,
      remedy: 'bind a tree whose leaf values are all non-negative',
    });
  }

  const branchCount = Array.isArray(tree.children) ? tree.children.length : 0;
  if (branchCount < 2) {
    problems.push({
      channel: 'tree',
      problem: `channel 'tree': only ${branchCount} top-level branch(es) found -- a circle-packing view needs at least 2 to compare`,
      remedy: 'bind a tree with at least 2 top-level children',
    });
  }

  return problems;
}
