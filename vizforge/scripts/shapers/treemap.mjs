// scripts/shapers/treemap.mjs
//
// HIER-01 (Phase 21 Plan 01) -- the treemap technique's shaper. Consumes the
// nested US-budget hierarchy tree DIRECTLY, never a flat row table: this
// fragment's `dataBinding.shape` is "tree" with an EMPTY `roles: []` (see
// scripts/profile.mjs's json-object branch, added alongside this plan for
// HIER-02) -- a tree's JSON root ({name, children:[...]}) is profiled as
// `rows: [thatRootObject]` (object references, never stringified), so
// `rows[0]` IS the whole parsed tree here and the generic per-column
// validateBinding() is a no-op (zero declared roles) and never blocks this
// path.
//
// d3.hierarchy(tree).sum(leafValue).sort(...) with an EXPLICIT comparator
// (never left to insertion/object-key order) makes the squarified tiling
// deterministic across runs -- required for SC2 (byte-identical --deep
// double-render) and this file's own determinism test.
// d3.treemap().tile(d3.treemapSquarify) allocates leaf-rectangle AREA
// (width*height) exactly proportional to value -- the one honest 2D-area
// encoding this atlas family teaches by example (no radius=value trap;
// scripts/qa/checks/area-encoding.check.mjs stays inert-PASS for this
// technique since the fragment/meta declare encoding.channel:'area' with NO
// encoding.areaMark:'radius' -- rect area is honest by w*h construction,
// never a radius-based mark).
//
// Categorical hue is capped at the house's 6-hue categorical token set
// (assets/tokens.css --cat-1..--cat-6): the top-6 departments BY TOTAL VALUE
// get a distinct hue; this dataset has 8 departments, so the remaining 2 are
// INKED -- rendered in a shared neutral tone, never a fabricated 7th+ hue.
// Area still encodes every leaf's real value regardless of hue bucket; only
// the distinct-hue channel is capped, never the honest area channel.

import { hierarchy, treemap, treemapSquarify } from 'd3';

export const WIDTH = 1120;
export const HEIGHT = 560;
const PADDING = 2;
const MAX_HUES = 6;

function collectLeafValues(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (const child of node.children) collectLeafValues(child, out);
  } else if (node.value !== undefined) {
    out.push(node.value);
  }
}

/**
 * shape(rows, bindings) -> {width, height, leaves, branches, stats}
 *
 * `rows[0]` is the entire parsed nested tree (see file header); `bindings`
 * is unused (this fragment's `dataBinding.roles` is `[]` -- there is no
 * per-column binding to make for a whole-tree channel). Runs
 * d3.hierarchy().sum().sort() with an explicit comparator, then a
 * squarified d3.treemap() sized to [WIDTH,HEIGHT] with uniform padding.
 * Returns LEAF nodes only (bureaus), each carrying its top-level department
 * (`branch`) and a capped hue key (`colorKey`) -- department rank beyond the
 * top MAX_HUES is inked (`colorKey: 'ink'`), never a fabricated 7th+ hue.
 */
export function shape(rows, bindings) {
  const root = rows && rows[0];

  const rootNode = hierarchy(root)
    .sum((d) => (Array.isArray(d.children) && d.children.length > 0 ? 0 : Number(d.value) || 0))
    .sort((a, b) => b.value - a.value);

  const branchNodes = (rootNode.children || []).slice();
  const branchesByTotalDesc = [...branchNodes].sort((a, b) => b.value - a.value);
  const colorKeyByBranchName = new Map();
  branchesByTotalDesc.forEach((node, i) => {
    colorKeyByBranchName.set(node.data.name, i < MAX_HUES ? `cat-${i + 1}` : 'ink');
  });

  const layout = treemap()
    .tile(treemapSquarify)
    .size([WIDTH, HEIGHT])
    .paddingInner(PADDING)
    .paddingOuter(PADDING);
  layout(rootNode);

  const leaves = rootNode.leaves().map((leaf) => {
    const branchNode = leaf.ancestors().find((a) => a.depth === 1) || leaf;
    const branchName = branchNode.data.name;
    return {
      name: leaf.data.name,
      value: leaf.value,
      branch: branchName,
      colorKey: colorKeyByBranchName.get(branchName) || 'ink',
      x0: leaf.x0,
      y0: leaf.y0,
      x1: leaf.x1,
      y1: leaf.y1,
    };
  });

  const totalValue = rootNode.value;
  const byValueDesc = [...leaves].sort((a, b) => b.value - a.value);
  const top = byValueDesc[0];

  const branches = branchesByTotalDesc.map((node) => ({
    name: node.data.name,
    value: node.value,
    colorKey: colorKeyByBranchName.get(node.data.name),
  }));

  return {
    width: WIDTH,
    height: HEIGHT,
    leaves,
    branches,
    stats: {
      totalValue,
      leafCount: leaves.length,
      branchCount: branches.length,
      hueCount: Math.min(branches.length, MAX_HUES),
      topName: top ? top.name : null,
      topBranch: top ? top.branch : null,
      topValue: top ? top.value : null,
      topShare: top && totalValue ? top.value / totalValue : null,
    },
  };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - rejects a bound row that isn't a nested tree object (no `children` array)
 * - rejects any negative leaf value -- a treemap's area=value mapping is
 *   undefined for a negative area
 * - rejects a tree with fewer than 2 leaves (nothing to compare)
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const root = rows && rows[0];
  const problems = [];

  if (!root || typeof root !== 'object' || !Array.isArray(root.children)) {
    problems.push({
      channel: 'tree',
      problem: "channel 'tree': bound row is not a nested tree object with a 'children' array",
      remedy: "bind a dataset whose JSON top level is a single {name, children:[...]} object",
    });
    return problems;
  }

  const values = [];
  collectLeafValues(root, values);

  const negativeCount = values.filter((v) => Number(v) < 0).length;
  if (negativeCount > 0) {
    problems.push({
      channel: 'tree',
      problem: `channel 'tree': ${negativeCount} negative leaf value(s) found -- a treemap's area=value mapping is undefined for a negative area`,
      remedy: 'bind a tree whose leaf values are all non-negative',
    });
  }

  if (values.length < 2) {
    problems.push({
      channel: 'tree',
      problem: `channel 'tree': only ${values.length} leaf value(s) found -- a treemap needs at least 2 leaves to compare`,
      remedy: 'bind a tree with at least 2 leaves',
    });
  }

  return problems;
}
