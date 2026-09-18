// SLOPE CHART (conv-slope) — two moments, one line each, and the crossings
// between them.
//
// WHAT THE FORM IS FOR. A line chart over many periods answers "what was the
// path". This answers a different and often more useful question: "who moved,
// who overtook whom, and did the field spread or close up". Reducing a series
// to its endpoints is what makes the crossings visible — on a twelve-point line
// chart with fifteen series, a rank change is lost in the tangle.
//
// HONESTY — this form's whole risk is in what it leaves out, so it is stated
// three times over rather than once:
//
//   1. ONLY THE TWO ENDS ARE MEASURED. The segment drawn between them is a
//      CONNECTOR, not a path: nothing claims the change was linear, or
//      monotonic, or that a line did not cross back and forth in between. Where
//      the table held more than two periods the source line says so and names
//      how many were passed over.
//   2. THE AXIS INCLUDES ZERO unless the data itself goes negative, because the
//      eye reads the STEEPNESS of these segments as the size of the change and
//      a clipped baseline exaggerates every slope on the chart at once.
//   3. BOTH COLUMNS SHARE ONE SCALE. Two independently-scaled axes would let
//      any pair of series be made to cross, or not cross, by choice of scale —
//      which is the classic dual-axis lie wearing a different hat.
//
// COLOUR CARRIES STATE, and the state worth carrying is WHICH SERIES THIS CHART
// IS ABOUT — the biggest mover, the one the headline names. Direction was tried
// here first (risers accented, fallers in ink) and it fails on the common case:
// over gapminder every continent rises, so every line took the accent and the
// colour stopped distinguishing anything. Direction is already encoded by the
// slope itself, and encoding it twice buys nothing. One hue per category would
// be a rainbow restating names already printed at both ends.
//
// THE ENTRANCE traces each segment from its left endpoint to its right, so the
// direction of travel is what arrives. The dots at both ends are already in
// place when their line starts drawing: the two measured facts precede the
// inference drawn between them.

import { d3Piece } from './d3-piece.js';
import { catShape, catRoles, catNote } from './cat-shape.js';
import { formatNumber, fitText, resolveAccent, lengthDomain, positionDomain } from './vf-core.js';

export const slug = 'slope';
export const roles = {
  category: { ...catRoles.category, label: 'Series (one line each)' },
  value: { types: ['quantitative'], required: true, label: 'Value at each end' },
  series: { types: ['nominal', 'ordinal', 'temporal'], required: true, label: 'Period (first and last are used)' },
};
export const shape = catShape;

