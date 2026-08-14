// scripts/shapers/node-link.mjs
//
// NET-03 (Phase 22 Plan 03) -- graph->node-link shaper. Consumes the
// data/lesmiserables.json GRAPH root ({nodes:[{id,group}], links:[{source,
// target,value}]}) directly: this fragment's dataBinding.shape is "graph"
// with an EMPTY roles:[] (see scripts/profile.mjs's json-object graph
// branch, added alongside this plan, mirroring 21-02's tree-root branch) --
// a graph dataset's JSON root is profiled as rows:[thatRootObject] (an
// object reference, never stringified), so rows[0] IS the whole parsed
// graph. shape()/validate() also accept the graph object directly
// (un-array-wrapped) for direct/manual invocation -- see resolveGraph().
//
// DETERMINISM (the plan's crux -- verified by reading the vendored bundle,
// node_modules/d3-force/dist/d3-force.js, before choosing this approach):
// d3-force's DEFAULTS carry zero real randomness. Node initialization uses a
// phyllotaxis-style spiral (radius = 10*sqrt(0.5+i), angle = i*golden-angle),
// never Math.random; the simulation's default random SOURCE is `lcg()` -- a
// fixed-seed (s=1) linear congruential generator, reseeded to the exact same
// starting state on every `d3.forceSimulation()` call -- so even the
// internal `jiggle()` fallback (used when forceManyBody's quadtree needs to
// break an exact position tie) produces the identical pseudo-random sequence
// every run. Given a stable node array order (this file's own graph.nodes
// order, taken directly from the JSON file, never re-sorted) and a FIXED
// tick count run SYNCHRONOUSLY (simulation.stop() immediately after
// construction, then simulation.tick(TICKS) -- never the async d3-timer
// stepper/restart path), two shape() calls on the same input are
// byte-identical (this file's own smoke test + the plan's own verify
// command both assert this). Coordinates are ROUNDED to 2 decimals to kill
// any theoretical float-formatting drift before being returned -- shape()
// is a PURE function; the scaffold draws the returned x/y as a static
// picture with NO live simulation at render time.
//
// Node AREA is the honest magnitude channel: radius = k*sqrt(weighted
// degree), matching assets/snippets/scale-helpers.js's sqrtRadius() formula
// (never radius = degree directly -- the lie area-encoding.check.mjs
// exists to catch). A node with zero weighted degree (the real dataset has
// exactly one -- "OldMan", never appears in a link) honestly gets radius 0,
// mirroring circle-packing.mjs's d3.pack()-native zero-value behavior --
// no artificial floor inflating a real zero into a fabricated visible size.
// Edge stroke-width is a secondary, independent channel scaled from link
// value (a length-like channel, not an area mark -- linear scaling is
// honest here). Node POSITION/proximity itself carries NO quantitative
// meaning -- it's an arrangement produced by the deterministic force
// settle, disclosed verbatim by the scaffold
// (scripts/qa/checks/network-position.check.mjs).

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3';

export const WIDTH = 1120;
export const HEIGHT = 620;
const TICKS = 300;
const MAX_RADIUS = 16;
const ROUND2 = (n) => Math.round(n * 100) / 100;

function resolveGraph(data) {
  const graph = Array.isArray(data) ? data[0] : data;
  return graph && typeof graph === 'object' ? graph : { nodes: [], links: [] };
}

/**
 * sqrtRadius(value, maxValue, maxRadius) -- area-honest radius: area encodes
 * value, so radius = sqrt(value/maxValue) * maxRadius (never radius = value
 * directly). Reimplemented here (Node-side shaper) rather than imported --
 * assets/snippets/scale-helpers.js is designed to be INLINED into a piece's
 * browser-side <script>, not imported at build time -- but the formula is
 * identical to that shared house helper.
 */
function sqrtRadius(value, maxValue, maxRadius) {
  if (maxValue <= 0) return 0;
  const ratio = Math.max(0, value) / maxValue;
  return Math.sqrt(ratio) * maxRadius;
}

function weightedDegrees(nodes, links) {
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const l of links) {
    const v = Number(l.value) || 0;
    if (degree.has(l.source)) degree.set(l.source, degree.get(l.source) + v);
    if (degree.has(l.target)) degree.set(l.target, degree.get(l.target) + v);
  }
  return degree;
}

