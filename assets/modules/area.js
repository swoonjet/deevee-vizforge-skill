// AREA CHART (conv-area) — a quantity over time, with the space under it filled.
//
// WHY IT IS NOT JUST A LINE. The fill is a claim: it says the quantity
// ACCUMULATES down to the baseline, so an area is honest for things that are
// counts or totals and dishonest for things that are not. A temperature has no
// area under it — the space between 12°C and zero is not a quantity of
// anything. So:
//
//   THE BASELINE IS ALWAYS ZERO, no exceptions and no option to change it. A
//   line may truncate its axis with a disclosure (the trend module does); an
//   area may not, because the FILL is what encodes and a filled region measured
//   from an arbitrary floor overstates by exactly the floor.
//
//   THE REGISTRY REFUSES rate-like and index-like columns for this form and
//   sends them to the line, which is the same numbers without the false
//   accumulation.
//
// STACKED (`options.stacked`, with a series bound) puts several quantities on
// the same zero baseline. It is a different claim again — that the parts sum to
// something real — so the top edge is drawn heavier: on a stack, the only band
// anyone can read accurately is the bottom one, and the total.
//
// THE ENTRANCE draws the top edge left to right and the fill grows up under it
// as it goes, so the quantity accumulates in the direction time runs. Not a
// fade ([[feedback_viz_no_fade_builds]]).

import { d3Piece } from './d3-piece.js';
import { tsShape, tsRoles, tsFmtX, tsTicks } from './ts-shape.js';
import { formatNumber, resolveAccent, assignColors } from './vf-core.js';

export const slug = 'area';
export const roles = tsRoles;
export const shape = tsShape;

// ts-shape puts the series in `data`, NOT in `stats` — there is no stats.series
// and no stats.total. Reading them anyway is how a headline ends up printing
// "0 in total" over a correct picture, with every unit test still green.
function areaHeadline(stats, state) {
  const series = (state && state.data) || [];
  const f = tsFmtX(stats);
  if (stats.seriesCount > 1) {
    const total = series.reduce((sum, s) => sum + s.points.reduce((t, p) => t + Math.max(0, p.y), 0), 0);
    return `${stats.seriesCount} series, ${formatNumber(total)} in total, ${f(stats.firstX)} to ${f(stats.lastX)}`;
  }
  const s = series[0];
  if (!s || !s.points || s.points.length < 2) return `${stats.pointCount} points over time`;
  const sorted = [...s.points].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const change = first.y === 0 ? null : ((last.y - first.y) / Math.abs(first.y)) * 100;
  if (change === null || !Number.isFinite(change)) {
    return `${formatNumber(last.y)} by ${f(last.x)}`;
  }
  const dir = change >= 0 ? 'up' : 'down';
  return `${formatNumber(last.y)} by ${f(last.x)} — ${dir} ${Math.abs(change).toFixed(0)}% from ${formatNumber(first.y)}`;
}

