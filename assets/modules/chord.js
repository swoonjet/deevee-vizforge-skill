// CHORD — the gallery's `unc-chord` ("Languages that live together") and its
// interactive sibling `int-chord`, ported to take any pair-and-strength table.
//
// HONESTY: ribbon width is the strength of the pair and NOTHING ELSE IS. The
// order of the arcs around the ring is arbitrary — it is whatever order the
// names arrived in — so two neighbours are not related by being neighbours,
// and the piece says so. That is also why isolation matters here more than in
// most forms: with thirty ribbons crossing the middle, picking one member out
// is the only reliable way to read it, which is what int-chord is for.
//
// A pair that appears in both directions (A→B and B→A) keeps both halves: the
// matrix is directed, and d3.chord draws the two sides of a ribbon from the two
// cells. Where only one direction exists the ribbon is simply lopsided, which
// is the truth about that data rather than a defect.

import { d3Piece, radialSideTable } from './d3-piece.js';
import { edgeShape, edgeRoles, edgeDek, edgeNote, nodeColors } from './edge-shape.js';
import { resolveAccent, formatNumber, fitText, ifLive} from './vf-core.js';

export const slug = 'chord';
export const roles = { ...edgeRoles, value: { ...edgeRoles.value, required: true, label: 'Strength' } };
export const shape = edgeShape;

/**
 * The whole ring's finding. Named rather than inlined into the spec because
 * coming BACK from an isolation has to restore it — leaving "Trial: 3 bonds"
 * standing over the complete ring describes a picture that is no longer on
 * screen, which is the fault stream.js already guards against by name.
 */
function chordHeadline(stats) {
  const l = stats.biggestLink;
  if (!l) return `${stats.nodeCount} members, no bonds between them`;
  return `${l.sourceName} and ${l.targetName} are the strongest bond, at ${formatNumber(l.value)}`;
}

