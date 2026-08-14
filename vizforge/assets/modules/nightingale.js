// NIGHTINGALE ROSE — the gallery's `unc-nightingale` ("The second wave of
// ChatGPT curiosity"), ported to take any cyclical category and a value.
//
// HONESTY, and it is the single rule that separates a rose from a pie chart
// drawn badly: RADIUS IS THE SQUARE ROOT OF THE VALUE, because the eye reads a
// petal's AREA. Scaling the radius directly makes a value four times its
// neighbour look sixteen times bigger, which is how this form got its bad
// reputation. Stated on the piece, every time.
//
// The second rule is about WHEN the form may be used at all: a rose implies the
// last step joins the first. Months, hours, weekdays — real cycles. The
// registry refuses it for a category that is merely a list, and names the
// alternative, because a ranked bar of a non-cycle is not a lesser chart, it is
// the correct one.

import { d3Piece, radialSideTable } from './d3-piece.js';
import { hierShape, hierRoles, hierNote, groupColors, colorOf } from './hier-shape.js';
import { resolveAccent, fitText, formatNumber } from './vf-core.js';

export const slug = 'nightingale';
export const roles = {
  angle: { types: ['nominal', 'ordinal'], required: true, label: 'Step in the cycle' },
  value: { types: ['quantitative'], required: true, label: 'Value' },
};
export const shape = (rows, bindings = {}) =>
  hierShape(rows, { levels: [bindings.angle || bindings.parent], value: bindings.value });

