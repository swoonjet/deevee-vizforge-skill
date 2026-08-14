// HISTOGRAM (conv-histogram) — the shape of one column, and the bin width said
// out loud.
//
// THE HONESTY PROBLEM THIS FORM HAS, and how it is handled here. A histogram's
// picture is decided as much by the bin width as by the data: the same numbers
// can look bimodal at 12 bins and flat at 40, and nothing on a default
// histogram tells the reader which they are looking at. So:
//
//   1. THE BIN WIDTH IS PRINTED, in the source line, in data units. Not the bin
//      COUNT — a count is a fact about the chart, a width is a fact about the
//      data.
//   2. THE RULE IS NAMED. Freedman–Diaconis by default (2·IQR·n^-1/3, robust to
//      the outliers that wreck Sturges), falling back to Sturges where the IQR
//      is zero. A reader who knows the difference can see which they got.
//   3. YOU CAN CHANGE IT AND WATCH IT MOVE. The bin control is the interaction,
//      because seeing the shape survive — or not survive — a change of bin
//      width is the only honest way to know how much to trust it. Rebinning
//      re-runs the entrance, so the new shape assembles rather than snapping.
//
// A histogram counts, so its bars always start at zero; there is no truncation
// question to disclose. What there IS to disclose is how many rows had no
// readable number, which is in the source line.
//
// THE ENTRANCE grows each bar up out of the axis, left to right along the
// value axis, so the distribution builds in the direction it is read.

import { d3Piece, num } from './d3-piece.js';
import { formatNumber, resolveAccent } from './vf-core.js';

export const slug = 'histogram';
export const roles = {
  value: { types: ['quantitative'], required: true, label: 'Measure to distribute' },
};