export default d3Piece({
  slug, title: 'Chord', roles, shape,
  build: 'ring',
  rest: (config) => (config && config.isolate ? 'attract' : 'wavebreathe'),
  restSelect: '[data-vf-shimmer]',
  dur: 4200,
  aspect: 0.72,
  minHeight: 320,
  hoverNote: (config) => (config && config.isolate
    ? 'Hover a ribbon for the exact pair; click a member to keep only its own bonds.'
    : 'Hover a ribbon for the exact pair.'),

  headline: chordHeadline,
  dek: edgeDek,
  note: (stats) => edgeNote(stats,
    'ribbon width is the strength of that pair — the order of the arcs around the ring is arbitrary and means nothing'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.links.length) return null;

    const isolate = Boolean(config.isolate);
    const focus = isolate && view.member !== undefined && view.member !== null ? view.member : null;

    const names = stats.nodeNames;
    const star = stats.biggestLink ? stats.biggestLink.sourceName : null;
    const palette = nodeColors(stats, colors, { accent: resolveAccent(ctx.el), star });
    const colourOf = (i) => palette.get(names[i]) || colors[0];

    // EACH MEMBER'S OUT AND IN, in the width a ring cannot use.
    //
    // A ring was reaching 31% of the plot width. What belongs in the rest is the
    // one thing the geometry genuinely cannot show: DIRECTION. A ribbon's width is
    // the strength of a pair and its two ends are drawn alike, so "how much left
    // this member and how much arrived at it" was available only under a cursor —
    // and this piece deliberately does not enforce conservation, which makes those
    // two numbers a reading rather than a decoration.
    //
    // Ranked by weight, not by ring position: this form's own refusal past twelve
    // members says the order around the circle carries nothing, so ordering the
    // rows by it would be inventing a sequence. The swatch and the hover are the
    // link instead.
    const members = [...data.nodes].sort((a, b) => b.total - a.total);
    const chordBox = radialSideTable(ctx, {
      rimRoom: 30, // the member labels ring the outside
      columns: [
        { key: 'name', header: 'member' },
        { key: 'out', header: 'out' },
        { key: 'in', header: 'in' },
      ],
      rows: members.map((n) => ({
        name: n.name,
        colour: palette.get(n.name) || colors[0],
        cells: { out: n.out ? fmt(n.out) : '—', in: n.in ? fmt(n.in) : '—' },
      })),
    });

    const cx = chordBox.cx;
    const cy = chordBox.split ? chordBox.cy : height / 2;
    const R = Math.max(50, chordBox.outer);
    const inner = R - 16;

    const chord = d3.chord().padAngle(0.045).sortSubgroups(d3.descending)(data.matrix);
    const arc = d3.arc().innerRadius(inner).outerRadius(R);
    const ribbon = d3.ribbon().radius(inner - 3);

    const g = sel.append('g').attr('transform', `translate(${cx},${cy})`);
    const ribbons = [];

    // Ribbons under the arcs, smallest first so the heaviest bond lands on top
    // — and, through data-vf-order, arrives last in the entrance.
    const ordered = [...chord].sort((a, b) => a.source.value - b.source.value);
    ordered.forEach((d, i) => {
      const lit = focus === null || d.source.index === focus || d.target.index === focus;
      const colour = colourOf(d.source.value >= d.target.value ? d.source.index : d.target.index);
      const p = g.append('path')
        .attr('d', ribbon(d))
        .attr('fill', colour)
        .attr('fill-opacity', lit ? 0.55 : 0.06)
        .attr('stroke', 'var(--_paper)').attr('stroke-width', 0.6)
        .attr('data-vf-arc', '').attr('data-vf-ring', 1).attr('data-vf-order', i)
        .attr('data-vf-shimmer', '')
        // The isolation STATE, separate from the paint — see sankey.js.
        .attr('data-vf-lit', lit ? 1 : 0)
        .style('cursor', 'pointer');
      const rec = { p, d, lit, colour };
      ribbons.push(rec);

      p.on('pointerenter', () => {
        motion.hold();
        for (const other of ribbons) other.p.attr('fill-opacity', other === rec ? 0.9 : 0.05);
      });
      p.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const a = names[d.source.index];
        const b = names[d.target.index];
        const both = d.source.value + (d.source.index === d.target.index ? 0 : d.target.value);
        tip.show(
          `<div style="color:${colour}"><b>${a} ↔ ${b}</b></div>`
          + `<div><b>${fmt(d.source.value)}</b> from ${a}`
          + (d.source.index === d.target.index ? '' : ` &middot; <b>${fmt(d.target.value)}</b> from ${b}`)
          + '</div>'
          + `<div style="opacity:.7">${((100 * both) / (stats.total || 1)).toFixed(1)}% of all ${fmt(stats.total)}</div>`,
          px, py
        );
      });
      p.on('pointerleave', () => {
        for (const other of ribbons) other.p.attr('fill-opacity', other.lit ? 0.55 : 0.06);
        tip.hide();
        motion.free();
      });
    });

    // The ring itself, plus a label per member.
    const groups = [];
    chord.groups.forEach((gp, i) => {
      const lit = focus === null || gp.index === focus;
      const colour = colourOf(gp.index);
      const isFocus = gp.index === focus;
      const p = g.append('path')
        .attr('d', arc(gp))
        .attr('fill', isFocus ? 'var(--_accent)' : colour)
        .attr('fill-opacity', lit ? 1 : 0.22)
        .attr('data-vf-arc', '').attr('data-vf-ring', 0).attr('data-vf-order', i)
        .style('cursor', isolate ? 'pointer' : 'default');
      groups.push({ p, gp, lit });

      const mid = (gp.startAngle + gp.endAngle) / 2 - Math.PI / 2;
      const right = Math.cos(mid) > 0;
      const room = Math.min(150, (width - 2 * R) / 2 + 26);
      // A LABEL NEEDS AN ARC TO BELONG TO. Below about a line of text the arcs
      // are thinner than their own names, and half a dozen of them pile into
      // one illegible smudge at the top of the ring — pointing, between them,
      // at nothing. Those members answer on hover instead.
      const arcLength = (gp.endAngle - gp.startAngle) * R;
      const label = arcLength >= 15 ? fitText(names[gp.index], room, 12.5) : null;
      if (label) {
        g.append('text')
          .attr('x', Math.cos(mid) * (R + 10))
          .attr('y', Math.sin(mid) * (R + 10) + 4)
          .attr('text-anchor', right ? 'start' : 'end')
          .attr('font-family', 'var(--_fl)').attr('font-size', 12.5).attr('font-weight', 600)
          .attr('fill', isFocus ? 'var(--_accent)' : colour)
          .attr('fill-opacity', lit ? 1 : 0.3)
          .attr('pointer-events', 'none')
          .text(label);
      }

      p.on('pointerenter', () => {
        motion.hold();
        for (const other of ribbons) {
          const touches = other.d.source.index === gp.index || other.d.target.index === gp.index;
          other.p.attr('fill-opacity', touches ? 0.85 : 0.05);
        }
      });
      p.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const node = data.nodes[gp.index];
        const strongest = data.links
          .filter((l) => l.source === gp.index || l.target === gp.index)
          .sort((a, b) => b.value - a.value)[0];
        tip.show(
          `<div style="color:${colourOf(gp.index)}"><b>${names[gp.index]}</b></div>`
          + `<div>total <b>${fmt(node.total)}</b> across ${node.degree} bonds</div>`
          + (strongest
            ? `<div style="opacity:.7">strongest: ${strongest.sourceName === names[gp.index]
              ? strongest.targetName : strongest.sourceName} (${fmt(strongest.value)})</div>`
            : ''),
          px, py
        );
      });
      p.on('pointerleave', () => {
        for (const other of ribbons) other.p.attr('fill-opacity', other.lit ? 0.55 : 0.06);
        tip.hide();
        motion.free();
      });

      if (isolate) {
        p.on('click', () => {
          tip.hide();
          view.member = isFocus ? null : gp.index;
          motion.replay();
          ctx.redraw();
        });
      }
    });

    if (isolate) {
      const name = focus === null ? null : names[focus];
      ctx.trail(focus === null ? null : {
        label: 'Every bond',
        crumbs: `${name} only`,
        onHome() {
          tip.hide();
          view.member = null;
          motion.replay();
          ctx.redraw();
        },
      });

      if (focus === null) {
        ctx.setCopy({
          headline: chordHeadline(stats),
          dek: `${edgeDek(stats)}${ifLive(config, ' Click a member to keep only its own bonds.')}`,
        });
      } else {
        const node = data.nodes[focus];
        ctx.setCopy({
          headline: node.degree === 1
            ? `${name}: one bond, ${fmt(node.total)} across it`
            : `${name}: ${node.degree} bonds, ${fmt(node.total)} between them`,
          dek: `${((100 * node.total) / (stats.total || 1)).toFixed(1)}% of the ${fmt(stats.total)} in the whole ring. `
            + 'Every other ribbon is still drawn, faintly, at the same scale.'
            + ifLive(config, ' Click again to bring them back.'),
        });
      }
    }

    let attract;
    if (isolate && groups.length > 2) {
      const order = [...groups].sort((a, b) => b.gp.value - a.gp.value).slice(0, 6);
      attract = {
        count: order.length,
        apply(i, amp) {
          const gp = order[i].gp;
          for (const other of ribbons) {
            const touches = other.d.source.index === gp.index || other.d.target.index === gp.index;
            other.p.attr('fill-opacity', touches ? 0.55 + 0.3 * amp : Math.max(0.05, 0.55 - 0.45 * amp));
          }
        },
        clear() { for (const other of ribbons) other.p.attr('fill-opacity', other.lit ? 0.55 : 0.06); },
      };
    }

    // THE BONDS REACH OUT FROM THE HUB; THE RING OPENS THROUGH ITS ANGLE.
    //
    // Two different marks, so two different geometries, which is exactly what the
    // old motion flattened: everything faded in together with an 8% float, and a
    // chord's whole subject — pairs reaching across a ring — was invisible in it.
    //
    //   A MEMBER ARC is a wedge, so it opens from its own start angle.
    //   A RIBBON is anchored at a radius, so interpolating that radius from the
    //   centre outward makes the bond grow from the middle to its two endpoints.
    //     d3.ribbon().radius(0) collapses a ribbon to the hub, which is the
    //     honest zero state for "this pair is not drawn yet".
    //
    // INDEXED BY DOM ORDER, because that is what the ring build enumerates and
    // hands back to apply(i, t). Ribbons are appended before the arcs so the
    // heaviest bond sits under the ring, so the order here is ribbons then arcs.
    const marks = [
      ...ribbons.map((rec) => ({ kind: 'ribbon', rec })),
      ...groups.map((rec) => ({ kind: 'arc', rec })),
    ];
    const markAt = (i, t) => {
      const m = marks[i];
      if (!m) return;
      const e = Math.max(0, Math.min(1, t));
      if (m.kind === 'arc') {
        const { gp } = m.rec;
        m.rec.p.attr('d', arc({
          ...gp,
          startAngle: gp.startAngle,
          endAngle: gp.startAngle + (gp.endAngle - gp.startAngle) * e,
        }));
        return;
      }
      // A ribbon at radius 0 is a point at the hub; ease it out to the ring.
      m.rec.p.attr('d', d3.ribbon().radius(Math.max(0, (inner - 3) * e))(m.rec.d));
    };

    return {
      origin: [cx, cy],
      attract,
      sweep: {
        count: marks.length,
        apply(i, t) {
          if (i < 0) { for (let k = 0; k < marks.length; k += 1) markAt(k, t); return; }
          markAt(i, t);
        },
      },
    };
  },
});
