// CALENDAR HEATMAP — the gallery's `unc-calendar` ("Three years of ChatGPT,
// one cell per day"), ported to take any daily date column and a value.
//
// HONESTY: COLOUR IS A BAND, NOT A NUMBER. A sequential ramp can say "more" and
// "less" and nothing finer, so the piece prints the bands it used and a reader
// takes a cell to mean "this day fell in that band" — never a value read off a
// hue. The legend is therefore not decoration; without it the encoding cannot
// be inverted at all.
//
// A DAY WITH NO ROW IS NOT A ZERO. The grid runs from the first date to the
// last, so days the data never mentions get an empty cell rather than the
// bottom of the ramp — which would draw a quiet day and a missing day
// identically.

import { d3Piece } from './d3-piece.js';
import { tsShape, tsRoles } from './ts-shape.js';
import { resolveAccent, formatNumber } from './vf-core.js';

export const slug = 'calendar';
export const roles = {
  date: { types: ['temporal'], required: true, label: 'Date (one row per day)' },
  value: { types: ['quantitative'], required: true, label: 'Value' },
};
const CAL_DAY = 86400000;

/**
 * One bucket per DAY, plus the day-level facts the copy needs.
 *
 * tsShape does the binding and the date coercion; the calendar's own question —
 * how many days, which was the biggest, how many days in the span have no row
 * at all — is a level of aggregation above it, and `missing` is the one that
 * keeps the piece honest.
 */
