// PROGRESS RINGS (conv-gauge) — the dashboard donut, one ring per category,
// every ring a share of the SAME whole.
//
// WHY THIS IS NOT THE PIE MODULE. A pie divides one circle into slices and asks
// the eye to compare angles that start at different clock positions, which is
// the weakest comparison the form offers — `pie.js` says so itself and its
// registry rule refuses past eight slices. This form asks a narrower question
// and answers it better: each category gets its OWN ring, every ring starts at
// twelve o'clock, and every ring is drawn against the same total. Comparing
// two arcs that begin at the same angle on circles of the same radius is a
// comparison the eye can actually make.
//
// HONESTY, and the three things that make this form lie when they slip:
//
//   1. ONE SHARED WHOLE. Every ring divides the same total, so the arcs are
//      commensurable. A grid of rings each scaled to its own max is the common
//      dashboard lie — four rings all nearly full, describing four quantities
//      with nothing in common. The total is printed once, above the grid.
//   2. THE ARC IS THE ENCODING, and arc length is proportional to share
//      because every ring shares one radius. Nothing here scales a radius by
//      value: doubling a radius quadruples the ink for twice the number.
//   3. THE NUMBER IS PRINTED IN EVERY RING. Angle is a weak read even at its
//      best, so no reading here has to depend on it.
//
// COLOUR CARRIES STATE, NOT IDENTITY. Every ring is drawn in the same channel
// and only the largest takes the accent. One hue per category would be a
// rainbow enumerating lanes that are already named by their own labels — the
// flaw `/house` and `/a reviewer` independently flagged on the An earlier piece pieces.
//
// THE ENTRANCE opens each arc through its own angle from twelve o'clock, in
// size order, handing the sweep to the harness rather than letting `ring`
// scale a finished path — an arc's ANGLE is its value, so the angle is what
// has to arrive. Same contract the pie and the sunburst use.

import { d3Piece } from './d3-piece.js';
import { catShape, catRoles, catNote } from './cat-shape.js';
import { formatNumber, fitText, resolveAccent } from './vf-core.js';

export const slug = 'gauge';
export const roles = { ...catRoles };
export const shape = catShape;

// Past this many rings each one is too small to hold its own number, which is
// the one thing this form promises. The registry refuses there and names the
// bar chart, so this is a floor under a rule stated elsewhere rather than a
// second opinion about it.
const MAX_RINGS = 8;