export default d3Piece({
  slug, title: 'Slope chart', roles, shape,
  build: 'trace',
  rest: 'peak',
  dur: 3200,
  aspect: 0.62,
  minHeight: 280,
  hoverNote: 'Hover a line for both its values and the change.',

  headline(stats, state) {
    const p = periods(stats);
    if (!p) return 'Not enough periods to draw a slope';
    const moves = changes(state.data, p);
    if (!moves.length) return 'No series spans both periods';
    const biggest = [...moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    const dir = biggest.delta >= 0 ? 'rose' : 'fell';
    return `${biggest.name} ${dir} ${Math.abs(Math.round(biggest.pct))}% between ${p.first} and ${p.last}`;
  },
  dek(stats, state) {
    const p = periods(stats);
    if (!p) return '';
    const moves = changes(state.data, p);
    const up = moves.filter((m) => m.delta > 0).length;
    const down = moves.filter((m) => m.delta < 0).length;
    const crossings = countCrossings(moves);
    return `${moves.length} series, ${p.first} to ${p.last} — ${up} up, ${down} down`
      + (crossings ? `, ${crossings} ${crossings === 1 ? 'crossing' : 'crossings'}.` : ', no change in order.');
  },
  note: (stats) => {
    const p = periods(stats);
    const skipped = p && p.skipped;
    return catNote(stats,
      'only the two ends are measured — the segment between them is a connector and claims nothing '
      + 'about the path taken'
      + (skipped ? `, and ${skipped} intermediate ${skipped === 1 ? 'period is' : 'periods are'} not drawn` : ''));
  },

  draw(ctx) {
    const { sel, width, height, data, stats, tip, motion, el } = ctx;
    const p = periods(stats);
    if (!p) return null;
    const moves = changes(data, p);
    if (!moves.length) return null;

    const accent = resolveAccent(el);
    const lead = [...moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    const values = moves.flatMap((m) => [m.from, m.to]);
    // Zero-anchored unless the data itself crosses it — steepness is the read
    // here, and a clipped baseline exaggerates every slope on the chart at once.
    const dom = values.some((v) => v < 0) ? positionDomain(values).domain : lengthDomain(values);

    // The gutter has to hold a name AND its value on one line at both ends —
    // sizing it from the name alone truncated "Americas" to "Ameri..." beside a
    // number that was never drawn at all.
    const longest = Math.max(...moves.map((m) => String(m.name).length));
    const widestVal = Math.max(...values.map((v) => formatNumber(v).length));
    const gutter = Math.min(230, Math.max(92, longest * 6.6 + widestVal * 6.6 + 26));
    const nameRoom = gutter - widestVal * 6.6 - 22;
    const m = { top: 34, bottom: 30, left: gutter, right: gutter };
    const xa = m.left;
    const xb = width - m.right;
    const y = (v) => {
      const t = (v - dom[0]) / (dom[1] - dom[0] || 1);
      return height - m.bottom - t * (height - m.top - m.bottom);
    };

    // The two moments, named at the top where the columns actually are.
    for (const [x, label, anchor] of [[xa, p.first, 'end'], [xb, p.last, 'start']]) {
      sel.append('text')
        .attr('x', x + (anchor === 'end' ? -10 : 10)).attr('y', m.top - 14)
        .attr('text-anchor', anchor)
        .attr('font-family', 'var(--_fl)').attr('font-size', 12).attr('font-weight', 600)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.9)
        .text(String(label));
      sel.append('line')
        .attr('x1', x).attr('x2', x).attr('y1', m.top - 6).attr('y2', height - m.bottom)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.16);
    }

    // Label rows are de-collided independently at each end: two series a tenth
    // of a percent apart would otherwise print one name on top of the other and
    // read as a single mislabelled line.
    const place = (side) => {
      const MIN = 15;
      const rows = moves
        .map((mv, i) => ({ i, name: mv.name, v: side === 'from' ? mv.from : mv.to, y: y(side === 'from' ? mv.from : mv.to) }))
        .sort((a, b) => a.y - b.y);
      for (let k = 1; k < rows.length; k += 1) {
        if (rows[k].y - rows[k - 1].y < MIN) rows[k].y = rows[k - 1].y + MIN;
      }
      const over = rows.length ? rows[rows.length - 1].y - (height - m.bottom) : 0;
      if (over > 0) for (const r of rows) r.y -= over;
      const out = new Map();
      for (const r of rows) out.set(r.i, r.y);
      return out;
    };
    const leftRows = place('from');
    const rightRows = place('to');

    const marks = [];
    moves.forEach((mv, i) => {
      // State, never identity: the one the headline is about takes the accent.
      const isLead = lead && mv.name === lead.name;
      const color = isLead ? accent : 'var(--_ink)';
      const opacity = isLead ? 1 : 0.5;
      const y1 = y(mv.from);
      const y2 = y(mv.to);

      const g = sel.append('g').style('cursor', 'pointer');
      const line = g.append('line')
        .attr('x1', xa).attr('y1', y1).attr('x2', xb).attr('y2', y2)
        .attr('stroke', color).attr('stroke-opacity', opacity)
        .attr('stroke-width', isLead ? 2.4 : 1.6)
        .attr('data-vf-part', 'connector');
      for (const [cx, cy] of [[xa, y1], [xb, y2]]) {
        g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 3.6)
          .attr('fill', color).attr('fill-opacity', opacity)
          .attr('data-vf-part', 'endpoint');
      }

      const ly = leftRows.get(i);
      const ry = rightRows.get(i);
      const label = (x, yy, anchor, text, weightAt) => g.append('text')
        .attr('x', x).attr('y', yy).attr('text-anchor', anchor).attr('dominant-baseline', 'middle')
        .attr('font-family', weightAt === 'value' ? 'var(--_ff)' : 'var(--_fl)')
        .attr('font-size', weightAt === 'value' ? 10.5 : 11.5)
        .attr('font-weight', isLead && weightAt !== 'value' ? 600 : 400)
        .attr('fill', isLead ? color : 'var(--_ink)')
        .attr('fill-opacity', weightAt === 'value' ? 0.58 : (isLead ? 1 : 0.82))
        .text(text);
      // Value nearest the axis, name outside it, at both ends.
      label(xa - 12, ly, 'end', formatNumber(mv.from), 'value');
      label(xa - 12 - widestVal * 6.6 - 8, ly, 'end', fitText(mv.name, nameRoom, 11.5), 'name');
      label(xb + 12, ry, 'start', formatNumber(mv.to), 'value');
      label(xb + 12 + widestVal * 6.6 + 8, ry, 'start', fitText(mv.name, nameRoom, 11.5), 'name');

      marks.push({ g, line, mv });

      g.on('pointerenter', () => {
        motion.hold();
        for (const o of marks) {
          o.g.attr('opacity', o.mv === mv ? 1 : 0.2);
        }
        const sign = mv.delta >= 0 ? '+' : '−';
        tip.show(
          `<div><b>${mv.name}</b></div>`
          + `<div>${p.first} <b>${formatNumber(mv.from)}</b> &rarr; ${p.last} <b>${formatNumber(mv.to)}</b></div>`
          + `<div>${sign}${formatNumber(Math.abs(mv.delta))} (${sign}${Math.abs(mv.pct).toFixed(1)}%)</div>`,
          (xa + xb) / 2, (y1 + y2) / 2,
        );
      });
      g.on('pointerleave', () => {
        for (const o of marks) o.g.attr('opacity', 1);
        tip.hide();
      });
    });

    return null;
  },
});

/** The two moments this chart is drawn between, and what was passed over. */
function periods(stats) {
  const names = stats && Array.isArray(stats.seriesNames) ? stats.seriesNames : [];
  if (names.length < 2) return null;
  return { first: names[0], last: names[names.length - 1], skipped: names.length - 2 };
}

/** One record per series that has a value at BOTH ends — a line needs two points. */
function changes(rows, p) {
  const out = [];
  for (const d of rows || []) {
    const from = d.parts.find((x) => x.name === p.first);
    const to = d.parts.find((x) => x.name === p.last);
    if (!from || !to) continue;
    const delta = to.value - from.value;
    out.push({
      name: d.name,
      from: from.value,
      to: to.value,
      delta,
      pct: from.value === 0 ? 0 : (delta / Math.abs(from.value)) * 100,
    });
  }
  return out;
}

/** How many pairs actually swap order between the two ends — the form's point. */
function countCrossings(moves) {
  let n = 0;
  for (let i = 0; i < moves.length; i += 1) {
    for (let j = i + 1; j < moves.length; j += 1) {
      const a = moves[i];
      const b = moves[j];
      if ((a.from - b.from) * (a.to - b.to) < 0) n += 1;
    }
  }
  return n;
}
