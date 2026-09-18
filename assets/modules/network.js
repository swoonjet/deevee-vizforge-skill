// EGO NETWORK — the gallery's `int-network` ("Every tool's ego network, on
// demand"), ported to take any source / target / weight table.
//
// THE HONESTY CLAIM THIS FORM LIVES OR DIES ON: NODE POSITION CARRIES NO VALUE.
// A force layout is a readability device — it puts connected things near each
// other so the links do not cross — and nothing about a node's coordinates
// encodes anything. Two nodes at opposite ends are not opposites. The source
// line says it outright, because a scatter plot has taught every reader that
// position means something.
//
// What DOES encode: the area of a node (its total weight, so the radius is a
// square root) and the width of a link (its weight).
//
// EGO: clicking a node keeps its own neighbourhood and states how much of the
// network that is — "9 of 46 nodes" — so a small ego view is never mistaken for
// the whole graph.
//
// THE SETTLING IS THE ENTRANCE, not a rest. Marks move while the simulation
// runs and then STOP; a force layout left running forever would be geometry
// drifting under a reader's eye, which is the one thing a rest may never do.

import { d3Piece } from './d3-piece.js';
import { edgeShape, edgeRoles, edgeDek, edgeNote, nodeColors } from './edge-shape.js';
import { resolveAccent, fitText, formatNumber, ifLive} from './vf-core.js';

export const slug = 'network';
export const roles = edgeRoles;
export const shape = edgeShape;

const SETTLE_TICKS = 320;

/**
 * The whole graph's finding. Named rather than inlined into the spec because
 * leaving an ego view's headline standing over the restored network describes a
 * picture that is no longer on screen (see chord.js, stream.js — same fault).
 */
function networkHeadline(stats) {
  const n = stats.biggestNode;
  if (!n) return `${stats.nodeCount} nodes`;
  return `${n.name} is the hub: ${n.degree} of ${stats.nodeCount} nodes connect through it`;
}

