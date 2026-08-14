// scripts/shapers/chord.mjs
//
// BIND-01/02/04 (Phase 7 Plan 12) -- chord's shaper. Reuses
// sankey-alluvial's `edges` input contract (source/target/value) but
// declares `pivotTo:"matrix"` (07-RESEARCH.md worked example): the shaper
// pivots the edge list into a SQUARE matrix -- duplicate (source,target)
// pairs aggregated (sum), every missing pair zero-filled, the diagonal
// ALWAYS zeroed (self-flow is never assumed meaningful for arbitrary data --
// even an input edge list that explicitly carries a self-pair is still
// zeroed, matching the shipped scaffold's own explicit diagonal-zeroing).
// The node/label union is the sorted set of distinct source+target values --
// the SAME derivation pattern as scripts/shapers/sankey-alluvial.mjs's
// buildGraph() (chord does NOT reuse scripts/lib/graph.mjs's detectCycle():
// an arbitrary directed matrix is fine for d3.chordDirected(), unlike
// d3-sankey's acyclic-flow precondition).
//
// validate() enforces the node ceiling (distinct(source∪target) <=
// contract.seriesLimits.maxCategories) BEFORE shape() ever pivots --
// truncating nodes AFTER pivoting would distort every remaining cell's
// proportion (dropped flows would silently vanish instead of changing the
// visible total), so the ceiling is a hard precondition, never a post-hoc
// truncation.

function boundColumn(bindings, role) {
  const raw = bindings ? bindings[role] : undefined;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function resolvedValueAggregation(bindings) {
  const agg = bindings && bindings.aggregation ? bindings.aggregation.value : undefined;
  return agg || 'count'; // matches this fragment's own dataBinding.roles[value].defaultAggregation
}

const PAIR_SEP = '␟'; // a control-picture separator that can never appear in a real column value

/**
 * buildEdges(rows, bindings) -> { nodeNames: string[], pairValues: Map<string, number> }
 *
 * Derives the node SET as the sorted union of distinct source+target values
 * and aggregates duplicate (source,target) pairs -- shared by shape() and
 * validate() so both see EXACTLY the same derived node set.
 */
function buildEdges(rows, bindings) {
  const sourceCol = boundColumn(bindings, 'source');
  const targetCol = boundColumn(bindings, 'target');
  const valueCol = boundColumn(bindings, 'value');
  const aggregation = resolvedValueAggregation(bindings);

  const nodeSet = new Set();
  const pairValues = new Map();

  for (const row of rows || []) {
    if (!row) continue;
    const rawSource = sourceCol ? row[sourceCol] : undefined;
    const rawTarget = targetCol ? row[targetCol] : undefined;
    if (rawSource === undefined || rawSource === null || String(rawSource).trim() === '') continue;
    if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') continue;

    const sourceName = String(rawSource);
    const targetName = String(rawTarget);
    nodeSet.add(sourceName);
    nodeSet.add(targetName);

    const key = sourceName + PAIR_SEP + targetName;
    let amount = 1;
    if (aggregation === 'sum' && valueCol) {
      amount = isCoercibleNumber(row[valueCol]) ? Number(row[valueCol]) : 0;
    }
    pairValues.set(key, (pairValues.get(key) || 0) + amount);
  }

  const nodeNames = Array.from(nodeSet).sort();
  return { nodeNames, pairValues };
}

/**
 * shape(rows, bindings) -> {matrix:number[][], labels:string[],
 * stats:{nodeCount,pairCount,topPairFrom,topPairTo,topPairValue,
 * ratioToMedian}}
 *
 * `matrix[i][j]` is the aggregated flow from `labels[i]` to `labels[j]` --
 * exactly d3.chordDirected()'s own matrix input shape. The diagonal
 * (`matrix[i][i]`) is ALWAYS 0, regardless of what the bound edge list
 * contains for a self-pair.
 */
export function shape(rows, bindings) {
  const { nodeNames, pairValues } = buildEdges(rows, bindings);
  const n = nodeNames.length;
  const indexOf = new Map(nodeNames.map((name, i) => [name, i]));

  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs = [];

  pairValues.forEach((value, key) => {
    const sepIdx = key.indexOf(PAIR_SEP);
    const sourceName = key.slice(0, sepIdx);
    const targetName = key.slice(sepIdx + PAIR_SEP.length);
    const i = indexOf.get(sourceName);
    const j = indexOf.get(targetName);
    if (i === j) return; // diagonal ALWAYS zero -- self-flow never assumed meaningful
    matrix[i][j] = value;
    if (value > 0) pairs.push({ from: i, to: j, value });
  });

  pairs.sort((a, b) => b.value - a.value);
  const topPair = pairs.length > 0 ? pairs[0] : null;
  const medianValue = pairs.length > 0 ? pairs[Math.floor(pairs.length / 2)].value : null;

  const stats = {
    nodeCount: n,
    pairCount: pairs.length,
    topPairFrom: topPair ? nodeNames[topPair.from] : null,
    topPairTo: topPair ? nodeNames[topPair.to] : null,
    topPairValue: topPair ? topPair.value : null,
    ratioToMedian: topPair && medianValue ? topPair.value / medianValue : null,
  };

  return { matrix, labels: nodeNames, stats };
}

/**
 * validate(rows, bindings, {contract}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 distinct nodes -> a directed matrix needs at least 2
 *   rows/columns to show any flow.
 * - more than `contract.seriesLimits.maxCategories` distinct nodes (when
 *   present on the passed contract) -> named {channel:'source/target'}
 *   error naming the count (BIND-04), checked BEFORE shape() ever pivots --
 *   see the top-of-file note on why this is a hard precondition, never a
 *   post-pivot truncation. Mirrors bar.mjs/bump.mjs/streamgraph.mjs's own
 *   contract.seriesLimits convention -- the framework's demo/regeneration
 *   path passes `contract:fragment.dataBinding` only; a caller that also
 *   wants the ceiling enforced merges in `fragment.seriesLimits` itself,
 *   see this plan's proof test.
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const { nodeNames } = buildEdges(rows, bindings);

  if (nodeNames.length < 2) {
    errors.push({
      channel: 'source',
      problem: `a directed matrix needs at least 2 distinct nodes, found ${nodeNames.length}`,
      remedy: 'bind source/target columns whose values span at least 2 distinct names',
    });
  }

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (maxCategories !== undefined && nodeNames.length > maxCategories) {
    errors.push({
      channel: 'source/target',
      problem: `channel 'source/target': ${nodeNames.length} distinct nodes exceeds the maximum of ${maxCategories} for a directed matrix -- enforced BEFORE pivoting to a matrix (truncating afterward would distort every remaining cell's proportion)`,
      remedy: `bind source/target to columns spanning ${maxCategories} or fewer distinct node names`,
    });
  }

  return errors;
}
