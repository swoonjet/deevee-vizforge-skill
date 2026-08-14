// scripts/shapers/adjacency-matrix.mjs
//
// NET-02 (Phase 22 Plan 02) -- the `graph`-shape shaper for adjacency-matrix:
// turns the Les Misérables co-appearance graph ({nodes:[{id,group}],
// links:[{source,target,value}]}, data/lesmiserables.json) into a fully
// SERIATED, SYMMETRIC weighted matrix. This is the determinism-free dense
// network form -- no force layout, no randomness of any kind, just one
// disclosed stable sort deciding row/column order.
//
// SERIATION (the ordering this technique discloses verbatim in its rendered
// piece, scaffolds/adjacency-matrix.meta.json's meta.network.orderingDisclosure):
// nodes are ordered by (1) `group` ascending, (2) weighted degree (the sum of
// `value` over every incident link) descending, (3) `id` ascending as the
// final deterministic tiebreak. Grouping first surfaces each community's
// members as a contiguous block of rows/columns; sorting each block by
// descending weighted degree puts a block's most-connected member first,
// closest to the diagonal's "hub" corner -- together this is what makes
// community blocks read along the diagonal without any layout algorithm.
//
// SHAPE OF THE INPUT ROOT this module accepts (see this file's `shape`/
// `validate` JSDoc): either the raw parsed graph object directly (`{nodes,
// links}` -- how scripts/tests exercise this module and how the plan's own
// automated verify command calls it), OR that same object wrapped in a
// single-element array (`[graphRoot]` -- how scripts/profile.mjs's graph-JSON
// branch hands data through scripts/bind-data.mjs's generic `rows` parameter,
// mirroring the tree-shape convention treemap/sunburst/circle-packing already
// use for their own single-root JSON documents). `normalizeRoot()` below
// accepts both without caring which path called it.
//
// The graph is UNDIRECTED (Bostock's classic Les Misérables dataset has no
// direction to source/target): every link becomes TWO cells, {row,col} and
// its mirror {col,row}, both carrying the same weight -- never a single
// half-filled triangle.

/**
 * normalizeRoot(data) -> { nodes, links } | null
 *
 * Accepts either the raw graph object or a single-element array wrapping it
 * (see file header). Returns null when neither shape is present so callers
 * can report a structured validation problem instead of throwing.
 */
function normalizeRoot(data) {
  const root = Array.isArray(data) ? data[0] : data;
  if (!root || typeof root !== 'object') return null;
  if (!Array.isArray(root.nodes) || !Array.isArray(root.links)) return null;
  return { nodes: root.nodes, links: root.links };
}

/**
 * weightedDegrees(nodes, links) -> Map<id, number>
 *
 * Sum of `value` (defaulting missing/non-numeric values to 0, never NaN)
 * over every link incident to a node, in EITHER direction -- shared by the
 * seriation sort and the shaped `nodes[].degree` field so both report
 * exactly the same number.
 */
function weightedDegrees(nodes, links) {
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const link of links) {
    const raw = Number(link.value);
    const value = Number.isFinite(raw) ? raw : 0;
    if (degree.has(link.source)) degree.set(link.source, degree.get(link.source) + value);
    if (degree.has(link.target)) degree.set(link.target, degree.get(link.target) + value);
  }
  return degree;
}

/**
 * seriate(nodes, degree) -> nodes sorted by (group asc, degree desc, id asc)
 *
 * The ONE disclosed ordering shared by rows and columns alike. Pure
 * comparator, no randomness -- Array.prototype.sort with a fully-specified
 * total order (every tie broken by `id`) is deterministic across engines and
 * across repeated calls on the same input.
 */
function seriate(nodes, degree) {
  return nodes.slice().sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    const da = degree.get(a.id) || 0;
    const db = degree.get(b.id) || 0;
    if (db !== da) return db - da;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * shape(data, bindings) -> { order, nodes, cells, n, maxWeight, stats }
 *
 * `order`: seriated node ids, row/col index i === order.indexOf(id).
 * `nodes`: seriated node records `{id, group, order, degree}`.
 * `cells`: sparse list `{row, col, weight}` for every non-zero pair, BOTH
 *   mirrors of every link (length === 2 * links.length, always -- a rare
 *   self-loop link, e.g. this dataset's Myriel->Myriel, mirrors onto its own
 *   diagonal cell twice, an intentionally harmless duplicate rather than a
 *   special case that would make cell count depend on self-loop presence)
 *   -- empty pairs are simply absent, never a zero-weight entry, so the
 *   renderer can leave them blank/paper without a lookup.
 * `maxWeight`: the largest single cell weight, the sequential colour scale's
 *   domain ceiling.
 *
 * Pure function of `data`/`bindings` -- no Date, no Math.random, no mutation
 * of the input. Two calls on the same input produce byte-identical JSON.
 */
export function shape(data) {
  const root = normalizeRoot(data);
  if (!root) {
    return { order: [], nodes: [], cells: [], n: 0, maxWeight: 0, stats: { nodeCount: 0, linkCount: 0 } };
  }
  const { nodes, links } = root;
  const degree = weightedDegrees(nodes, links);
  const seriated = seriate(nodes, degree);
  const orderOf = new Map(seriated.map((n, i) => [n.id, i]));

  const cells = [];
  let maxWeight = 0;
  for (const link of links) {
    const raw = Number(link.value);
    const weight = Number.isFinite(raw) ? raw : 0;
    const r = orderOf.get(link.source);
    const c = orderOf.get(link.target);
    if (r === undefined || c === undefined) continue;
    cells.push({ row: r, col: c, weight });
    cells.push({ row: c, col: r, weight });
    if (weight > maxWeight) maxWeight = weight;
  }

  const outNodes = seriated.map((n, i) => ({
    id: n.id,
    group: n.group,
    order: i,
    degree: degree.get(n.id) || 0,
  }));

  return {
    order: seriated.map((n) => n.id),
    nodes: outNodes,
    cells,
    n: seriated.length,
    maxWeight,
    stats: { nodeCount: seriated.length, linkCount: links.length },
  };
}

/**
 * validate(data, bindings) -> Array<{channel, problem, remedy}>
 *
 * []: normal. Structured problems for: fewer than 2 distinct nodes (a
 * matrix needs at least a 2x2 grid to mean anything), or any link whose
 * source/target references a node id absent from the node set.
 */
export function validate(data) {
  const root = normalizeRoot(data);
  if (!root) {
    return [
      {
        channel: 'nodes',
        problem: 'expected a graph object ({nodes:[...], links:[...]}) or a single-element array wrapping one',
        remedy: 'bind a dataset shaped like data/lesmiserables.json',
      },
    ];
  }
  const { nodes, links } = root;
  const problems = [];

  if (nodes.length < 2) {
    problems.push({
      channel: 'nodes',
      problem: `an adjacency matrix needs at least 2 distinct nodes, found ${nodes.length}`,
      remedy: 'bind a graph dataset with at least 2 distinct node ids',
    });
    return problems;
  }

  const ids = new Set(nodes.map((n) => n.id));
  const unknown = new Set();
  for (const link of links) {
    if (!ids.has(link.source)) unknown.add(link.source);
    if (!ids.has(link.target)) unknown.add(link.target);
  }
  if (unknown.size > 0) {
    problems.push({
      channel: 'links',
      problem: `link(s) reference unknown node id(s): ${[...unknown].sort().join(', ')}`,
      remedy: 'ensure every link source/target matches a node id present in the graph',
    });
  }

  return problems;
}