export default d3Piece({
  slug, title: 'Nightingale rose', roles, shape,
  build: 'petal',
  rest: 'wavebreathe',
  restSelect: '[data-vf-shimmer]',
  dur: 3400,
  aspect: 0.7,
  minHeight: 320,
  hoverNote: 'Hover a petal for its value.',

  headline(stats) {
    const g = stats.biggestGroup;
    if (!g) return 'Nothing in the cycle';
    return `${g.name} is the peak of the cycle at ${formatNumber(g.value)}`;
  },
  dek(stats) {
    const mean = stats.total / Math.max(1, stats.groupCount);
    return `${stats.groupCount} steps around the cycle, ${formatNumber(stats.total)} in total — `
      + `an average of ${formatNumber(mean)} a step.`;
  },
  note: (stats) => hierNote(stats,
    'a petal\'s AREA is the value, so the radius is its square root — reading the radius directly would '
    + 'exaggerate every difference'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const steps = data.children || [];
    if (!steps.length) return null;

    // THE ORDER IS THE DATA'S OWN. hier-shape sorts groups by value, which is
    // right for a treemap and wrong for a cycle: January must follow December,
    // not whichever month was busiest. `seq` is the arrival order.
    const ordered = [...steps].sort((a, b) => (a.seq || 0) - (b.seq || 0));

    const maxV = Math.max(...ordered.map((s) => s.value)) || 1;

    const star = stats.biggestGroup ? stats.biggestGroup.name : null;
    const palette = groupColors(stats, colors, { accent: resolveAccent(ctx.el), star });

    // THE CYCLE, IN ORDER, IN THE WIDTH THE ROSE CANNOT USE.
    //
    // Rows follow `seq`, NOT value — the same rule the petals obey. A rose's
    // subject is a cycle, so a table beside it that ranked the steps would be
    // reading the picture the one way the form refuses to be read, and the row
    // beside the twelve-o'clock petal would not be the first row.
    //
    // Share is stated because the eye cannot get it off a square-rooted radius:
    // that is the honest cost of an area encoding, and the reason the figures
    // belong here rather than only under a cursor.
    const roseBox = radialSideTable(ctx, {
      rimRoom: 34, // the step labels ring the outside of the rose
      columns: [
        { key: 'name', header: (stats.levels || [])[0] || 'step' },
        { key: 'value', header: stats.valueName || 'value' },
        { key: 'share', header: 'share', weight: 600 },
      ],
      rows: ordered.map((sp) => ({
        name: sp.name,
        colour: colorOf(palette, colors, sp.name),
        cells: {
          value: fmt(sp.value),
          share: `${Math.round((100 * sp.value) / (stats.total || 1))}%`,
        },
      })),
    });

    const cx = roseBox.cx;
    const cy = roseBox.split ? roseBox.cy : height / 2;
    const R = roseBox.outer;
    const hole = R * 0.16;
    // Square root, deliberately and visibly: area is the value.
    const radius = (v) => hole + (R - hole) * Math.sqrt(Math.max(0, v) / maxV);


    const g = sel.append('g').attr('transform', `translate(${cx},${cy})`).attr('data-vf-bloom', '');
    const step = (2 * Math.PI) / ordered.length;
    const arc = d3.arc().padAngle(0.008);

    // Value rings, so the square-root scale can actually be read off the piece.
    for (const frac of [0.25, 0.5, 1]) {
      const v = maxV * frac;
      sel.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', radius(v))
        .attr('fill', 'none').attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.12);
      sel.append('text')
        .attr('x', cx + 3).attr('y', cy - radius(v) - 3)
        .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
        .text(fmt(v));
    }

    const petals = [];
    ordered.forEach((s, i) => {
      const a0 = i * step - Math.PI / 2;
      const a1 = (i + 1) * step - Math.PI / 2;
      const colour = colorOf(palette, colors, s.name);
      const isStar = s.name === star;
      const p = g.append('path')
        .attr('d', arc({ startAngle: a0 + Math.PI / 2, endAngle: a1 + Math.PI / 2, innerRadius: hole, outerRadius: radius(s.value) }))
        .attr('fill', isStar ? 'var(--_accent)' : colour)
        .attr('fill-opacity', isStar ? 0.95 : 0.8)
        .attr('data-vf-shimmer', '')
        // THE CYCLE'S OWN ORDER, handed to the entrance. `i` is the step's
        // position in the cycle — January, then February — which is the order
        // the rose has to open in for the entrance to mean anything. It is not
        // recoverable from the path: a wedge crossing twelve o'clock has a
        // bounding box that sorts it to the wrong end.
        .attr('data-vf-petal', '')
        .attr('data-vf-order', i)
        .style('cursor', 'pointer');
      if (isStar) p.attr('data-vf-peak', '');
      const rec = { p, s };
      petals.push(rec);

      // The step's name outside its own petal, upright.
      const mid = (a0 + a1) / 2;
      const lr = R + 14;
      const label = fitText(s.name, 90, 11);
      if (label && ordered.length <= 32) {
        sel.append('text')
          .attr('x', cx + Math.cos(mid) * lr)
          .attr('y', cy + Math.sin(mid) * lr + 4)
          .attr('text-anchor', Math.cos(mid) > 0.25 ? 'start' : Math.cos(mid) < -0.25 ? 'end' : 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11)
          .attr('font-weight', isStar ? 700 : 500)
          .attr('fill', isStar ? 'var(--_accent)' : 'var(--_ink)')
          .attr('fill-opacity', isStar ? 1 : 0.75)
          .attr('pointer-events', 'none')
          .text(label);
      }

      p.on('pointerenter', () => {
        motion.hold();
        for (const other of petals) other.p.style('opacity', other === rec ? 1 : 0.25);
      });
      p.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        tip.show(
          `<div style="color:${colour}"><b>${s.name}</b></div>`
          + `<div><b>${fmt(s.value)}</b></div>`
          + `<div style="opacity:.7">${((100 * s.value) / (stats.total || 1)).toFixed(1)}% of the cycle's ${fmt(stats.total)}</div>`,
          px, py
        );
      });
      p.on('pointerleave', () => {
        for (const other of petals) other.p.style('opacity', '');
        tip.hide();
        motion.free();
      });
    });

    // THE ROSE OPENS BY GROWING ITS PETALS, not by scaling a finished picture.
    // A petal's LENGTH is its value (radius = sqrt of it), so extending the outer
    // radius from the hub outward is the encoding drawing itself. Scaling the
    // path instead shrinks the angular width too, which reads as a zoom.
    // Overshoot is deliberate and small: 1.6% past the true radius at t≈0.72,
    // settling back to exact. A petal that arrives and stops dead looks like a
    // slide transition; a petal that leans past and settles looks like it grew.
    const petalAt = (i, t) => {
      const rec = petals[i];
      if (!rec) return;
      const a0 = i * step - Math.PI / 2;
      const a1 = (i + 1) * step - Math.PI / 2;
      const eased = Math.max(0, Math.min(1, t));
      const overshoot = eased >= 1 ? 1 : 1 + 0.016 * Math.sin(Math.PI * eased);
      const full = radius(rec.s.value);
      const outer = hole + (full - hole) * eased * overshoot;
      rec.p.attr('d', arc({
        startAngle: a0 + Math.PI / 2,
        endAngle: a1 + Math.PI / 2,
        innerRadius: hole,
        outerRadius: Math.max(hole, outer),
      }));
    };

    return {
      origin: [cx, cy],
      sweep: {
        count: petals.length,
        apply(i, t) {
          if (i < 0) { for (let k = 0; k < petals.length; k += 1) petalAt(k, t); return; }
          petalAt(i, t);
        },
      },
    };
  },
});
