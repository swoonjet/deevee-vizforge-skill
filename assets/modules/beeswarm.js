// BEESWARM (unc-beeswarm) — every observation keeps its own dot, and the pile
// is resolved by moving dots sideways instead of hiding them.
//
// WHAT IT IS FOR, and how it differs from its neighbours in this library. A
// histogram bins, so individual rows stop existing. A box-and-violin summarises,
// so a bimodal group and a flat one can draw the same box. A dot strip plots
// every row honestly but lets dense regions overplot into a single dark smear.
// The beeswarm keeps every row AND keeps every row visible: where two dots would
// collide, the later one steps perpendicular to the value axis until it clears.
//
// THE ONE THING THAT MAKES THIS FORM LIE, stated in the source line on every
// render: THE PERPENDICULAR OFFSET CARRIES NO VALUE. A dot pushed far off the
// centre line is not bigger, later, or more important — it is in a crowd. Only
// the position ALONG the value axis is data. This is the same disclosure the
// raincloud makes about the spread in its rain, for the same reason, and it is
// the reason the offset is drawn symmetrically about the line rather than
// stacked upward like a histogram: an upward stack reads as a bar and invites
// exactly the reading that would be wrong.
//
// WHAT IS NEVER DROPPED. Every bound row gets a dot. Where a group is too dense
// for its band the dots keep stepping outward and the band grows to hold them
// rather than the tail being clipped — a beeswarm that silently drops its
// crowded middle has thrown away the only thing it was built to show.
//
// THE ENTRANCE rains the dots in along the value axis, in value order, so the
// distribution assembles left to right rather than appearing all at once.

import { d3Piece } from './d3-piece.js';
import { catShape, catRoles } from './cat-shape.js';
import {
  formatNumber, fitText, resolveAccent, positionDomain, linearScale, axisTicks,
} from './vf-core.js';

export const slug = 'beeswarm';
export const roles = {
  category: { ...catRoles.category, required: false, label: 'Group (one row each)' },
  value: { types: ['quantitative'], required: true, label: 'Value (position along the row)' },
};

/**
 * Rows in, one record per OBSERVATION out — grouped, but never aggregated.
 *
 * `catShape` is the wrong shaper here and it is worth saying why rather than
 * leaving the next person to discover it: catShape SUMS its value per category,
 * which is exactly the operation this form exists to avoid. So this module
 * shapes its own rows.
 */
export function shape(rows, bindings = {}) {
  const cCol = bindings.category;
  const vCol = bindings.value;
  const groups = new Map();
  let dropped = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const raw = row[vCol];
    const v = Number(raw);
    if (!Number.isFinite(v) || String(raw).trim() === '') { dropped += 1; continue; }
    const g = cCol ? String(row[cCol] ?? '').trim() || '(unlabelled)' : '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }

  const data = [...groups.entries()].map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : 0;
    return { name, values: sorted, n: sorted.length, median };
  }).sort((a, b) => b.median - a.median || a.name.localeCompare(b.name));

  const all = data.flatMap((g) => g.values);
  return {
    data,
    stats: {
      groupCount: data.length,
      pointCount: all.length,
      valueName: String(vCol ?? 'value'),
      categoryName: cCol ? String(cCol) : '',
      min: all.length ? Math.min(...all) : 0,
      max: all.length ? Math.max(...all) : 0,
      widest: data.length
        ? [...data].sort((a, b) => (b.values[b.n - 1] - b.values[0]) - (a.values[a.n - 1] - a.values[0]))[0]
        : null,
      highest: data[0] || null,
      lowest: data[data.length - 1] || null,
      seriesCount: Math.max(1, data.length),
      dropped,
    },
  };
}