/**
 * shape(data, bindings) -> { width, height, nodes, links, stats }
 *
 * `nodes`: [{id, group, degree, x, y, r}] -- x/y are the FIXED, rounded,
 * force-settled coordinates (a pure draw target, no simulation at render
 * time); r = k*sqrt(degree) (area-honest).
 * `links`: [{source, target, value, x1, y1, x2, y2, strokeWidth}] -- source/
 * target stay the original id STRINGS (never replaced with object refs --
 * d3-force's forceLink mutates its OWN internal working array in place,
 * never the `links` array this function builds fresh from the graph).
 */
export function shape(data, bindings) {
  const graph = resolveGraph(data);
  const nodes = (graph.nodes || []).map((n) => ({ id: n.id, group: n.group }));
  const links = (graph.links || []).map((l) => ({
    source: l.source,
    target: l.target,
    value: Number(l.value) || 0,
  }));

  const degree = weightedDegrees(nodes, links);
  const maxDegree = Math.max(1, ...Array.from(degree.values()));
  const maxValue = Math.max(1, ...links.map((l) => l.value));

  // Fresh working copies for d3-force -- forceLink() mutates its OWN link
  // array's source/target fields in place (string id -> resolved node
  // object), so a fresh array here keeps the returned `links` (built from
  // the original `links` above) untouched.
  const simNodes = nodes.map((n) => ({ id: n.id, group: n.group, degree: degree.get(n.id) || 0 }));
  const simLinks = links.map((l) => ({ source: l.source, target: l.target, value: l.value }));

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink(simLinks)
        .id((d) => d.id)
        .distance(46)
        .strength(0.22)
    )
    .force('charge', forceManyBody().strength(-70))
    .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
    .force('collide', forceCollide((d) => sqrtRadius(d.degree, maxDegree, MAX_RADIUS) + 2))
    .stop();

  // Manual, synchronous, FIXED-count tick -- never the async d3-timer
  // stepper (simulation.stop() above cancelled it before it ever fired).
  simulation.tick(TICKS);

  const coordById = new Map();
  const shapedNodes = simNodes.map((n) => {
    const r = sqrtRadius(n.degree, maxDegree, MAX_RADIUS);
    const x = ROUND2(n.x);
    const y = ROUND2(n.y);
    coordById.set(n.id, { x, y });
    return { id: n.id, group: n.group, degree: ROUND2(n.degree), x, y, r: ROUND2(r) };
  });

  const shapedLinks = links.map((l) => {
    const s = coordById.get(l.source);
    const t = coordById.get(l.target);
    return {
      source: l.source,
      target: l.target,
      value: l.value,
      x1: s ? s.x : 0,
      y1: s ? s.y : 0,
      x2: t ? t.x : 0,
      y2: t ? t.y : 0,
      strokeWidth: ROUND2(0.6 + (Math.max(0, l.value) / maxValue) * 3.4),
    };
  });

  const topNode = shapedNodes.reduce((best, n) => (!best || n.degree > best.degree ? n : best), null);

  return {
    width: WIDTH,
    height: HEIGHT,
    nodes: shapedNodes,
    links: shapedLinks,
    stats: {
      nodeCount: shapedNodes.length,
      linkCount: shapedLinks.length,
      maxDegree: ROUND2(maxDegree),
      topNode,
    },
  };
}

/**
 * validate(data, bindings) -> Array<{channel, problem, remedy}>
 *
 * A node-link graph needs at least 2 distinct nodes, and every link must
 * reference node ids that actually exist in the node set (an unknown id
 * would silently draw a zero-length edge to the [0,0] fallback above --
 * caught here instead, before shape() is ever reached).
 */
export function validate(data, bindings) {
  const graph = resolveGraph(data);
  const nodes = graph.nodes || [];
  const links = graph.links || [];

  if (nodes.length < 2) {
    return [
      {
        channel: 'nodes',
        problem: `a node-link graph needs at least 2 distinct nodes, found ${nodes.length}`,
        remedy: 'bind a graph dataset with at least 2 nodes',
      },
    ];
  }

  const ids = new Set(nodes.map((n) => n.id));
  const problems = [];
  for (const l of links) {
    if (!ids.has(l.source)) {
      problems.push({
        channel: 'links',
        problem: `link references unknown source node id ${JSON.stringify(l.source)}`,
        remedy: 'ensure every link source/target id matches a node id in the graph',
      });
    }
    if (!ids.has(l.target)) {
      problems.push({
        channel: 'links',
        problem: `link references unknown target node id ${JSON.stringify(l.target)}`,
        remedy: 'ensure every link source/target id matches a node id in the graph',
      });
    }
  }
  return problems;
}
