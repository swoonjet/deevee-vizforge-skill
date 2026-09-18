// ARC DIAGRAM — the gallery's `exp-arcs` ("$592 billion of consolidation"),
// ported to take any source / target / weight table.
//
// HONESTY, and this form has one specific trap: THE HEIGHT OF AN ARC IS NOT A
// VALUE. It is half the distance between the two nodes along the axis, which
// means a link between distant names towers over a heavy link between
// neighbours. Only THICKNESS carries the weight, and the source line says so.
//
// Thickness is linear in the value, not a square root: a stroke width is a
// length, and taking its root would quietly halve the difference between a big
// deal and a small one. Where that makes the heaviest arc unwieldy the answer
// is a cap on the drawing, not a lie about the scale.
//
// The order of the nodes along the axis is THE ORDER THEY APPEAR IN THE FILE.
// That is a real convention (an event list is usually chronological) and it is
// stated, because a reader who assumes it is a ranking will read a story that
// is not there.

import { d3Piece } from './d3-piece.js';
import { edgeShape, edgeRoles, edgeHeadline, edgeDek, edgeNote, nodeColors } from './edge-shape.js';
import { resolveAccent, fitText } from './vf-core.js';

export const slug = 'arcs';
export const roles = edgeRoles;
export const shape = edgeShape;

export default d3Piece({
  slug, title: 'Arc diagram', roles, shape,
  build: 'trace',
  rest: 'walk',
  restSelect: '[data-vf-walk]',
  dur: 4200,
  aspect: 0.5,
  minHeight: 300,
  hoverNote: 'Hover an arc for the pair and its weight.',

  headline: edgeHeadline,
  dek: edgeDek,
  note: (stats) => edgeNote(stats,
    'arc THICKNESS is the weight; the height of an arc is only how far apart its two ends sit on the axis, and the '
    + 'order along that axis is the order the names appear in the data'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    if (!data.links.length) return null;

    const names = stats.nodeNames;
    const labelRoom = Math.min(150, Math.max(70, height * 0.3));
    const base = height - labelRoom;
    const m = { left: 40, right: 40 };

    const x = d3.scalePoint().domain(names).range([m.left, width - m.right]).padding(0.5);
    const maxV = Math.max(...data.links.map((l) => l.value));
    const maxW = Math.max(2, Math.min(18, (x.step() || 20) * 0.9));
    const w = (v) => Math.max(0.8, (v / maxV) * maxW);
    const maxTotal = Math.max(...data.nodes.map((n) => n.total)) || 1;
    // Radius from the SQUARE ROOT of the total, so the dot's AREA is the weight.
    const r = (t) => 2.5 + Math.sqrt(t / maxTotal) * 7;

    const star = stats.biggestLink ? stats.biggestLink.sourceName : null;
    const palette = nodeColors(stats, colors, { accent: resolveAccent(ctx.el), star });

    const g = sel.append('g');
    const arcs = [];

    // Heaviest last so it sits on top of the pile.
    [...data.links].sort((a, b) => a.value - b.value).forEach((l) => {
      if (l.self) return; // an arc from a node to itself has nowhere to go
      const x1 = x(names[l.source]);
      const x2 = x(names[l.target]);
      const rad = Math.abs(x2 - x1) / 2;
      const colour = palette.get(names[l.source]) || colors[0];
      const p = g.append('path')
        .attr('d', `M${x1},${base} A${rad},${Math.min(rad * 0.92, base - 10)} 0 0 ${x1 < x2 ? 1 : 0} ${x2},${base}`)
        .attr('fill', 'none')
        .attr('stroke', colour)
        .attr('stroke-width', w(l.value))
        .attr('stroke-opacity', 0.55)
        .attr('stroke-linecap', 'round')
        .attr('data-vf-walk', '')
        .style('cursor', 'pointer');
      const rec = { p, l };
      arcs.push(rec);

      p.on('pointerenter', () => {
        motion.hold();
        for (const other of arcs) other.p.attr('stroke-opacity', other === rec ? 0.95 : 0.08);
      });
      p.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        tip.show(
          `<div style="color:${colour}"><b>${l.sourceName} → ${l.targetName}</b></div>`
          + `<div><b>${fmt(l.value)}</b></div>`
          + `<div style="opacity:.7">${((100 * l.value) / (stats.total || 1)).toFixed(1)}% of the ${fmt(stats.total)} total</div>`,
          px, py
        );
      });
      p.on('pointerleave', () => {
        for (const other of arcs) other.p.attr('stroke-opacity', 0.55);
        tip.hide();
        motion.free();
      });
    });

    // The axis line, the nodes on it, and their names running underneath.
    g.append('line')
      .attr('x1', m.left - 10).attr('x2', width - m.right + 10)
      .attr('y1', base).attr('y2', base)
      .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.12);

    const size = Math.min(11, Math.max(8, (x.step() || 16) * 0.85));
    for (const node of data.nodes) {
      const isStar = node.name === star;
      g.append('circle')
        .attr('cx', x(node.name)).attr('cy', base).attr('r', r(node.total))
        .attr('fill', isStar ? 'var(--_accent)' : 'var(--_ink)')
        .attr('fill-opacity', isStar ? 1 : 0.72)
        .attr('data-vf-peak', isStar ? '' : null);

      const label = fitText(node.name, labelRoom - 18, size);
      if (label) {
        g.append('text')
          .attr('transform', `translate(${x(node.name) + 4},${base + 14}) rotate(40)`)
          .attr('font-family', 'var(--_ff)').attr('font-size', size)
          .attr('fill', isStar ? 'var(--_accent)' : 'var(--_ink)')
          .attr('fill-opacity', isStar ? 1 : 0.7)
          .attr('pointer-events', 'none')
          .text(label);
      }
    }

    return null;
  },
});
