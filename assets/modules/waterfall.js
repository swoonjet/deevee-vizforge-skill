// WATERFALL — the gallery's `conv-waterfall` ("The ARR bridge"), ported to
// take an ordered list of steps with signed changes.
//
// HONESTY, and it is the one thing every other form in this library gets to
// assume: A BAR HERE DOES NOT START AT ZERO. Each bar sits on the running
// total, so its LENGTH is a change and its POSITION is the level reached. That
// is a legitimate double reading — it is what a bridge is for — but it is also
// exactly the geometry a misleading bar chart uses, so the piece says which is
// which, prints the running total under every step, and draws the start and
// end as full-height bars from zero to anchor the two ends.
//
// THE STEPS ARE IN THE DATA'S OWN ORDER. A waterfall re-sorted by size is not a
// bridge, it is a ranked bar chart with a confusing baseline — so this is the
// one form in the library that never sorts.
//
// Negative values are the POINT here, which is why this has its own tiny shaper
// rather than riding hier-shape: that one drops non-positive rows, correctly,
// because an area encoding cannot show them.

import { d3Piece, num } from './d3-piece.js';
import { resolveAccent, fitText, formatNumber } from './vf-core.js';

export const slug = 'waterfall';

export const roles = {
  step: { types: ['nominal', 'ordinal'], required: true, label: 'Step' },
  delta: { types: ['quantitative'], required: true, label: 'Change (signed)' },
};

/** rows + {step, delta} -> the bridge, in the order the rows arrived. */
export function shape(rows, bindings = {}) {
  const sCol = bindings.step;
  const dCol = bindings.delta;
  const order = [];
  const byStep = new Map();
  let unreadable = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const v = num(row[dCol]);
    if (!Number.isFinite(v)) { unreadable += 1; continue; }
    const name = String(row[sCol] ?? '').trim() || '(unlabelled)';
    if (!byStep.has(name)) { byStep.set(name, 0); order.push(name); }
    byStep.set(name, byStep.get(name) + v);
  }

  let running = 0;
  const steps = order.map((name) => {
    const delta = byStep.get(name);
    const from = running;
    running += delta;
    return { name, delta, from, to: running };
  });

  const ups = steps.filter((s) => s.delta > 0);
  const downs = steps.filter((s) => s.delta < 0);
  const biggestUp = ups.sort((a, b) => b.delta - a.delta)[0] || null;
  const biggestDown = downs.sort((a, b) => a.delta - b.delta)[0] || null;

  return {
    data: { steps },
    stats: {
      steps,
      stepCount: steps.length,
      seriesCount: 3,
      start: steps.length ? steps[0].from : 0,
      end: running,
      added: ups.reduce((s, x) => s + x.delta, 0),
      removed: downs.reduce((s, x) => s + x.delta, 0),
      biggestUp,
      biggestDown,
      unreadable,
      deltaName: String(dCol ?? 'change'),
    },
  };
}

