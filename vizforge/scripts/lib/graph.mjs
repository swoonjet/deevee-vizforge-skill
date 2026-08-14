// scripts/lib/graph.mjs
//
// BIND-01/04 (Phase 7 Plan 05) -- the shared REAL cycle detector for
// arbitrary `edges`-shape data (sankey-alluvial today; chord reuses this in
// wave 3). This is deliberately NOT `scripts/profile.mjs`'s own `hasCycle()`:
// that function is a 2-cycle-only check ("for every unordered pair (A,B),
// A->B>0 AND B->A>0") that is correct and sufficient for profile.mjs's own
// job (a cheap `shape.hasCycles` heuristic used only to flag a dataset as
// flow-shaped during profiling) but WOULD SILENTLY MISS a longer cycle like
// A->B->C->A -- a real 3-node loop with no reciprocal pair anywhere in it.
// Feeding a graph like that to d3-sankey (which has no cycle-breaking logic
// of its own, 03-RESEARCH.md Pitfall 2) produces broken/undefined layout
// behavior, not a graceful failure. `detectCycle()` here is a genuine
// 3-color (white/gray/black) DFS with a recursion stack, correct for a cycle
// of ANY length, and is what `scripts/shapers/sankey-alluvial.mjs`'s
// `validate()` calls BEFORE a derived graph is ever handed to d3-sankey.

const WHITE = 0; // unvisited
const GRAY = 1; // on the current DFS recursion stack (an ancestor of the node being explored)
const BLACK = 2; // fully explored -- every descendant has already been visited

/**
 * detectCycle(nodes, edges) -> { hasCycle: false } | { hasCycle: true, path: string[] }
 *
 * @param {Array} nodes - the node SET, as an array of names (or any other
 *   identifier). Array position is each node's implicit index.
 * @param {Array<{source, target}>} edges - each edge's `source`/`target` may
 *   be either a value present in `nodes` (matched by `===`) OR a valid
 *   integer index into `nodes` (matched positionally). An edge endpoint that
 *   resolves to neither is defensively ignored (never thrown) -- callers are
 *   expected to have already validated their own node/edge derivation; this
 *   function's only job is cycle detection over whatever graph it's given.
 * @returns {{hasCycle: boolean, path?: Array}} `path` (only present when
 *   `hasCycle` is true) names the cycle as the sequence of nodes traversed,
 *   starting and ending on the same (repeated) node -- e.g. `['A','B','C','A']`
 *   for a 3-node cycle A->B->C->A.
 */
export function detectCycle(nodes, edges) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  const indexOf = new Map();
  nodeList.forEach((n, i) => {
    if (!indexOf.has(n)) indexOf.set(n, i);
  });

  function resolveIndex(ref) {
    if (indexOf.has(ref)) return indexOf.get(ref);
    if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < nodeList.length) return ref;
    return -1;
  }

  const adjacency = nodeList.map(() => []);
  for (const edge of edgeList) {
    if (!edge) continue;
    const s = resolveIndex(edge.source);
    const t = resolveIndex(edge.target);
    if (s === -1 || t === -1) continue;
    adjacency[s].push(t);
  }

  const color = new Array(nodeList.length).fill(WHITE);
  const stack = []; // recursion-stack indices, in traversal order
  let cyclePath = null;

  function dfs(u) {
    color[u] = GRAY;
    stack.push(u);
    for (const v of adjacency[u]) {
      if (color[v] === GRAY) {
        const backIdx = stack.indexOf(v);
        cyclePath = stack.slice(backIdx).concat(v).map((i) => nodeList[i]);
        return true;
      }
      if (color[v] === WHITE && dfs(v)) {
        return true;
      }
    }
    stack.pop();
    color[u] = BLACK;
    return false;
  }

  for (let i = 0; i < nodeList.length; i++) {
    if (color[i] === WHITE && dfs(i)) {
      return { hasCycle: true, path: cyclePath };
    }
  }

  return { hasCycle: false };
}