export default d3Piece({
  slug, title: 'Ego network', roles, shape,
  build: null,
  rest: 'attract',
  dur: 4000,
  aspect: 0.62,
  minHeight: 320,
  hoverNote: 'Hover a node for its connections; click one to see only its neighbourhood.',

  headline: networkHeadline,
  dek: edgeDek,
  note: (stats) => edgeNote(stats,
    'a node\'s POSITION carries nothing — the layout only keeps connected things near each other; the area of a '
    + 'node is its total weight and the width of a link is that link\'s weight'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.links.length) return null;

    // A previous draw's simulation is still ticking against an svg that no
    // longer exists. Stop it before starting another, or a few resizes leave
    // half a dozen simulations fighting over the same node objects.
    if (view.sim) { view.sim.stop(); view.sim = null; }

    const focus = view.node !== undefined && view.node !== null ? view.node : null;
    const names = stats.nodeNames;
    const star = stats.biggestNode ? stats.biggestNode.name : null;
    const palette = nodeColors(stats, colors, { accent: resolveAccent(ctx.el), star });

    const inEgo = (i) => focus === null
      || i === focus
      || (data.neighbours.get(focus) || new Set()).has(i);

    const maxTotal = Math.max(...data.nodes.map((n) => n.total)) || 1;
    const rOf = (n) => 4 + Math.sqrt(n.total / maxTotal) * Math.min(26, Math.max(12, height / 22));
    const maxV = Math.max(...data.links.map((l) => l.value)) || 1;

    // The simulation owns its own copies: d3 writes x/y/vx/vy onto whatever it
    // is given, and the shaper's nodes are shared with every other piece.
    const nodes = data.nodes.map((n, i) => ({
      ...n,
      r: rOf(n),
      // A deterministic ring start, never Math.random: the same table must lay
      // out the same way twice, or a PNG of it is not reproducible.
      x: width / 2 + Math.cos(i * 2.399) * (width / 5),
      y: height / 2 + Math.sin(i * 2.399) * (height / 5),
    }));
    const links = data.links.filter((l) => !l.self).map((l) => ({ ...l }));

    // d3.forceLink REPLACES a link's numeric source/target with the node
    // OBJECT the moment the simulation initialises, so every read of them has
    // to accept both. Reading only the number is how the first cut of this
    // module threw once per tick and previewed as "could not draw this table".
    const idOf = (v) => (v && typeof v === 'object' ? v.index : v);
    const nodeAt = (v) => (v && typeof v === 'object' ? v : nodes[v]);

    const g = sel.append('g');
    const linkSel = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', 'var(--_ink)')
      .attr('stroke-opacity', (l) => (inEgo(idOf(l.source)) && inEgo(idOf(l.target)) ? 0.22 : 0.04))
      .attr('stroke-width', (l) => Math.max(0.6, (l.value / maxV) * 5));

    const nodeSel = g.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('r', (n) => n.r)
      .attr('fill', (n) => (n.index === focus ? 'var(--_accent)' : palette.get(n.name) || colors[0]))
      .attr('fill-opacity', (n) => (inEgo(n.index) ? 0.9 : 0.12))
      .attr('stroke', 'var(--_paper)').attr('stroke-width', 1.2)
      .attr('data-name', (n) => n.name)
      .style('cursor', 'pointer');

    // Only the nodes big enough to deserve one get a permanent label; the rest
    // answer on hover. A graph with every node labelled is unreadable.
    const labelled = [...nodes].sort((a, b) => b.total - a.total)
      .slice(0, focus === null ? Math.min(6, nodes.length) : nodes.length)
      .filter((n) => inEgo(n.index));
    const labelSel = g.append('g').selectAll('text').data(labelled).join('text')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--_fl)').attr('font-size', 11.5).attr('font-weight', 600)
      .attr('fill', 'var(--_ink)')
      .attr('stroke', 'var(--_paper)').attr('stroke-width', 3.5).attr('paint-order', 'stroke')
      .attr('pointer-events', 'none')
      .text((n) => fitText(n.name, 130, 11.5) || '');

    const paint = () => {
      linkSel
        .attr('x1', (l) => nodeAt(l.source).x).attr('y1', (l) => nodeAt(l.source).y)
        .attr('x2', (l) => nodeAt(l.target).x).attr('y2', (l) => nodeAt(l.target).y);
      nodeSel.attr('cx', (n) => n.x).attr('cy', (n) => n.y);
      labelSel.attr('x', (n) => n.x).attr('y', (n) => n.y - n.r - 5);
    };

    /**
     * Once it has settled, fill the frame.
     *
     * A small graph settles into a knot in the middle of a wide box and reads
     * as an afterthought. Scaling the whole layout is FREE here in a way it
     * would not be anywhere else in the library: position carries nothing, so
     * moving every node by the same transform changes no claim the piece makes.
     * Capped, so three nodes do not become three planets.
     */
    const fitToFrame = () => {
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const pad = 26;
      const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
      const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
      const k = Math.min(1.7, (width - pad * 2) / w, (height - pad * 2) / h);
      if (!(k > 0.2)) return;
      const cxNow = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cyNow = (Math.max(...ys) + Math.min(...ys)) / 2;
      g.attr('transform',
        `translate(${width / 2},${height / 2}) scale(${k.toFixed(3)}) translate(${-cxNow},${-cyNow})`);
      // Marks keep their drawn size, so the scale never restates a value.
      nodeSel.attr('r', (n) => n.r / k);
      nodeSel.attr('stroke-width', 1.2 / k);
      linkSel.attr('stroke-width', (l) => Math.max(0.6, (l.value / maxV) * 5) / k);
      labelSel.attr('font-size', 11.5 / k).attr('stroke-width', 3.5 / k)
        .attr('y', (n) => n.y - n.r / k - 5 / k);
    };

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((n) => n.index).distance(70).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-180))
      .force('centre', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide((n) => n.r + 4))
      .force('bounds', () => {
        for (const n of nodes) {
          n.x = Math.max(n.r + 4, Math.min(width - n.r - 4, n.x));
          n.y = Math.max(n.r + 4, Math.min(height - n.r - 4, n.y));
        }
      })
      .on('tick', paint)
      .on('end', fitToFrame);

    // Reduced motion and the PNG renderer get the SETTLED graph, complete and
    // still — never a half-settled one, which would be a different layout.
    if (config.static || !motion.enabled) {
      sim.stop();
      for (let i = 0; i < SETTLE_TICKS; i += 1) sim.tick();
      paint();
      fitToFrame();
    } else {
      view.sim = sim;
      paint();
    }

    const enter = (n) => {
      motion.hold();
      const near = data.neighbours.get(n.index) || new Set();
      nodeSel.attr('fill-opacity', (o) => (o.index === n.index || near.has(o.index) ? 0.95 : 0.1));
      linkSel.attr('stroke-opacity', (l) => (idOf(l.source) === n.index || idOf(l.target) === n.index ? 0.6 : 0.04));
    };
    const leave = () => {
      nodeSel.attr('fill-opacity', (o) => (inEgo(o.index) ? 0.9 : 0.12));
      linkSel.attr('stroke-opacity', (l) => (inEgo(idOf(l.source)) && inEgo(idOf(l.target)) ? 0.22 : 0.04));
      tip.hide();
      motion.free();
    };

    nodeSel.on('pointerenter', (event, n) => enter(n));
    nodeSel.on('pointermove', (event, n) => {
      const box = ctx.svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const py = ((event.clientY - box.top) / box.height) * height;
      tip.show(
        `<div style="color:${palette.get(n.name) || colors[0]}"><b>${n.name}</b></div>`
        + `<div><b>${n.degree}</b> connections &middot; ${fmt(n.total)} total weight</div>`
        + '<div style="opacity:.7">click to see only this neighbourhood</div>',
        px, py
      );
    });
    nodeSel.on('pointerleave', leave);
    nodeSel.on('click', (event, n) => {
      tip.hide();
      view.node = n.index === focus ? null : n.index;
      ctx.redraw();
    });

    ctx.trail(focus === null ? null : {
      label: 'The whole network',
      crumbs: `around ${names[focus]}`,
      onHome() {
        tip.hide();
        view.node = null;
        ctx.redraw();
      },
    });

    if (focus !== null) {
      const shown = nodes.filter((n) => inEgo(n.index)).length;
      ctx.setCopy({
        headline: `${names[focus]} and its ${shown - 1} neighbours`,
        // THE RESTATEMENT: an ego view is a fragment, and it says how big a
        // fragment. Everything else is still drawn, faintly, in place.
        dek: `${shown} of ${stats.nodeCount} nodes — the rest of the network is still there, greyed, in the same `
          + `positions. ${formatNumber(data.nodes[focus].total)} of weight runs through this one.`
          + ifLive(config, ' Click it again to bring the whole graph back.'),
      });
    } else {
      ctx.setCopy({
        headline: networkHeadline(stats),
        // A RASTER CANNOT BE CLICKED. vf-core's interactionNote() drops the
        // declared hover line when `static` is set, but copy written from inside
        // draw() bypasses that filter and has to honour the rule itself — this
        // sentence was shipping inside exported PNGs.
        dek: `${edgeDek(stats)}${ifLive(config, ' Click any node to see only its own neighbourhood.')}`,
      });
    }

    let attract;
    if (nodes.length > 2) {
      const order = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 6);
      attract = {
        count: order.length,
        apply(i, amp) {
          const lit = order[i];
          const near = data.neighbours.get(lit.index) || new Set();
          nodeSel.attr('fill-opacity', (o) => {
            const related = o.index === lit.index || near.has(o.index);
            const baseline = inEgo(o.index) ? 0.9 : 0.12;
            return related ? baseline : Math.max(0.06, baseline - 0.5 * amp);
          });
        },
        clear() { nodeSel.attr('fill-opacity', (o) => (inEgo(o.index) ? 0.9 : 0.12)); },
      };
    }

    return { attract };
  },
});
