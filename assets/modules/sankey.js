// SANKEY — the gallery's `unc-sankey` ("10,000 leads in, 82 customers out")
// and its interactive sibling `int-sankey`, ported to take any source / target
// / weight table.
//
// HONESTY, and a flow diagram has more of it to do than most forms:
//
//   RIBBON WIDTH IS THE QUANTITY, and nothing else is. Vertical position is the
//   layout minimising crossings; the ORDER of the bands at a node carries no
//   meaning at all.
//
//   A FLOW THAT DOES NOT CONSERVE IS NOT A LIE, BUT AN UNSTATED ONE IS. Real
//   edge lists rarely balance — volume enters and leaves the system — so every
//   node states its own in and out on hover rather than the piece pretending
//   they match.
//
//   WHAT COULD NOT BE DRAWN IS NAMED. d3-sankey needs a DAG: self-loops and
//   back-edges are found in edge-shape.js, excluded, counted and listed in the
//   source line. A funnel silently missing an edge is claiming a shape the data
//   does not have.
//
// ISOLATE (`options.isolate`, which is what makes this int-sankey): clicking a
// node keeps only the paths that run through it and restates their share of the
// whole — it does NOT rescale them to fill the frame, which would turn a
// selected sliver into the entire diagram.

import { d3Piece } from './d3-piece.js';
import { edgeShape, edgeRoles, edgeHeadline, edgeDek, edgeNote, nodeColors } from './edge-shape.js';
import { resolveAccent, ifLive} from './vf-core.js';

export const slug = 'sankey';
export const roles = { ...edgeRoles, value: { ...edgeRoles.value, required: true, label: 'Volume' } };
export const shape = edgeShape;