export default d3Piece({
  slug, title: 'Beeswarm', roles, shape,
  build: 'rain',
  rest: 'peak',
  dur: 3400,
  aspect: 0.56,
  minHeight: 260,
  hoverNote: 'Hover a dot for its exact value.',

  headline(stats) {
    if (!stats.pointCount) return 'No values to place';
    if (stats.groupCount > 1 && stats.highest && stats.lowest) {
      return `${stats.highest.name} sits highest on ${stats.valueName}, ${stats.lowest.name} lowest`;
    }
    return `${stats.pointCount} values, every one of them drawn`;
  },
  dek(stats) {
    return `${stats.pointCount} observations`
      + (stats.groupCount > 1 ? ` across ${stats.groupCount} groups` : '')
      + `, ${formatNumber(stats.min)} to ${formatNumber(stats.max)} — one dot each, none binned or averaged.`;
  },
  note: (stats) => 'the offset away from each row\'s centre line is collision avoidance and carries NO '
    + 'value — only position along the axis is data'
    + (stats.dropped ? ` · ${stats.dropped} rows had no readable ${stats.valueName} and are not drawn` : ''),

  draw(ctx) {
    const { sel, width, height, data, stats, tip, motion, el, setCopy } = ctx;
    if (!stats.pointCount) return null;

    const accent = resolveAccent(el);
    // The gutter clears the WIDER of the two lines it holds. Sizing it from the
    // group name alone is the same defect box-whisker.js carried: its
    // `n=… · med …` line is routinely longer than the name above it, and the
    // viewBox then cuts the leading characters off with nothing to show for it.
    const subLabel = (g) => `n=${g.n} · med ${formatNumber(g.median)}`;
    const hasNames = stats.groupCount > 1 || Boolean(data[0] && data[0].name);
    const gutter = Math.min(190, Math.max(64, ...data.map((g) => Math.max(
      String(g.name).length * 6.8,  // 11.5px label face
      subLabel(g).length * 6,       // 9.5px mono
    ) + 22)));
    const m = { top: 18, right: 26, bottom: 40, left: hasNames ? gutter : 26 };
    const dom = positionDomain(data.flatMap((g) => g.values)).domain;
    const x = linearScale(dom, [m.left, width - m.right]);

    const bandH = (height - m.top - m.bottom) / data.length;
    // The dot has to be small enough that a crowded group still resolves inside
    // its own band, and large enough to be a mark rather than a speck.
    const r = Math.max(1.6, Math.min(4.6, bandH * 0.1, (width - m.left - m.right) / Math.max(40, stats.pointCount) * 3));

    // AXIS first, so the dots sit over it.
    for (const t of axisTicks(null, dom, Math.max(2, Math.round(width / 130)), false)) {
      const tx = x(t);
      sel.append('line')
        .attr('x1', tx).attr('x2', tx).attr('y1', m.top).attr('y2', height - m.bottom)
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.07);
      sel.append('text')
        .attr('x', tx).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
        .text(formatNumber(t));
    }

    let maxSpill = 0;
    const marks = [];

    data.forEach((g, gi) => {
      const cy = m.top + bandH * (gi + 0.5);
      const isLead = stats.groupCount > 1 && stats.highest && g.name === stats.highest.name;
      const color = isLead ? accent : 'var(--_ink)';
      const op = isLead ? 0.8 : 0.45;

      // THE SWARM. Walking the sorted values and giving each dot the smallest
      // free offset produces the classic bee shape without a force simulation —
      // which matters for more than speed: a force layout is not deterministic,
      // so the same table would land differently on every redraw and a captured
      // frame would never reproduce.
      const placed = [];
      const pts = g.values.map((v) => {
        const px = x(v);
        let off = 0;
        let step = 0;
        // Candidate offsets alternate above and below the line so the swarm
        // stays symmetric — always trying "up" first would build a comb.
        for (;;) {
          const cand = step === 0 ? 0 : (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (r * 1.9);
          const clash = placed.some((q) => {
            const dx = q.px - px;
            const dy = q.off - cand;
            return dx * dx + dy * dy < (r * 2) * (r * 2);
          });
          if (!clash) { off = cand; break; }
          step += 1;
          if (step > 400) { off = cand; break; }
        }
        placed.push({ px, off });
        if (Math.abs(off) > maxSpill) maxSpill = Math.abs(off);
        return { v, px, off };
      });

      if (hasNames) {
        sel.append('text')
          .attr('x', m.left - 12).attr('y', cy - 5).attr('text-anchor', 'end')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11.5)
          .attr('font-weight', isLead ? 600 : 400)
          .attr('fill', isLead ? accent : 'var(--_ink)').attr('fill-opacity', isLead ? 1 : 0.86)
          .text(fitText(g.name, gutter - 22, 11.5));
        sel.append('text')
          .attr('x', m.left - 12).attr('y', cy + 9).attr('text-anchor', 'end')
          .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
          .text(subLabel(g));
      }

      const dots = [];
      for (const pt of pts) {
        const dot = sel.append('circle')
          .attr('cx', pt.px).attr('cy', cy + pt.off).attr('r', r)
          .attr('fill', color).attr('fill-opacity', op)
          .attr('data-vf-part', 'dot')
          .style('cursor', 'pointer');
        dots.push(dot);
        dot.on('pointerenter', () => {
          motion.hold();
          dot.attr('r', r * 2).attr('fill-opacity', 1);
          tip.show(
            `${g.name ? `<div><b>${g.name}</b></div>` : ''}`
            + `<div>${stats.valueName} <b>${formatNumber(pt.v)}</b></div>`,
            pt.px, cy + pt.off,
          );
        });
        dot.on('pointerleave', () => { dot.attr('r', r).attr('fill-opacity', op); tip.hide(); });
      }

      // The median, drawn ON the row as the one summary the form does offer.
      sel.append('line')
        .attr('x1', x(g.median)).attr('x2', x(g.median))
        .attr('y1', cy - bandH * 0.34).attr('y2', cy + bandH * 0.34)
        .attr('stroke', isLead ? accent : 'var(--_ink)')
        .attr('stroke-opacity', isLead ? 1 : 0.55)
        .attr('stroke-width', 1.8)
        .attr('data-vf-part', 'median')
        .attr('pointer-events', 'none');

      marks.push({ g, dots });
    });

    // A crowd wider than its own band has overlapped its neighbour, and the
    // reader cannot tell whose dot is whose. Said on the picture rather than
    // fixed silently by dropping the tail.
    setCopy({
      dekAppend: maxSpill > bandH * 0.5 && data.length > 1
        ? 'Rows are dense enough here that neighbouring swarms touch — read the labels, not the gaps.'
        : '',
    });

    return null;
  },
});
