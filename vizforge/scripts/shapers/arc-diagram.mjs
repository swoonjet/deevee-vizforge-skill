// scripts/shapers/arc-diagram.mjs
//
// NET-01 (Phase 22 Plan 01) -- the arc-diagram technique's shaper. Consumes
// the lesmiserables.json co-appearance GRAPH directly ({nodes:[{id,group}],
// links:[{source,target,value}]}), never a flat CSV row table: this
// fragment's `dataBinding.shape` is "graph" with an EMPTY `roles: []`
// (mirrors treemap.mjs's "tree" roles-empty exception) -- profile.mjs's
// graph-JSON branch (added alongside NET-03/22-03) wraps the parsed root as
// a single-element `rows` array, so `resolveGraph(rowsOrData)` below accepts
// EITHER that wrapped form (the real regenerateFromDemoBinding/bindData
// path) OR the bare parsed object directly (this plan's own standalone
// verify: `shape(JSON.parse(file), {})`), matching the plan's own "read it
// as-is" contract regardless of which caller reaches this module.
//
// Node order is the one DISCLOSED layout decision this technique makes: a
// stable sort by (group ascending, weighted-degree descending, id ascending
// as tiebreak) -- see skill/references/atlas/tier-2/arc-diagram.md. That
// order (an integer index, 0..n-1) is the node's ONLY position; per Phase
// 19's network-position honesty gate, position encodes ORDER, never
// magnitude -- magnitude (the co-appearance count) lives solely in each
// arc's stroke width (edge-width channel), computed via a pure sqrt scale
// over the bound link-value domain. Everything below is a pure function of
// the input graph -- no Math.random, no Date -- so two calls on the same
// data are byte-identical (SC2 --deep double-render).
//
// Actual pixel/path geometry (the SVG "d" attribute for each arc) is left to
// the scaffold's own runtime script, exactly like sankey-alluvial.mjs leaves
// d3.sankeyLinkHorizontal() to its scaffold -- this shaper hands over
// order/degree/value only, never a chart-dimension-dependent pixel path.

const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 8;
const MAX_HUES = 6;

function resolveGraph(rowsOrData) {
  const candidate = Array.isArray(rowsOrData) ? rowsOrData[0] : rowsOrData;
  return candidate && typeof candidate === 'object' ? candidate : { nodes: [], links: [] };
}

function weightedDegrees(nodes, links) {
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const link of links) {
    const value = Number(link.value) || 0;
    if (degree.has(link.source)) degree.set(link.source, degree.get(link.source) + value);
    if (degree.has(link.target)) degree.set(link.target, degree.get(link.target) + value);
  }
  return degree;
}

/**
 * shape(rowsOrData, bindings) -> {nodes, links, order, stats}
 *
 * Node order: group ascending, then weighted-degree descending, then id
 * ascending -- a stable, disclosed, fully-deterministic seriation (a data
 * decision, never a layout algorithm). Each node's `order` (its 0-based rank
 * in that sort) IS its baseline position; `x` mirrors `order` (both present
 * per this technique's own contract -- `x` is the position-space alias a
 * renderer maps to pixels).
 *
 * Each link's `strokeWidth` is a pure sqrt-scaled interpolation of its
 * `value` across the bound link-value domain into [MIN_STROKE_WIDTH,
 * MAX_STROKE_WIDTH] -- the honest edge-width magnitude channel (never
 * position).
 */
