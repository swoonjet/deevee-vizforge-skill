// CIRCLE PACKING — the gallery's `unc-circlepack` ("The public SaaS universe,
// packed"), ported to take any group / item / size table.
//
// HONESTY: circle AREA is the value, so the radius is a SQUARE ROOT and must
// never be read as one. That is not a detail — sizing by radius instead makes a
// company four times its neighbour look sixteen times bigger, and it is the
// single most common way this form lies. d3.pack() does the right thing by
// construction; the source line says so because the reader cannot see which
// choice was made.
//
// WHAT THE LAYOUT IS AND IS NOT: the packing arranges circles so they fit. A
// circle's POSITION carries nothing at all — two neighbours are neighbours
// because they pack well, not because they are alike.

import { d3Piece, radialSideTable } from './d3-piece.js';
import {
  hierShape, hierRoles, hierHeadline, hierDek, hierNote, groupColors, colorOf,
} from './hier-shape.js';
import { resolveAccent, fitText } from './vf-core.js';

export const slug = 'circlepack';
export const roles = hierRoles;
export const shape = hierShape;

export default d3Piece({
  slug, title: 'Circle packing', roles, shape,
  build: 'tiles',
  // A packed field has no series to walk one at a time; it is a surface, so it
  // shimmers rather than being spotlit.
  rest: 'wavebreathe',
  restSelect: '[data-vf-shimmer]',
  dur: 3400,
  aspect: 0.68,
  minHeight: 300,
  hoverNote: 'Hover a circle for its value and its share.',

  headline: hierHeadline,
  dek: hierDek,
  note: (stats) => hierNote(stats,
    'circle AREA is the value, so the radius is a square root — never read the radius, and the packing '
    + 'arrangement itself carries nothing'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    if (!data.children || !data.children.length) return null;

    // THE GROUPS, IN THE WIDTH A PACKED FIELD CANNOT USE. A pack is bound by the
    // SHORT side exactly as a disc is — it reached 25% of the plot width, the
    // worst of the radial family — so the rest of it lists the groups with their
    // totals and shares. Area is the encoding here, and area is the hardest
    // channel to compare by eye, which is precisely why the figures belong beside
    // it rather than only in a tooltip.
    const packParts = [...(data.children || [])].sort((a, b) => b.value - a.value);
    const packPalette = groupColors(stats, colors, {
      accent: resolveAccent(ctx.el),
      star: stats.biggestGroup ? stats.biggestGroup.name : null,
    });
    const box = radialSideTable(ctx, {
      rimRoom: 26, // the group labels sit outside their circle
      columns: [
        { key: 'name', header: (stats.levels || [])[0] || 'group' },
        { key: 'value', header: stats.valueName || 'value' },
        { key: 'share', header: 'share', weight: 600 },
      ],
      rows: packParts.map((c) => ({
        name: c.name,
        colour: colorOf(packPalette, colors, c.name),
        cells: {
          value: fmt(c.value),
          share: `${Math.round((100 * c.value) / (stats.total || 1))}%`,
        },
      })),
    });

    const pad = 26; // room for the group labels that sit outside their circle
    const size = box.split
      ? Math.max(60, Math.min(box.outer * 2, height - pad * 2))
      : Math.max(60, Math.min(width, height) - pad * 2);
    const ox = box.split ? box.cx - size / 2 : (width - size) / 2;
    const oy = (height - size) / 2;

    const root = d3.hierarchy(data, (d) => d.children)
      .sum((d) => (d.children && d.children.length ? 0 : d.value))
      .sort((a, b) => b.value - a.value);
    d3.pack().size([size, size]).padding(8)(root);

    const g = sel.append('g').attr('transform', `translate(${ox},${oy})`);
    const nested = (data.children || []).some((c) => c.children && c.children.length);
    // The accent marks whatever the HEADLINE names — the dominant group where
    // there are groups, the dominant item where there are not. An accent on
    // some other mark sends the reader hunting for a finding that is not there.
    const starGroup = nested && stats.groupCount > 1 && stats.biggestGroup ? stats.biggestGroup.name : null;
    const starLeaf = starGroup ? null : (stats.biggestLeaf ? stats.biggestLeaf.name : null);

    const palette = groupColors(stats, colors, { accent: resolveAccent(ctx.el), star: starGroup });
    const colorFor = (n) => {
      const t = n.ancestors().find((a) => a.depth === 1);
      return colorOf(palette, colors, t ? t.data.name : n.data.name);
    };

    const circles = [];

    for (const n of root.descendants()) {
      if (n.depth === 0) continue;
      const color = colorFor(n);
      const branch = Boolean(n.children && n.children.length);

      if (branch) {
        const isStar = n.data.name === starGroup;
        g.append('circle')
          .attr('cx', n.x).attr('cy', n.y).attr('r', n.r)
          .attr('fill', 'none')
          .attr('stroke', isStar ? 'var(--_accent)' : color)
          .attr('stroke-width', isStar ? 2 : 1.4)
          .attr('stroke-dasharray', '4 4').attr('stroke-opacity', isStar ? 1 : 0.8)
          .attr('data-vf-tile', '');

        // The group's name outside its own circle, pushed along the radius
        // away from the centre of the pack so it never lands on a child.
        const a = Math.atan2(n.y - size / 2, n.x - size / 2);
        g.append('text')
          .attr('x', n.x + Math.cos(a) * (n.r + 12))
          .attr('y', n.y + Math.sin(a) * (n.r + 12) + 4)
          .attr('text-anchor', Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle')
          .attr('font-family', 'var(--_ff)').attr('font-size', 11).attr('font-weight', 700)
          .attr('fill', isStar ? 'var(--_accent)' : color)
          .text(n.data.name);
        continue;
      }

      const peak = n.data.name === starLeaf;
      const circle = g.append('circle')
        .attr('cx', n.x).attr('cy', n.y).attr('r', n.r)
        .attr('fill', color)
        .attr('fill-opacity', peak ? 0.95 : 0.78)
        .attr('data-vf-tile', '')
        .attr('data-vf-shimmer', '')
        .attr('data-name', n.data.name)
        .style('cursor', 'pointer');
      if (peak) {
        circle.attr('stroke', 'var(--_accent)').attr('stroke-width', 2).attr('data-vf-peak', '');
      }

      const groupName = n.parent && n.parent.depth >= 1 ? n.parent.data.name : '';
      const groupTotal = n.parent && n.parent.depth >= 1 ? n.parent.value : stats.total;
      const rec = { circle, name: n.data.name, group: groupName };
      circles.push(rec);

      // A label only inside a circle big enough to hold it — and the width to
      // measure against is the chord at the label's own height, not the
      // diameter, or a long name runs out through the curve.
      const nameSize = Math.min(15, n.r / 2.6);
      const label = n.r > 22 ? fitText(n.data.name, n.r * 1.7, nameSize) : null;
      if (label) {
        g.append('text')
          .attr('x', n.x).attr('y', n.y - 1).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', nameSize)
          .attr('font-weight', 700).attr('fill', 'var(--_paper)')
          .attr('pointer-events', 'none')
          .text(label);
        if (n.r > 34) {
          g.append('text')
            .attr('x', n.x).attr('y', n.y + 14).attr('text-anchor', 'middle')
            .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
            .attr('fill', 'var(--_paper)').attr('fill-opacity', 0.85)
            .attr('pointer-events', 'none')
            .text(fmt(n.value));
        }
      }

      circle.on('pointerenter', () => {
        motion.hold();
        for (const other of circles) {
          other.circle.style('opacity', other === rec ? 1 : (other.group === groupName ? 0.5 : 0.16));
        }
      });
      circle.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const ofGroup = groupTotal > 0 ? (100 * n.value) / groupTotal : 0;
        const ofAll = stats.total > 0 ? (100 * n.value) / stats.total : 0;
        tip.show(
          `<div style="color:${color}"><b>${n.data.name}</b></div>`
          + `<div><b>${fmt(n.value)}</b>${groupName && nested ? ` &middot; ${ofGroup.toFixed(0)}% of ${String(groupName).toLowerCase()}` : ''}</div>`
          + `<div style="opacity:.7">${ofAll.toFixed(ofAll < 10 ? 1 : 0)}% of the ${fmt(stats.total)} whole</div>`,
          px, py
        );
      });
      circle.on('pointerleave', () => {
        for (const other of circles) other.circle.style('opacity', '');
        tip.hide();
        motion.free();
      });
    }

    return null;
  },
});