export default d3Piece({
  slug, title: 'Sankey', roles, shape,
  build: 'sankey',
  rest: (config) => (config && config.isolate ? 'attract' : 'flow'),
  dur: 4200,
  aspect: 0.54,
  minHeight: 300,
  hoverNote: (config) => (config && config.isolate
    ? 'Hover a ribbon for its volume; click a node to keep only the paths through it.'
    : 'Hover a ribbon or a node for its volume.'),

  headline: edgeHeadline,
  dek: edgeDek,
  note: (stats) => edgeNote(stats,
    'ribbon WIDTH is the volume — the vertical order of the bands is the layout\'s doing and carries nothing',
    { dropsCycles: true }),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.acyclic.length) return null;
    if (!d3.sankey) throw new Error('sankey: this piece needs d3-sankey on the page (assets/vendor/d3-sankey.min.js)');

    const isolate = Boolean(config.isolate);
    const focus = isolate && view.node !== undefined && view.node !== null ? view.node : null;

    // Room for the labels that sit outside the end columns.
    const pad = Math.min(170, Math.max(90, width * 0.13));
    const m = { left: pad, right: pad, top: isolate ? 22 : 8, bottom: 12 };

    const layout = d3.sankey()
      .nodeWidth(13)
      .nodePadding(Math.max(8, Math.min(20, height / (stats.nodeCount + 4))))
      .nodeAlign(d3.sankeyLeft)
      .nodeSort(null)
      .extent([[m.left, m.top], [Math.max(m.left + 40, width - m.right), Math.max(m.top + 40, height - m.bottom)]]);

    let graph;
    try {
      graph = layout({
        nodes: data.nodes.map((n) => ({ ...n })),
        links: data.acyclic.map((l) => ({ ...l })),
      });
    } catch (err) {
      // A layout that throws must not take the page with it — the piece says
      // what happened where a blank stage would say nothing.
      throw new Error(`sankey: this edge list could not be laid out as a one-way flow (${err.message})`);
    }

    const star = stats.biggestLink ? stats.biggestLink.sourceName : null;
    const palette = nodeColors(stats, colors, { accent: resolveAccent(ctx.el), star });
    const colourOf = (name) => palette.get(name) || colors[0];

    const g = sel.append('g');

    // Which links belong to the focused node's paths. UPSTREAM AND DOWNSTREAM
    // both: "what happened to this stage" means where its volume came from as
    // well as where it went, and showing only one half misreads the question.
    const onPath = new Set();
    if (focus !== null) {
      const byTarget = new Map();
      const bySource = new Map();
      graph.links.forEach((l, i) => {
        const s = l.source.index;
        const t = l.target.index;
        if (!bySource.has(s)) bySource.set(s, []);
        if (!byTarget.has(t)) byTarget.set(t, []);
        bySource.get(s).push(i);
        byTarget.get(t).push(i);
      });
      const walk = (idx, map, step) => {
        const seen = new Set();
        const queue = [idx];
        while (queue.length) {
          const v = queue.shift();
          if (seen.has(v)) continue;
          seen.add(v);
          for (const i of map.get(v) || []) {
            onPath.add(i);
            queue.push(step(graph.links[i]));
          }
        }
      };
      walk(focus, bySource, (l) => l.target.index);
      walk(focus, byTarget, (l) => l.source.index);
    }

    const focusVolume = focus === null
      ? 0
      : graph.links.filter((l, i) => onPath.has(i) && l.source.index === focus)
        .reduce((s, l) => s + l.value, 0)
        || graph.links.filter((l, i) => onPath.has(i) && l.target.index === focus)
          .reduce((s, l) => s + l.value, 0);

    const linkSel = [];
    const path = d3.sankeyLinkHorizontal();

    graph.links.forEach((l, i) => {
      const lit = focus === null || onPath.has(i);
      const colour = colourOf(l.source.name);
      const p = g.append('path')
        .attr('d', path(l))
        .attr('fill', 'none')
        .attr('stroke', colour)
        .attr('stroke-width', Math.max(1, l.width))
        .attr('stroke-opacity', lit ? 0.5 : 0.07)
        .attr('data-vf-link', '')
        // The isolation STATE, in the DOM, separate from the paint. A rest and
        // a hover both write stroke-opacity, so reading the paint back cannot
        // tell "this path is in the selection" from "this path is mid-preview".
        .attr('data-vf-lit', lit ? 1 : 0)
        .style('cursor', 'pointer');
      linkSel.push({ p, l, lit });

      p.on('pointerenter', () => {
        motion.hold();
        for (const other of linkSel) other.p.attr('stroke-opacity', other.p === p ? 0.85 : 0.07);
      });
      p.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const ofSource = l.source.value ? (100 * l.value) / l.source.value : 0;
        tip.show(
          `<div style="color:${colour}"><b>${l.source.name} → ${l.target.name}</b></div>`
          + `<div><b>${fmt(l.value)}</b> &middot; ${ofSource.toFixed(0)}% of what leaves ${l.source.name}</div>`
          + `<div style="opacity:.7">${((100 * l.value) / (stats.total || 1)).toFixed(1)}% of all ${fmt(stats.total)} moving</div>`,
          px, py
        );
      });
      p.on('pointerleave', () => {
        for (const other of linkSel) other.p.attr('stroke-opacity', other.lit ? 0.5 : 0.07);
        tip.hide();
        motion.free();
      });
    });

    // Nodes, then their labels — outside the column on the ends, above it in
    // the middle, so a label never sits on a ribbon.
    for (const nd of graph.nodes) {
      const lit = focus === null || nd.index === focus
        || graph.links.some((l, i) => onPath.has(i) && (l.source.index === nd.index || l.target.index === nd.index));
      const colour = colourOf(nd.name);
      const isFocus = nd.index === focus;
      const rect = g.append('rect')
        .attr('x', nd.x0).attr('y', nd.y0)
        .attr('width', Math.max(2, nd.x1 - nd.x0))
        .attr('height', Math.max(2, nd.y1 - nd.y0))
        .attr('rx', 2)
        .attr('fill', isFocus ? 'var(--_accent)' : colour)
        .attr('fill-opacity', lit ? 1 : 0.18)
        .attr('data-vf-node', '')
        .attr('data-name', nd.name)
        .style('cursor', isolate ? 'pointer' : 'default');

      const left = nd.x0 < width / 2;
      const anchor = nd.depth === 0 ? 'end' : (nd.sourceLinks.length ? 'middle' : 'start');
      const lx = nd.depth === 0 ? nd.x0 - 10 : (nd.sourceLinks.length ? (nd.x0 + nd.x1) / 2 : nd.x1 + 10);
      const ly = nd.sourceLinks.length && nd.depth > 0 ? nd.y0 - 8 : (nd.y0 + nd.y1) / 2;

      const label = g.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', nd.sourceLinks.length && nd.depth > 0 ? 'auto' : 'middle')
        .attr('font-family', 'var(--_fl)').attr('font-size', 12).attr('font-weight', 600)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', lit ? 0.9 : 0.25)
        .attr('pointer-events', 'none')
        .text(nd.name);
      // A halo, because a mid-column label sits over the ribbons behind it.
      label.attr('stroke', 'var(--_paper)').attr('stroke-width', 4).attr('paint-order', 'stroke');

      g.append('text')
        .attr('x', lx).attr('y', ly + (nd.sourceLinks.length && nd.depth > 0 ? -0 : 15))
        .attr('dy', nd.sourceLinks.length && nd.depth > 0 ? 14 : 0)
        .attr('text-anchor', anchor)
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', lit ? 0.6 : 0.2)
        .attr('pointer-events', 'none')
        .attr('stroke', 'var(--_paper)').attr('stroke-width', 3.5).attr('paint-order', 'stroke')
        .text(fmt(nd.value));

      rect.on('pointerenter', () => {
        motion.hold();
        for (const other of linkSel) {
          const touches = other.l.source.index === nd.index || other.l.target.index === nd.index;
          other.p.attr('stroke-opacity', touches ? 0.8 : 0.06);
        }
      });
      rect.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const node = data.nodes[nd.index];
        // IN AND OUT SEPARATELY. A flow diagram invites the assumption that
        // they match; where they do not, saying so is the whole disclosure.
        tip.show(
          `<div style="color:${colour}"><b>${nd.name}</b></div>`
          + `<div>in <b>${fmt(node.in)}</b> &middot; out <b>${fmt(node.out)}</b></div>`
          + (Math.abs(node.in - node.out) > 1e-9 && node.in > 0 && node.out > 0
            ? `<div style="opacity:.7">${fmt(Math.abs(node.in - node.out))} ${node.in > node.out ? 'stops here' : 'enters here'}</div>`
            : ''),
          px, py
        );
      });
      rect.on('pointerleave', () => {
        for (const other of linkSel) other.p.attr('stroke-opacity', other.lit ? 0.5 : 0.07);
        tip.hide();
        motion.free();
      });

      if (isolate) {
        rect.on('click', () => {
          tip.hide();
          view.node = isFocus ? null : nd.index;
          motion.replay();
          ctx.redraw();
        });
      }
    }

    if (isolate) {
      const name = focus === null ? null : data.nodes[focus].name;
      ctx.trail(focus === null ? null : {
        label: 'Every path',
        crumbs: `through ${name}`,
        onHome() {
          tip.hide();
          view.node = null;
          motion.replay();
          ctx.redraw();
        },
      });

      ctx.setCopy(focus === null
        ? { headline: edgeHeadline(stats),
          dek: `${edgeDek(stats)}${ifLive(config, ' Click a node to keep only the paths through it.')}` }
        : {
          headline: `Every path through ${name}`,
          // THE RESTATEMENT. The isolated paths keep the scale of the whole
          // diagram and their share of it is printed, so a thin selection
          // cannot read as the entire flow.
          dek: `${fmt(focusVolume)} moves through ${name} — `
            + `${((100 * focusVolume) / (stats.total || 1)).toFixed(1)}% of the ${fmt(stats.total)} in the whole `
            + 'diagram, drawn at the same scale as the rest.'
            + ifLive(config, ' Click again to bring everything back.'),
        });
    }

    let attract;
    if (isolate && graph.nodes.length > 2) {
      const order = [...graph.nodes].sort((a, b) => b.value - a.value).slice(0, 6);
      attract = {
        count: order.length,
        apply(i, amp) {
          const nd = order[i];
          for (const other of linkSel) {
            const touches = other.l.source.index === nd.index || other.l.target.index === nd.index;
            other.p.attr('stroke-opacity', touches ? 0.5 + 0.3 * amp : Math.max(0.05, 0.5 - 0.4 * amp));
          }
        },
        clear() { for (const other of linkSel) other.p.attr('stroke-opacity', other.lit ? 0.5 : 0.07); },
      };
    }

    return { attract };
  },
});