export const shape = (rows, bindings = {}) => {
  const base = tsShape(rows, { x: bindings.date || bindings.x, y: bindings.value || bindings.y });
  const points = base.data[0] ? base.data[0].points : [];
  const byDay = new Map();
  for (const p of points) {
    const key = Math.floor(p.x / CAL_DAY) * CAL_DAY;
    byDay.set(key, (byDay.get(key) || 0) + p.y);
  }
  const days = [...byDay.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
  const firstX = days.length ? days[0].t : null;
  const lastX = days.length ? days[days.length - 1].t : null;
  const spanDays = days.length ? Math.round((lastX - firstX) / CAL_DAY) + 1 : 0;
  const busiest = days.reduce((a, b) => (!a || b.v > a.v ? b : a), null);
  return {
    data: { days, byDay },
    stats: {
      ...base.stats,
      seriesCount: 1,
      days,
      dayCount: days.length,
      spanDays,
      missing: Math.max(0, spanDays - days.length),
      // How many source rows went into those cells. tsShape already sums repeats
      // at one x, so this is the only place the collapse is still visible — and a
      // table with several rows per day (transactional, or one row per channel)
      // is the common case, not an odd one.
      sourceRows: base.stats.pointCount,
      sum: days.reduce((s, d) => s + d.v, 0),
      busiest: busiest ? { x: busiest.t, y: busiest.v } : null,
      firstX,
      lastX,
    },
  };
};
const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BANDS = 5;

export default d3Piece({
  slug, title: 'Calendar heatmap', roles, shape,
  build: 'wave',
  rest: 'wavebreathe',
  restSelect: '[data-vf-cell]',
  dur: 4000,
  aspect: 0.42,
  minHeight: 240,
  hoverNote: 'Hover a day for its exact value.',

  headline(stats) {
    const busiest = stats.busiest;
    if (!busiest) return 'No days to draw';
    return `${fmtDay(busiest.x)} was the biggest day, at ${formatNumber(busiest.y)}`;
  },
  dek(stats) {
    return `${stats.dayCount} days from ${fmtDay(stats.firstX)} to ${fmtDay(stats.lastX)}, `
      + `${formatNumber(stats.sum)} in total — one cell each.`;
  },
  note: (stats) => {
    const bands = 'colour is one of five equal BANDS of the range, not a value — a cell says which band its day '
      + 'fell in';
    // AGGREGATION IS NEVER SILENT — the rule ranked-bar states by name. Where a
    // day carries several rows they are summed into its one cell, and the dek's
    // "one cell each" does not say so: it is true about the cells and silent
    // about the rows behind them.
    const summed = stats.sourceRows > stats.dayCount
      ? `; each cell is the total for its day, ${formatNumber(stats.sourceRows)} rows summed into `
        + `${formatNumber(stats.dayCount)} cells`
      : '';
    const gaps = stats.missing
      ? `; ${stats.missing} days in the span have no row at all and are left empty`
      : '';
    return `${bands}${summed}${gaps}`;
  },

  draw(ctx) {
    const { sel, width, height, data, colors, tip, fmt, motion } = ctx;
    const { byDay } = data;
    if (!byDay || !byDay.size) return null;

    const days = [...byDay.keys()].sort((a, b) => a - b);
    const first = days[0];
    const last = days[days.length - 1];
    const values = [...byDay.values()];
    const maxV = Math.max(...values) || 1;
    const minV = Math.min(...values, 0);

    const weeks = Math.max(1, Math.round((last - first) / (7 * CAL_DAY)) + 1);
    const m = { top: 22, right: 12, bottom: 26, left: 34 };
    const cell = Math.max(3, Math.min(
      (width - m.left - m.right) / weeks,
      (height - m.top - m.bottom - 34) / 7
    ));
    // A YEAR OF DAYS IS A WIDE, SHALLOW THING. In a tall box the grid is
    // width-bound, so centring it vertically keeps the piece from sitting in
    // the top eighth of its own frame with the legend stranded far below.
    m.top = Math.max(22, (height - 7 * cell - 34) / 2);
    const gap = cell > 8 ? 1.5 : 0.5;

    const accent = resolveAccent(ctx.el);
    const base = colors[0];
    // FIVE EQUAL BANDS, and the legend prints their edges. A continuous ramp
    // would imply a precision the eye does not have.
    const bandOf = (v) => Math.min(BANDS - 1, Math.floor(((v - minV) / (maxV - minV || 1)) * BANDS));
    const tint = (v) => 0.18 + 0.82 * ((bandOf(v) + 1) / BANDS);

    const weekOf = (t) => Math.floor((t - startOfWeek(first)) / (7 * CAL_DAY));
    const dowOf = (t) => new Date(t).getUTCDay();

    // Day-of-week gutter.
    for (const d of [1, 3, 5]) {
      sel.append('text')
        .attr('x', m.left - 7).attr('y', m.top + d * cell + cell * 0.7).attr('text-anchor', 'end')
        .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.5)
        .text(['S', 'M', 'T', 'W', 'T', 'F', 'S'][d]);
    }

    let lastMonth = -1;
    const cells = [];
    for (let t = startOfWeek(first); t <= last; t += CAL_DAY) {
      const x = m.left + weekOf(t) * cell;
      const y = m.top + dowOf(t) * cell;
      const month = new Date(t).getUTCMonth();
      if (month !== lastMonth && dowOf(t) === 0 && cell > 5) {
        lastMonth = month;
        sel.append('text')
          .attr('x', x).attr('y', m.top - 8)
          .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
          .text(CAL_MONTHS[month] + (month === 0 ? ` ${new Date(t).getUTCFullYear()}` : ''));
      }
      if (t < first) continue;

      const has = byDay.has(t);
      const v = byDay.get(t) || 0;
      const rect = sel.append('rect')
        .attr('x', x).attr('y', y)
        .attr('width', Math.max(1, cell - gap)).attr('height', Math.max(1, cell - gap))
        .attr('rx', cell > 8 ? 1.5 : 0)
        .attr('fill', has ? base : 'var(--_ink)')
        // An absent day is drawn as an OUTLINE of the grid, not as the bottom
        // of the ramp: "no row" and "a quiet day" must not look the same.
        .attr('fill-opacity', has ? tint(v) : 0.05)
        .attr('data-vf-cell', '');
      if (has && v === maxV) rect.attr('fill', accent || base).attr('data-vf-peak', '');

      if (!has) continue;
      const rec = { rect, t, v };
      cells.push(rec);
      rect.style('cursor', 'pointer');
      rect.on('pointerenter', () => {
        motion.hold();
        for (const other of cells) other.rect.style('opacity', other === rec ? 1 : 0.35);
      });
      rect.on('pointermove', () => {
        tip.show(
          `<div><b>${fmtDay(t)}</b></div><div><b>${fmt(v)}</b></div>`
          + `<div style="opacity:.7">band ${bandOf(v) + 1} of ${BANDS}</div>`,
          x + cell / 2, y + cell / 2
        );
      });
      rect.on('pointerleave', () => {
        for (const other of cells) other.rect.style('opacity', '');
        tip.hide();
        motion.free();
      });
    }

    // THE LEGEND IS PART OF THE ENCODING — five swatches, and the ends of the
    // range under them. Only the ends: an edge label under every swatch runs
    // into its neighbours at this size, and five collided numbers are worse
    // than two readable ones when the source line already says the bands are
    // equal.
    const lw = Math.min(20, Math.max(11, cell));
    const lx = m.left;
    const ly = m.top + 7 * cell + 14;
    for (let b = 0; b < BANDS; b += 1) {
      sel.append('rect')
        .attr('x', lx + b * (lw + 2)).attr('y', ly)
        .attr('width', lw).attr('height', 9).attr('rx', 1.5)
        .attr('fill', base).attr('fill-opacity', 0.18 + 0.82 * ((b + 1) / BANDS));
    }
    const legendRight = lx + BANDS * (lw + 2) - 2;
    sel.append('text')
      .attr('x', lx).attr('y', ly + 21)
      .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
      .text(fmt(minV));
    sel.append('text')
      .attr('x', legendRight).attr('y', ly + 21).attr('text-anchor', 'end')
      .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.55)
      .text(fmt(maxV));
    sel.append('text')
      .attr('x', legendRight + 12).attr('y', ly + 8)
      .attr('font-family', 'var(--_ff)').attr('font-size', 9.5)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.45)
      .text(`${BANDS} equal bands`);

    return null;
  },
});

function startOfWeek(t) {
  const d = new Date(Math.floor(t / CAL_DAY) * CAL_DAY);
  return d.getTime() - d.getUTCDay() * CAL_DAY;
}

function fmtDay(t) {
  const d = new Date(t);
  return `${CAL_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