export default d3Piece({
  slug, title: 'Area chart', roles, shape,
  build: 'trace', rest: 'tracer', dur: 4400, aspect: 0.5, minHeight: 280,
  hoverNote: 'Hover for the value at that point.',

  headline: areaHeadline,
  dek(stats, state) {
    const f = tsFmtX(stats);
    const stacked = Boolean(state.config.stacked);
    const span = `${f(stats.firstX)} to ${f(stats.lastX)}`;
    if (stats.seriesCount > 1) {
      return stacked
        ? `${stats.seriesCount} series stacked on one zero baseline, ${span}. The top edge is the total.`
        : `${stats.seriesCount} series over ${span}, each measured from zero and drawn over the others.`;
    }
    return `${stats.pointCount} points, ${span}, measured from zero.`;
  },
  note: 'the filled area is measured from a ZERO baseline, never a truncated one — the fill is what encodes, so a '
    + 'floor above zero would overstate every value by the height of the floor',

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, config, motion, el } = ctx;
    if (!data.length) return null;

    // Top level, not config.options — see the note in pie.js.
    const stacked = Boolean(config.stacked) && data.length > 1;
    const accent = resolveAccent(el);
    const names = data.map((s) => s.name);
    const colorFor = assignColors(names, colors, { accent, star: names.length === 1 ? names[0] : undefined });
    const f = tsFmtX(stats);

    const m = { top: 18, right: 78, bottom: 40, left: 64 };
    const x = d3.scaleLinear().domain([stats.firstX, stats.lastX]).range([m.left, width - m.right]);

    // THE DOMAIN. Zero is the floor, always — see the header.
    let hi = 0;
    if (stacked) {
      const xs = [...new Set(data.flatMap((s) => s.points.map((p) => p.x)))];
      for (const xv of xs) {
        let sum = 0;
        for (const s of data) { const p = s.points.find((q) => q.x === xv); if (p) sum += Math.max(0, p.y); }
        hi = Math.max(hi, sum);
      }
    } else {
      for (const s of data) for (const p of s.points) hi = Math.max(hi, p.y);
    }
    if (hi <= 0) hi = 1;
    const y = d3.scaleLinear().domain([0, hi]).nice().range([height - m.bottom, m.top]);

    for (const t of y.ticks(5)) {
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', t === 0 ? 0.32 : 0.08);
      sel.append('text').attr('x', m.left - 10).attr('y', y(t)).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle').attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of tsTicks(d3, stats, Math.max(2, Math.round(width / 150)))) {
      sel.append('text').attr('x', x(t)).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(f(t));
    }

    // Baselines per series: stacked ones ride on the running total, overlaid
    // ones all sit on zero.
    const running = new Map();
    const layers = data.map((s, i) => {
      const pts = [...s.points].sort((a, b) => a.x - b.x).map((p) => {
        const base = stacked ? (running.get(p.x) || 0) : 0;
        const top = base + Math.max(0, p.y);
        if (stacked) running.set(p.x, top);
        return { ...p, base, top };
      });
      return { name: s.name, points: pts, color: colorFor.get(s.name) || accent, i };
    });

    const areaGen = d3.area()
      .x((p) => x(p.x))
      .y0((p) => y(p.base))
      .y1((p) => y(p.top))
      .curve(d3.curveMonotoneX);
    const lineGen = d3.line()
      .x((p) => x(p.x))
      .y((p) => y(p.top))
      .curve(d3.curveMonotoneX);

    for (const L of layers) {
      sel.append('path')
        .attr('d', areaGen(L.points))
        .attr('fill', L.color)
        // Overlaid areas have to be see-through or the last one drawn hides the
        // rest; a stack does not, because nothing sits behind anything.
        .attr('fill-opacity', stacked ? 0.82 : (layers.length > 1 ? 0.28 : 0.2))
        .attr('data-vf-layer', L.i)
        .attr('pointer-events', 'none');

      // The top edge carries the entrance, and on a stack it is the only edge
      // that can be read accurately, so it is drawn heavier.
      L.edge = sel.append('path')
        .attr('d', lineGen(L.points))
        .attr('fill', 'none')
        .attr('stroke', L.color)
        .attr('stroke-width', stacked && L.i === layers.length - 1 ? 2.6 : 2)
        .attr('stroke-linecap', 'round')
        .attr('data-vf-order', L.i)
        .attr('pointer-events', 'none');

      if (layers.length > 1) {
        const last = L.points[L.points.length - 1];
        sel.append('text')
          .attr('x', x(last.x) + 8).attr('y', y((last.base + last.top) / 2))
          .attr('dominant-baseline', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11)
          .attr('fill', L.color).attr('pointer-events', 'none')
          .text(L.name);
      }
    }

    // ---- CROSSHAIR: one readout for every series at the cursor's date ------
    const rule = sel.append('line')
      .attr('y1', m.top).attr('y2', height - m.bottom)
      .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0)
      .attr('pointer-events', 'none');
    const knobs = layers.map((L) => sel.append('circle')
      .attr('r', 4).attr('fill', L.color).attr('opacity', 0).attr('pointer-events', 'none'));

    const hit = sel.append('rect')
      .attr('x', m.left).attr('y', m.top)
      .attr('width', Math.max(1, width - m.right - m.left))
      .attr('height', Math.max(1, height - m.bottom - m.top))
      .attr('fill', 'transparent').style('cursor', 'crosshair');

    hit.on('pointermove', (event) => {
      motion.hold();
      const box = ctx.svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const xv = x.invert(px);
      const rows = [];
      layers.forEach((L, li) => {
        let near = L.points[0];
        for (const p of L.points) if (Math.abs(p.x - xv) < Math.abs(near.x - xv)) near = p;
        if (!near) return;
        knobs[li].attr('cx', x(near.x)).attr('cy', y(near.top)).attr('opacity', 1);
        rows.push({ L, near });
      });
      if (!rows.length) return;
      rule.attr('x1', x(rows[0].near.x)).attr('x2', x(rows[0].near.x)).attr('stroke-opacity', 0.25);
      const total = rows.reduce((s, r) => s + Math.max(0, r.near.y), 0);
      tip.show(
        `<div><b>${f(rows[0].near.x)}</b></div>`
        + rows.map((r) => `<div><span style="color:${r.L.color}">■</span> `
          + `${layers.length > 1 ? `${r.L.name} &middot; ` : ''}<b>${fmt(r.near.y)}</b></div>`).join('')
        + (stacked && rows.length > 1 ? `<div style="opacity:.7">total ${fmt(total)}</div>` : ''),
        x(rows[0].near.x), y(rows[0].near.top)
      );
    });
    hit.on('pointerleave', () => {
      rule.attr('stroke-opacity', 0);
      for (const k of knobs) k.attr('opacity', 0);
      tip.hide();
      motion.free();
    });

    return { scanBox: { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom } };
  },
});