export default d3Piece({
  slug, title: 'Progress rings', roles, shape,
  build: 'ring',
  rest: 'peak',
  dur: 3200,
  aspect: 0.5,
  minHeight: 240,
  hoverNote: 'Hover a ring for its exact value.',

  headline(stats) {
    const b = stats.biggest;
    if (!b) return 'No shares to draw';
    const unit = stats.counting ? 'rows' : stats.valueName;
    return `${b.name} takes ${Math.round(b.share * 100)}% of the ${formatNumber(stats.total)} ${unit}`;
  },
  dek(stats) {
    const unit = stats.counting ? 'rows' : stats.valueName;
    return `${stats.categoryCount} ${stats.categoryCount === 1 ? 'ring' : 'rings'}, `
      + `each one a share of the same ${formatNumber(stats.total)} ${unit}.`;
  },
  note: (stats) => catNote(stats,
    'every ring divides the SAME total and every ring has the same radius, so the arcs can be '
    + 'compared directly — a grid of rings each scaled to its own maximum would read the same way '
    + 'and mean nothing'),

  draw(ctx) {
    const { sel, width, height, data, stats, tip, motion, el, setCopy } = ctx;
    if (!data.length || !(stats.total > 0)) return null;

    const accent = resolveAccent(el);
    const rings = data.slice(0, MAX_RINGS);
    // Never drop a category in silence. If the table brought more than the form
    // can hold, the dek says so on the picture itself rather than in a caption
    // somewhere else.
    setCopy({
      dekAppend: data.length > MAX_RINGS
        ? `${data.length - MAX_RINGS} smaller ${data.length - MAX_RINGS === 1 ? 'category is' : 'categories are'} not drawn.`
        : '',
    });

    // THE SMALL VARIANT IS A DIFFERENT PICTURE, not this one scaled down (§6).
    // In a short box the footer restating the whole is the first thing to go —
    // the dek above the plot already names the total, so dropping it here costs
    // the reader nothing and buys the rings real radius. What never goes is the
    // percentage inside each ring: that is the form's promise.
    const roomy = height >= 150;
    const top = 14;
    const bottom = roomy ? 34 : 6;
    const usableH = Math.max(60, height - top - bottom);

    // LAY THE GRID OUT FROM THE BOX, not from a column count picked in advance.
    // The cell has to hold a ring plus two lines of type under it, so the
    // candidate that wins is the one giving the largest ring that still leaves
    // room for the label — which is a different answer at 320px than at 1200px.
    const LABEL_ROOM = 34;
    let best = null;
    for (let cols = 1; cols <= rings.length; cols += 1) {
      const rows = Math.ceil(rings.length / cols);
      const cw = width / cols;
      const ch = usableH / rows;
      const r = Math.min(cw * 0.42, (ch - LABEL_ROOM) * 0.5);
      if (r > 14 && (!best || r > best.r)) best = { cols, rows, cw, ch, r };
    }
    if (!best) best = { cols: rings.length, rows: 1, cw: width / rings.length, ch: usableH, r: 16 };
    const { cols, cw, ch, r } = best;

    // A ring thin enough to read as a ring, thick enough to see at 16px radius.
    const band = Math.max(5, Math.min(18, r * 0.26));
    const inner = r - band;

    const arcPath = (cx, cy, t) => {
      // Hand-rolled so this module keeps d3-arc out of its dependency surface:
      // one sweep from twelve o'clock, clockwise, as two arcs so a full circle
      // never collapses to a zero-length path.
      const a = Math.max(0, Math.min(1, t)) * Math.PI * 2;
      if (a <= 0) return '';
      const pts = (ang, rad) => [cx + Math.sin(ang) * rad, cy - Math.cos(ang) * rad];
      const big = a > Math.PI ? 1 : 0;
      const [ox, oy] = pts(0, r);
      const [ex, ey] = pts(a, r);
      const [ix, iy] = pts(a, inner);
      const [nx, ny] = pts(0, inner);
      // A complete ring has coincident ends, so it is drawn as two half sweeps.
      if (a >= Math.PI * 2 - 1e-6) {
        const [hx, hy] = pts(Math.PI, r);
        const [hix, hiy] = pts(Math.PI, inner);
        return `M${ox} ${oy}A${r} ${r} 0 0 1 ${hx} ${hy}A${r} ${r} 0 0 1 ${ox} ${oy}`
          + `M${nx} ${ny}A${inner} ${inner} 0 0 0 ${hix} ${hiy}A${inner} ${inner} 0 0 0 ${nx} ${ny}`;
      }
      return `M${ox} ${oy}A${r} ${r} 0 ${big} 1 ${ex} ${ey}L${ix} ${iy}A${inner} ${inner} 0 ${big} 0 ${nx} ${ny}Z`;
    };

    const gridH = best.rows * ch;
    const y0 = top + (usableH - gridH) / 2;
    const marks = [];

    rings.forEach((d, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * cw + cw / 2;
      const cy = y0 + row * ch + (ch - LABEL_ROOM) / 2;
      const share = d.value / stats.total;
      // Only the leader is accented. Colour is state here — which one is
      // biggest — and never an enumeration of the categories.
      const isLead = stats.biggest && d.name === stats.biggest.name;
      const color = isLead ? accent : 'var(--_ink)';
      const fillOpacity = isLead ? 0.95 : 0.55;

      const g = sel.append('g');

      // THE TRACK: the whole this share is a share OF, drawn so the unfilled
      // part of the claim is visible rather than implied by absence.
      g.append('path')
        .attr('d', arcPath(cx, cy, 1))
        .attr('fill', 'var(--_ink)')
        .attr('fill-opacity', 0.07);

      const path = g.append('path')
        .attr('d', arcPath(cx, cy, share))
        .attr('fill', color)
        .attr('fill-opacity', fillOpacity)
        .attr('data-vf-arc', '')
        .attr('data-vf-ring', '0')
        .attr('data-vf-order', String(i))
        .attr('data-vf-part', 'arc')
        .style('cursor', 'pointer');
      marks.push({ path, cx, cy, share });

      // THE NUMBER, inside the ring. The percentage is what the arc encodes, so
      // that is what goes in the middle; the raw value sits under it wherever
      // the hole is tall enough to hold a second line honestly.
      const pct = Math.round(share * 100);
      const pctSize = Math.min(30, Math.max(11, inner * 0.62));
      g.append('text')
        .attr('x', cx).attr('y', cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('dy', inner > 26 ? '-0.22em' : '0')
        .attr('font-family', 'var(--_fh)')
        .attr('font-size', pctSize)
        .attr('font-weight', 700)
        .attr('fill', 'var(--_ink)')
        .attr('pointer-events', 'none')
        .text(`${pct}%`);
      if (inner > 26) {
        g.append('text')
          .attr('x', cx).attr('y', cy)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('dy', '0.95em')
          .attr('font-family', 'var(--_ff)')
          .attr('font-size', Math.min(12, inner * 0.3))
          .attr('fill', 'var(--_ink)')
          .attr('fill-opacity', 0.6)
          .attr('pointer-events', 'none')
          .text(formatNumber(d.value));
      }

      // THE NAME, under the ring, clipped to the cell it belongs to rather than
      // to a guess — two neighbouring labels that collide read as one word.
      g.append('text')
        .attr('x', cx).attr('y', cy + r + 20)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_fl)')
        .attr('font-size', 12)
        .attr('font-weight', isLead ? 600 : 400)
        .attr('fill', 'var(--_ink)')
        .attr('fill-opacity', isLead ? 1 : 0.8)
        .attr('pointer-events', 'none')
        .text(fitText(d.name, cw - 10, 12));

      const enter = () => {
        motion.hold();
        for (const m of marks) m.path.attr('fill-opacity', m.path === path ? 1 : 0.15);
        tip.show(
          `<div><b>${d.name}</b></div>`
          + `<div>${formatNumber(d.value)} of ${formatNumber(stats.total)}`
          + ` &middot; <b>${(share * 100).toFixed(1)}%</b></div>`,
          cx, cy,
        );
      };
      const leave = () => {
        for (const m of marks) {
          const lead = stats.biggest && rings[marks.indexOf(m)]
            && rings[marks.indexOf(m)].name === stats.biggest.name;
          m.path.attr('fill-opacity', lead ? 0.95 : 0.55);
        }
        tip.hide();
      };
      path.on('pointerenter', enter).on('pointerleave', leave);
    });

    // The shared whole, stated once. Without this the grid is a set of
    // percentages with no denominator on the picture — so it is only dropped
    // where the dek immediately above is carrying the same sentence.
    if (roomy) sel.append('text')
      .attr('x', width / 2).attr('y', height - 12)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'var(--_ff)')
      .attr('font-size', 11)
      .attr('fill', 'var(--_ink)')
      .attr('fill-opacity', 0.55)
      .text(`each ring is a share of ${formatNumber(stats.total)} ${stats.counting ? 'rows' : stats.valueName}`);

    return {
      origin: [width / 2, height / 2],
      sweep: {
        count: marks.length,
        apply(i, t) {
          const at = (k, tt) => {
            const m = marks[k];
            if (m) m.path.attr('d', arcPath(m.cx, m.cy, m.share * Math.max(0, Math.min(1, tt))));
          };
          if (i < 0) { for (let k = 0; k < marks.length; k += 1) at(k, t); return; }
          at(i, t);
        },
      },
    };
  },
});