/** rows + {value} -> the raw numbers, kept raw: binning is a DRAW-time decision. */
export function histogramShape(rows, bindings = {}) {
  const col = bindings.value;
  const values = [];
  let dropped = 0;
  for (const row of rows || []) {
    if (!row) continue;
    const v = num(row[col]);
    if (!Number.isFinite(v)) { dropped += 1; continue; }
    values.push(v);
  }
  values.sort((a, b) => a - b);

  const q = (p) => {
    if (!values.length) return 0;
    const i = (values.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi ? values[lo] : values[lo] + (values[hi] - values[lo]) * (i - lo);
  };
  const median = q(0.5);
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return {
    data: values,
    stats: {
      count: values.length,
      dropped,
      valueName: String(col ?? 'value'),
      min: values.length ? values[0] : 0,
      max: values.length ? values[values.length - 1] : 0,
      q1: q(0.25),
      q3: q(0.75),
      median,
      mean,
      // A distribution whose mean sits well off its median is skewed, and that
      // is the finding worth leading with when it is true.
      skewed: values.length > 6 && Math.abs(mean - median) > (q(0.75) - q(0.25)) * 0.35,
      seriesCount: 1,
    },
  };
}
export const shape = histogramShape;

/** Freedman–Diaconis, with the reason it may not apply carried out with it. */
function binWidthFor(stats) {
  const iqr = stats.q3 - stats.q1;
  const span = stats.max - stats.min;
  if (!span) return { width: 1, rule: 'a single value' };
  if (iqr > 0 && stats.count > 1) {
    return { width: (2 * iqr) / Math.cbrt(stats.count), rule: 'Freedman–Diaconis' };
  }
  // Half the data sits on one number, so the IQR is zero and FD divides by it.
  return { width: span / Math.max(1, Math.ceil(Math.log2(stats.count || 1) + 1)), rule: 'Sturges' };
}

function histogramHeadline(stats) {
  if (!stats.count) return 'Nothing to distribute';
  if (stats.skewed) {
    const dir = stats.mean > stats.median ? 'a long tail to the right' : 'a long tail to the left';
    return `${stats.valueName} is skewed — median ${formatNumber(stats.median)}, `
      + `mean ${formatNumber(stats.mean)}, ${dir}`;
  }
  return `${stats.valueName} centres on ${formatNumber(stats.median)}, `
    + `half of it between ${formatNumber(stats.q1)} and ${formatNumber(stats.q3)}`;
}

export default d3Piece({
  slug, title: 'Histogram', roles, shape,
  build: 'grow', rest: 'peak', dur: 3000, aspect: 0.52, minHeight: 280,
  hoverNote: 'Hover a bar for its range and count; use the bin control to rebin.',

  headline: histogramHeadline,
  dek(stats) {
    return `${formatNumber(stats.count)} values from ${formatNumber(stats.min)} to ${formatNumber(stats.max)}. `
      + 'Change the bin width to see how much of the shape is the data and how much is the binning.';
  },
  // The bin WIDTH is drawn from the layout, so it goes on the dek where draw()
  // can replace it every rebin (setCopy's dekAppend). The source line still
  // carries the standing claim, because a piece whose honesty note is empty
  // reads as a piece with nothing to disclose — and this form has the most.
  note: (stats) => {
    const parts = ['bin WIDTH decides this shape as much as the data does, so it is printed above and '
      + 'the bars always count up from zero'];
    if (stats.dropped) {
      parts.push(`${stats.dropped} ${stats.dropped === 1 ? 'row had' : 'rows had'} no readable `
        + `${stats.valueName} and ${stats.dropped === 1 ? 'is' : 'are'} not counted — a blank is not a zero`);
    }
    return parts.join(' · ');
  },

  draw(ctx) {
    const { d3, sel, width, height, data, stats, tip, fmt, motion, view, el } = ctx;
    if (!data.length) return null;

    const accent = resolveAccent(el);
    const auto = binWidthFor(stats);
    // `view.bins` survives a resize, so a reader's chosen binning is not undone
    // by dragging the window (the whole reason `view` exists).
    const autoCount = Math.max(1, Math.min(80, Math.round((stats.max - stats.min) / auto.width) || 1));
    const binCount = view.bins || autoCount;
    const rebinned = Boolean(view.bins && view.bins !== autoCount);

    const m = { top: 18, right: 22, bottom: 64, left: 62 };
    const x = d3.scaleLinear().domain([stats.min, stats.max]).nice().range([m.left, width - m.right]);
    const bins = d3.bin().domain(x.domain()).thresholds(x.ticks(binCount))(data);
    const top = Math.max(1, d3.max(bins, (b) => b.length) || 1);
    const y = d3.scaleLinear().domain([0, top]).nice().range([height - m.bottom, m.top]);

    const actualWidth = bins.length > 1 ? bins[0].x1 - bins[0].x0 : (stats.max - stats.min);

    for (const t of y.ticks(5)) {
      sel.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', t === 0 ? 0.3 : 0.08);
      sel.append('text').attr('x', m.left - 10).attr('y', y(t)).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle').attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }
    for (const t of x.ticks(Math.max(3, Math.round(width / 120)))) {
      sel.append('text').attr('x', x(t)).attr('y', height - m.bottom + 20).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).text(fmt(t));
    }

    // ONE MEASURE, ONE COLOUR: a field of `--_mark` with the accent on the
    // MODAL bin — the tallest bar is where the distribution's story is, and it
    // is the only bar hue has anything to say about. Painting all of them the
    // accent (which this did first) shouts at every bin equally.
    const modal = bins.reduce((best, b, i) => (b.length > bins[best].length ? i : best), 0);
    const rects = bins.map((b, i) => {
      const x0 = x(b.x0);
      const x1 = x(b.x1);
      const isModal = i === modal && b.length > 0;
      return sel.append('rect')
        .attr('x', x0 + 0.5).attr('width', Math.max(1, x1 - x0 - 1))
        .attr('y', y(b.length)).attr('height', Math.max(0, y(0) - y(b.length)))
        .attr('fill', isModal ? 'var(--_accent)' : 'var(--_mark)')
        .attr('fill-opacity', isModal ? 1 : 'var(--_mark-opacity)')
        .attr('data-vf-rest', isModal ? 1 : 'var(--_mark-opacity)')
        .attr('data-vf-grow', 'up').attr('data-vf-order', i)
        .style('cursor', 'pointer')
        .datum(b);
    });

    // The median, marked — the number the headline leads with should be findable
    // in the picture.
    sel.append('line')
      .attr('x1', x(stats.median)).attr('x2', x(stats.median))
      .attr('y1', m.top).attr('y2', height - m.bottom)
      .attr('stroke', 'var(--_ink)').attr('stroke-opacity', 0.5).attr('stroke-dasharray', '4 4')
      .attr('pointer-events', 'none');
    sel.append('text')
      .attr('x', x(stats.median) + 5).attr('y', m.top + 11)
      .attr('font-family', 'var(--_ff)').attr('font-size', 10)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).attr('pointer-events', 'none')
      .text(`median ${fmt(stats.median)}`);

    for (const rect of rects) {
      rect.on('pointerenter', () => {
        motion.hold();
        const b = rect.datum();
        for (const o of rects) o.attr('fill-opacity', o === rect ? 1 : 0.14);
        tip.show(
          `<div><b>${fmt(b.x0)} to ${fmt(b.x1)}</b></div>`
          + `<div>${b.length} ${b.length === 1 ? 'value' : 'values'}</div>`
          + `<div style="opacity:.7">${((100 * b.length) / stats.count).toFixed(1)}% of ${fmt(stats.count)}</div>`,
          (x(b.x0) + x(b.x1)) / 2, y(b.length)
        );
      });
      rect.on('pointerleave', () => {
        for (const o of rects) o.attr('fill-opacity', o.attr('data-vf-rest'));
        tip.hide();
        motion.free();
      });
    }

    // ---- THE BIN CONTROL -------------------------------------------------
    // Drawn in the picture rather than in page chrome, because it is part of
    // the reading: a shape that changes character between 12 and 40 bins is a
    // shape you should not trust, and that is only learnable by trying it.
    // A CHIP MUST BE LABELLED WITH WHAT IT PRODUCES. d3 snaps thresholds to
    // nice round values, so asking for 9 bins can yield 11 — and a control
    // reading "9" over an 11-bin chart is the picture disagreeing with its own
    // caption, on the very form whose whole subject is that the bin count
    // decides the shape. So each candidate is BINNED once and labelled by its
    // real result, and candidates that collapse to the same result are merged.
    const realCount = (n) => d3.bin().domain(x.domain()).thresholds(x.ticks(n))(data).length;
    const seen = new Map();
    for (const n of [6, 12, 20, 30, 50, autoCount]) {
      if (n < 2 || n > 80) continue;
      const got = realCount(n);
      // First request wins a given result, and the computed default always wins
      // its own, so the asterisk lands on the chip that is actually selected.
      if (!seen.has(got) || n === autoCount) seen.set(got, n);
    }
    const steps = [...seen.entries()]
      .map(([got, req]) => ({ got, req, isAuto: req === autoCount }))
      .sort((a, b) => a.got - b.got);
    const cw = 34;
    const cx0 = m.left;
    const cy0 = height - 22;
    sel.append('text')
      .attr('x', cx0).attr('y', cy0 - 12)
      .attr('font-family', 'var(--_ff)').attr('font-size', 10)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
      .text('bins');
    steps.forEach((step, i) => {
      const bx = cx0 + i * (cw + 5);
      const on = step.req === binCount;
      const g = sel.append('g').style('cursor', 'pointer');
      g.append('rect')
        .attr('x', bx).attr('y', cy0 - 8).attr('width', cw).attr('height', 18).attr('rx', 9)
        .attr('fill', on ? accent : 'transparent')
        .attr('stroke', on ? accent : 'var(--_ink)')
        .attr('stroke-opacity', on ? 1 : 0.22);
      g.append('text')
        .attr('x', bx + cw / 2).attr('y', cy0 + 1).attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
        .attr('fill', on ? 'var(--_paper)' : 'var(--_ink)')
        .attr('fill-opacity', on ? 1 : 0.7)
        .attr('pointer-events', 'none')
        .text(step.isAuto ? `${step.got}*` : String(step.got));
      g.on('click', () => {
        view.bins = step.req;
        motion.replay();     // a new binning is a new shape: let it assemble
        ctx.redraw();
      });
    });

    // The bin width in DATA UNITS, which is the fact that decides the picture.
    ctx.setCopy({
      dekAppend: `Bin width ${fmt(actualWidth)} ${stats.valueName === 'value' ? '' : stats.valueName} `
        .trim() + ` — ${bins.length} bins`
        + (rebinned ? ' (you chose this; * marks the computed default).' : ` by ${auto.rule}.`),
    });

    // A rebinning is a reader-made change to the picture, so it offers the way
    // back to the computed default like any other descent in this library.
    ctx.trail(rebinned ? {
      label: `${auto.rule} default`,
      crumbs: `${bins.length} bins, width ${fmt(actualWidth)}`,
      onHome() {
        view.bins = null;
        motion.replay();
        ctx.redraw();
      },
    } : null);

    return null;
  },
});