export default d3Piece({
  slug, title: 'Waterfall', roles, shape,
  build: 'grow',
  rest: 'peak',
  dur: 3200,
  aspect: 0.54,
  hoverNote: 'Hover a step for its change and the level it reaches.',

  headline(stats) {
    if (!stats.stepCount) return 'No steps to bridge';
    const net = stats.end - stats.start;
    return `${formatNumber(Math.abs(stats.added))} added, ${formatNumber(Math.abs(stats.removed))} taken away — `
      + `${net >= 0 ? 'up' : 'down'} to ${formatNumber(stats.end)}`;
  },
  dek(stats) {
    const parts = [`${stats.stepCount} steps from ${formatNumber(stats.start)} to ${formatNumber(stats.end)}`];
    if (stats.biggestDown) {
      parts.push(`${stats.biggestDown.name} is the largest single subtraction at ${formatNumber(stats.biggestDown.delta)}`);
    }
    return `${parts.join(' — ')}.`;
  },
  note: (stats) => ['each bar sits on the RUNNING TOTAL, so its length is the change and its position is the level '
    + 'reached — the ends are drawn from zero to anchor it',
  stats.unreadable ? `${stats.unreadable} rows had no readable change and are not in the bridge` : '',
  ].filter(Boolean).join(' · '),

  draw(ctx) {
    const { sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const steps = data.steps;
    if (!steps.length) return null;

    const m = { top: 18, right: 16, bottom: 44, left: 58 };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);

    const levels = steps.flatMap((s) => [s.from, s.to]).concat(0);
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const sy = (v) => m.top + plotH - ((v - lo) / ((hi - lo) || 1)) * plotH;

    const bandW = plotW / steps.length;
    const barW = Math.max(2, bandW * 0.72);
    const accent = resolveAccent(ctx.el);
    const up = colors[0];
    const down = colors[1 % colors.length];

    // The zero line, drawn heavier than the gridlines: on a bridge it is the
    // only absolute reference the reader has.
    for (const t of [lo, (lo + hi) / 2, hi, 0]) {
      if (t < lo || t > hi) continue;
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', sy(t)).attr('y2', sy(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', t === 0 ? 0.3 : 0.08);
      sel.append('text').attr('x', m.left - 8).attr('y', sy(t) + 4).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }

    const bars = [];
    steps.forEach((s, i) => {
      const x = m.left + i * bandW + (bandW - barW) / 2;
      const rises = s.delta >= 0;
      // The FIRST and LAST steps are drawn from zero: a bridge needs two piers.
      const anchored = i === 0 || i === steps.length - 1;
      const top = anchored ? sy(Math.max(0, s.to)) : sy(Math.max(s.from, s.to));
      const bottom = anchored ? sy(Math.min(0, s.to)) : sy(Math.min(s.from, s.to));
      const h = Math.max(1, bottom - top);
      const colour = anchored ? 'var(--_mark)' : (rises ? up : down);

      const rect = sel.append('rect')
        .attr('x', x).attr('y', top).attr('width', barW).attr('height', h)
        .attr('fill', colour)
        .attr('fill-opacity', anchored ? 0.9 : 0.85)
        .attr('data-vf-grow', rises || anchored ? 'up' : 'down')
        .attr('data-vf-order', i)
        .attr('data-name', s.name);
      const isPeak = stats.biggestDown && s.name === stats.biggestDown.name;
      if (isPeak) rect.attr('fill', accent || colour).attr('data-vf-peak', '');

      // The connector to the next pier — a rule, not a bar, so it cannot be
      // read as a value of its own.
      if (i < steps.length - 1) {
        sel.append('line')
          .attr('x1', x + barW).attr('x2', m.left + (i + 1) * bandW + (bandW - barW) / 2)
          .attr('y1', sy(s.to)).attr('y2', sy(s.to))
          .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.28)
          .attr('stroke-dasharray', '2 2')
          .attr('data-vf-part', 'rule');
      }

      // The change above the bar, the level reached below the axis.
      if (barW > 26) {
        sel.append('text')
          .attr('x', x + barW / 2).attr('y', top - 6).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_ff)').attr('font-size', 10.5).attr('font-weight', 600)
          .attr('fill', isPeak ? 'var(--_accent)' : 'var(--_ink)')
          .attr('fill-opacity', isPeak ? 1 : 0.75)
          .text(`${!anchored && s.delta > 0 ? '+' : ''}${fmt(anchored ? s.to : s.delta)}`);
      }
      const label = fitText(s.name, bandW - 4, 10.5);
      if (label) {
        sel.append('text')
          .attr('x', x + barW / 2).attr('y', height - m.bottom + 16).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 10.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.8)
          .text(label);
        sel.append('text')
          .attr('x', x + barW / 2).attr('y', height - m.bottom + 29).attr('text-anchor', 'middle')
          .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
          .text(fmt(s.to));
      }

      const rec = { rect, s };
      bars.push(rec);
      rect.style('cursor', 'pointer');
      rect.on('pointerenter', () => {
        motion.hold();
        for (const other of bars) other.rect.style('opacity', other === rec ? 1 : 0.3);
      });
      rect.on('pointermove', () => {
        tip.show(
          `<div><b>${s.name}</b></div>`
          + `<div>${s.delta >= 0 ? 'adds' : 'takes'} <b>${fmt(Math.abs(s.delta))}</b></div>`
          + `<div style="opacity:.7">${fmt(s.from)} → ${fmt(s.to)}</div>`,
          x + barW / 2, top
        );
      });
      rect.on('pointerleave', () => {
        for (const other of bars) other.rect.style('opacity', '');
        tip.hide();
        motion.free();
      });
    });

    return null;
  },
});