export function shape(rowsOrData, bindings) {
  const graph = resolveGraph(rowsOrData);
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawLinks = Array.isArray(graph.links) ? graph.links : [];

  const degreeById = weightedDegrees(rawNodes, rawLinks);

  // This dataset carries 9 distinct community groups -- more than the
  // house's 6-hue categorical token set. Mirrors treemap.mjs's own capping
  // pattern: the 6 LARGEST groups (by member count, group id ascending as a
  // stable tiebreak) get a distinct hue; every other group is inked
  // (colorKey:'ink') -- never a fabricated 7th+ hue silently reused via
  // modulo, which would make two distinct groups visually indistinguishable
  // with no disclosure.
  const memberCountByGroup = new Map();
  for (const n of rawNodes) {
    memberCountByGroup.set(n.group, (memberCountByGroup.get(n.group) || 0) + 1);
  }
  const groupsByCountDesc = [...memberCountByGroup.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([group]) => group);
  const colorKeyByGroup = new Map(
    groupsByCountDesc.map((group, i) => [group, i < MAX_HUES ? `cat-${i + 1}` : 'ink'])
  );

  const ordered = rawNodes
    .slice()
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      const degreeDiff = (degreeById.get(b.id) || 0) - (degreeById.get(a.id) || 0);
      if (degreeDiff !== 0) return degreeDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((n, i) => ({
      id: n.id,
      group: n.group,
      order: i,
      x: i,
      degree: degreeById.get(n.id) || 0,
      colorKey: colorKeyByGroup.get(n.group) || 'ink',
    }));

  const orderById = new Map(ordered.map((n) => [n.id, n.order]));
  const colorKeyById = new Map(ordered.map((n) => [n.id, n.colorKey]));

  const values = rawLinks.map((l) => Number(l.value) || 0);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 0;

  // Stroke width is a true baseline-zero sqrt scale: domain [0, maxValue],
  // never [minValue, maxValue] -- a link's width is proportional to its own
  // value from a real zero, not merely its rank within the observed range
  // (the honesty distinction scripts/qa/checks/baseline-honesty.check.mjs
  // enforces for any "length"-channel encoding: meta.encoding.baselineZero
  // must be true, and it must actually BE true, not just declared).
  // MIN_STROKE_WIDTH remains only as a visibility floor for near-zero
  // values, exactly like a bar chart's minimum rendered bar height.
  function strokeWidthFor(value) {
    if (maxValue === 0) return MIN_STROKE_WIDTH;
    const t = Math.sqrt(value / maxValue);
    return MIN_STROKE_WIDTH + t * (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH);
  }

  const links = rawLinks.map((l) => {
    const value = Number(l.value) || 0;
    return {
      source: l.source,
      target: l.target,
      sourceOrder: orderById.get(l.source),
      targetOrder: orderById.get(l.target),
      value,
      strokeWidth: strokeWidthFor(value),
      colorKey: colorKeyById.get(l.source) || 'ink',
    };
  });

  return {
    nodes: ordered,
    links,
    order: ordered.map((n) => n.id),
    stats: {
      nodeCount: ordered.length,
      linkCount: links.length,
      maxValue,
      minValue,
      groupCount: new Set(ordered.map((n) => n.group)).size,
    },
  };
}

/**
 * validate(rowsOrData, bindings) -> Array<{channel,problem,remedy}>
 *
 * Mirrors sankey-alluvial's structured-error shape: rejects fewer than 2
 * nodes, or any link referencing a node id absent from the node set.
 */
export function validate(rowsOrData, bindings) {
  const graph = resolveGraph(rowsOrData);
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawLinks = Array.isArray(graph.links) ? graph.links : [];
  const problems = [];

  if (rawNodes.length < 2) {
    problems.push({
      channel: 'nodes',
      problem: `an arc diagram needs at least 2 nodes, found ${rawNodes.length}`,
      remedy: 'bind a graph whose nodes[] array has at least 2 entries',
    });
    return problems;
  }

  const ids = new Set(rawNodes.map((n) => n.id));
  const unknown = rawLinks.filter((l) => !ids.has(l.source) || !ids.has(l.target));
  if (unknown.length > 0) {
    problems.push({
      channel: 'links',
      problem: `${unknown.length} link(s) reference a node id not present in nodes[]`,
      remedy: 'ensure every link.source/link.target id matches a nodes[].id',
    });
  }

  return problems;
}
