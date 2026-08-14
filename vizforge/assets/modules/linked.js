// LINKED BRUSH — the gallery's `exp-linked` ("Brush the field, read the bars"),
// ported to take two numeric columns and a category to break them down by.
//
// HONESTY: A SELECTION MUST SAY HOW BIG IT IS. Brushing recomputes the bars
// from whatever is inside the box, and a bar chart of eleven rows looks exactly
// like a bar chart of eleven hundred — so the count of the current selection is
// printed above the bars at all times, and the bars keep the scale of the FULL
// data rather than rescaling to fill the panel. A selection that rescales makes
// every subset look equally important, which is the whole failure mode of a
// linked view.
//
// The brush itself is the encoding-free part: a rectangle over the scatter
// carries no value, it is a query.

import { d3Piece } from './d3-piece.js';
import { xyShape, xyRoles, xyNote } from './xy-shape.js';
import { resolveAccent, fitText, formatNumber, ticks as niceTicks } from './vf-core.js';

export const slug = 'linked';
export const roles = {
  ...xyRoles,
  category: { types: ['nominal', 'ordinal'], required: true, label: 'Break the selection down by' },
};
export const shape = xyShape;

export default d3Piece({
  slug, title: 'Linked brush', roles, shape,
  build: 'emerge',
  rest: 'peak',
  dur: 3000,
  aspect: 0.5,
  minHeight: 300,
  hoverNote: 'Drag a box across the field; the bars recount as you go.',

  headline(stats) {
    return `${formatNumber(stats.pointCount)} rows of ${stats.xName} against ${stats.yName}, `
      + 'broken down as you select';
  },
  dek(stats) {
    return `Drag across the field to select — the bars recount from whatever is inside the box, on the same `
      + 'scale as the whole.';
  },
  note: (stats) => xyNote(stats,
    'the bars always state the SIZE of the current selection and keep the full data\'s scale, so a small '
    + 'selection cannot read as the whole'),

  draw(ctx) {
    const { sel, width, height, data, stats, colors, tip, fmt, view, motion } = ctx;
    const pts = data.points;
    if (!pts.length) return null;

    const split = Math.round(width * 0.6);
    const m = { top: 30, right: 14, bottom: 34, left: 52 };
    const plotW = Math.max(20, split - m.left - 20);
    const plotH = Math.max(20, height - m.top - m.bottom);
    const sx = (v) => m.left + ((v - stats.xMin) / ((stats.xMax - stats.xMin) || 1)) * plotW;
    const sy = (v) => height - m.bottom - ((v - stats.yMin) / ((stats.yMax - stats.yMin) || 1)) * plotH;

    const accent = resolveAccent(ctx.el);
    const base = colors[0];

    for (const t of niceTicks(stats.xMin, stats.xMax, 4)) {
      if (t < stats.xMin || t > stats.xMax) continue;
      sel.append('text').attr('x', sx(t)).attr('y', height - m.bottom + 18).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of niceTicks(stats.yMin, stats.yMax, 4)) {
      if (t < stats.yMin || t > stats.yMax) continue;
      sel.append('text').attr('x', m.left - 8).attr('y', sy(t) + 4).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    sel.append('text').attr('x', m.left).attr('y', m.top - 12)
      .attr('font-family', 'var(--_fl)').attr('font-size', 11)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.7)
      .text(`${stats.xName} × ${stats.yName}`);

    const dots = pts.map((p) => ({
      p,
      node: sel.append('circle')
        .attr('cx', sx(p.x)).attr('cy', sy(p.y)).attr('r', pts.length > 400 ? 2.2 : 3.4)
        .attr('fill', base).attr('fill-opacity', 0.55),
    }));

    // --- the bars, recomputed from the selection ---------------------------
    const bx = split + 14;
    const bw = Math.max(30, width - bx - m.right);
    const names = [...new Set(pts.map((p) => p.series))].filter((n) => n !== undefined);
    const totals = new Map(names.map((n) => [n, pts.filter((p) => p.series === n).length]));
    const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    // THE SCALE IS THE WHOLE DATA'S, always. Rescaling to the selection is what
    // makes eleven rows look like eleven hundred.
    const maxAll = Math.max(...rows.map(([, v]) => v), 1);
    const rowH = Math.min(30, (height - m.top - m.bottom) / Math.max(1, rows.length));
    const labelW = Math.min(110, bw * 0.42);

    const countLabel = sel.append('text')
      .attr('x', bx).attr('y', m.top - 12)
      .attr('font-family', 'var(--_fl)').attr('font-size', 11).attr('font-weight', 600)
      .attr('fill', 'var(--_ink)')
      .text(`all ${formatNumber(pts.length)} rows`);

    const barNodes = rows.map(([name, total], i) => {
      const y = m.top + i * rowH;
      sel.append('text')
        .attr('x', bx + labelW - 8).attr('y', y + rowH / 2 + 4).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_fl)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.8)
        .text(fitText(name, labelW - 12, 11) || '');
      // The full-data bar stays behind the selection bar as a reference, so
      // "how much of this category did I catch" is answerable at a glance.
      sel.append('rect')
        .attr('x', bx + labelW).attr('y', y + rowH * 0.2)
        .attr('width', Math.max(1, (total / maxAll) * (bw - labelW - 44)))
        .attr('height', rowH * 0.6)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.09);
      const bar = sel.append('rect')
        .attr('x', bx + labelW).attr('y', y + rowH * 0.2)
        .attr('width', Math.max(1, (total / maxAll) * (bw - labelW - 44)))
        .attr('height', rowH * 0.6)
        .attr('fill', base).attr('fill-opacity', 0.85)
        .attr('data-vf-grow', 'right').attr('data-vf-order', i);
      const value = sel.append('text')
        .attr('x', bx + bw - 40).attr('y', y + rowH / 2 + 4)
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.7)
        .text(fmt(total));
      return { name, bar, value, total };
    });
    if (barNodes[0]) barNodes[0].bar.attr('fill', accent || base).attr('data-vf-peak', '');

    // --- the brush ----------------------------------------------------------
    const box = sel.append('rect')
      .attr('fill', accent || base).attr('fill-opacity', 0.08)
      .attr('stroke', accent || base).attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', '3 2')
      .attr('visibility', 'hidden')
      .attr('pointer-events', 'none');

    const recount = (sel4) => {
      const inside = (p) => !sel4
        || (p.x >= sel4.x0 && p.x <= sel4.x1 && p.y >= sel4.y0 && p.y <= sel4.y1);
      const chosen = pts.filter(inside);
      const counts = new Map();
      for (const p of chosen) counts.set(p.series, (counts.get(p.series) || 0) + 1);
      for (const b of barNodes) {
        const v = sel4 ? (counts.get(b.name) || 0) : b.total;
        b.bar.attr('width', Math.max(sel4 && !v ? 0 : 1, (v / maxAll) * (bw - labelW - 44)));
        b.value.text(fmt(v));
      }
      for (const d of dots) d.node.attr('fill-opacity', inside(d.p) ? 0.85 : 0.1);
      countLabel.text(sel4
        ? `${formatNumber(chosen.length)} of ${formatNumber(pts.length)} rows selected`
        : `all ${formatNumber(pts.length)} rows`);
    };

    if (view.brush) recount(view.brush);

    const hit = sel.append('rect')
      .attr('x', m.left).attr('y', m.top)
      .attr('width', Math.max(1, plotW)).attr('height', Math.max(1, plotH))
      .attr('fill', 'transparent').style('cursor', 'crosshair');

    let dragging = null;
    const local = (event) => {
      const b = ctx.svg.getBoundingClientRect();
      return {
        px: ((event.clientX - b.left) / b.width) * width,
        py: ((event.clientY - b.top) / b.height) * height,
      };
    };
    const invertX = (px) => stats.xMin + ((px - m.left) / plotW) * ((stats.xMax - stats.xMin) || 1);
    const invertY = (py) => stats.yMin + ((height - m.bottom - py) / plotH) * ((stats.yMax - stats.yMin) || 1);

    hit.on('pointerdown', (event) => {
      motion.hold();
      tip.hide();
      dragging = local(event);
      box.attr('visibility', 'visible').attr('x', dragging.px).attr('y', dragging.py)
        .attr('width', 0).attr('height', 0);
    });
    hit.on('pointermove', (event) => {
      if (!dragging) return;
      const at = local(event);
      const x0 = Math.min(dragging.px, at.px);
      const y0 = Math.min(dragging.py, at.py);
      box.attr('x', x0).attr('y', y0)
        .attr('width', Math.abs(at.px - dragging.px)).attr('height', Math.abs(at.py - dragging.py));
      const brush = {
        x0: invertX(x0), x1: invertX(x0 + Math.abs(at.px - dragging.px)),
        y0: invertY(y0 + Math.abs(at.py - dragging.py)), y1: invertY(y0),
      };
      view.brush = brush;
      recount(brush);
    });
    const release = () => {
      dragging = null;
      motion.free();
    };
    hit.on('pointerup', release);
    hit.on('pointerleave', release);
    // A CLICK CLEARS IT — one gesture both ways, so there is no button to
    // explain and no way to be stuck inside a selection.
    hit.on('click', (event) => {
      const at = local(event);
      const w = Number(box.attr('width')) || 0;
      if (w > 4) return;
      view.brush = null;
      box.attr('visibility', 'hidden');
      recount(null);
      tip.hide();
      void at;
    });

    return null;
  },
});
