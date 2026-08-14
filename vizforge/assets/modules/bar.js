// BAR CHART (conv-bar) — the one form everybody already reads.
//
// Vertical bars from a zero baseline, and three modes off ONE binding: bind a
// category and a measure for plain bars; add a split for grouped bars; set
// `stacked` for a stack. The mode is chosen by what is bound rather than by
// three near-identical modules, because they share a baseline, a hover and an
// entrance and differ only in where a rect sits.
//
// WHY A ZERO BASELINE IS NOT NEGOTIABLE HERE. A bar encodes by LENGTH, and
// length read against a truncated axis overstates every difference on the
// chart. The axis therefore always includes zero. Where the data itself goes
// negative the bars hang below the baseline, which is the honest picture — the
// alternative is dropping rows the reader gave us.
//
// THE ENTRANCE grows each bar out of the baseline in the direction its value
// points, staggered along the category axis. Not a fade: a bar's height IS its
// value, so the value is what arrives ([[feedback_viz_no_fade_builds]] — the
// standing rule that a build must grow the mark's own geometry).

import { d3Piece } from './d3-piece.js';
import { catShape, catRoles, catNote, catColors } from './cat-shape.js';
import { formatNumber, resolveAccent, fitText } from './vf-core.js';

export const slug = 'bar';
export const roles = catRoles;
export const shape = catShape;

/** The whole chart's finding, named so the stacked/grouped paths can restate it. */
function barHeadline(stats) {
  const b = stats.biggest;
  if (!b) return 'Nothing to compare';
  const measure = stats.counting ? 'rows' : stats.valueName;
  if (stats.categoryCount === 1) return `${b.name}: ${formatNumber(b.value)} ${measure}`;
  // A share is only a share when everything points the same way. With a
  // negative in the set the total is a net, and "62% of the total" against a
  // net is a number that means nothing.
  if (stats.hasNegative || stats.rateLike) {
    return `${b.name} is the largest at ${formatNumber(b.value)}, across ${stats.categoryCount} categories`;
  }
  return `${b.name} takes ${Math.round(b.share * 100)}% of the ${formatNumber(stats.total)} ${measure}`;
}

export default d3Piece({
  slug, title: 'Bar chart', roles, shape,
  build: 'grow', rest: 'peak', dur: 3200, aspect: 0.5, minHeight: 280,
  hoverNote: 'Hover a bar for its exact value.',

  headline: barHeadline,
  dek(stats, state) {
    const stacked = Boolean(state.config.stacked);
    const measure = stats.counting ? 'rows counted' : stats.valueName;
    const parts = [`${stats.categoryCount} categories by ${measure}`];
    if (stats.seriesNames.length) {
      parts.push(stacked
        ? `each bar stacked by "${stats.seriesLabel}" — the whole bar is the category's total`
        : `split into ${stats.seriesNames.length} bars per category by "${stats.seriesLabel}"`);
    }
    if (stats.hasNegative) parts.push('bars below the line are negative');
    return `${parts.join(', ')}.`;
  },
  note: (stats) => catNote(stats,
    'bar LENGTH is the value and the axis includes zero, so the differences you see are the differences there are'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, config, motion, el } = ctx;
    if (!data.length) return null;

    // Top level, not config.options — see the note in pie.js.
    const stacked = Boolean(config.stacked);
    const split = stats.seriesNames.length > 0;
    const accent = resolveAccent(el);
    const colorFor = catColors(stats, colors, accent);

    // Ordinal categories keep the table's own order; anything else ranks, since
    // a ranking is the reason to draw a bar chart of nominal categories at all.
    const ordered = config.keepOrder ? stats.order.map((n) => data.find((d) => d.name === n)).filter(Boolean) : data;
    const names = ordered.map((d) => d.name);

    // ROTATE ONLY WHEN A LABEL DOES NOT FIT, and reserve only the height the
    // rotation actually needs.
    //
    // This used to rotate on `names.length > 8 || longest > 12` and then reserve
    // `min(140, 34 + longest * 6.2)` px for it. Both were guesses about character
    // COUNT rather than about the space available, and on a wide stage they cost
    // the chart a third of its height for nothing: seven categories across 1378px
    // give each band ~197px, "Cloud & infrastructure" measures ~135px at 11px, so
    // it fits upright — yet it was rotated and 140px of the 512px plot was
    // reserved, leaving a ~100px empty band above the source line. The picture
    // read as small inside a big frame, which is exactly what it was.
    //
    // The band width is only knowable after the left margin, and the left margin
    // does not depend on the labels, so this resolves in one pass.
    const LABEL_PX = 11;
    const perChar = LABEL_PX * 0.56;          // the same estimator fitText uses
    const longest = Math.max(...names.map((n) => String(n).length));
    const labelPx = longest * perChar;
    const m = { top: 18, right: 20, bottom: 44, left: 62 };
    const band = (width - m.left - m.right) / Math.max(1, names.length);
    // 8px of gutter so neighbouring labels are separated rather than merely
    // non-overlapping.
    const rotate = labelPx > band - 8;
    if (rotate) {
      // A -42 degree label's vertical extent is sin(42) x its own width, plus the
      // offset below the axis. Capped at a third of the frame: past that the
      // labels are the chart, and truncating them serves the reader better.
      const needed = Math.ceil(Math.sin(Math.PI * 42 / 180) * labelPx) + 22;
      m.bottom = Math.min(Math.round(height * 0.34), needed);
    }

    const x = d3.scaleBand().domain(names).range([m.left, width - m.right]).padding(names.length > 24 ? 0.12 : 0.24);

    // THE DOMAIN, and the one rule this form will not bend: zero is in it.
    let lo = 0;
    let hi = 0;
    for (const d of ordered) {
      if (stacked || !split) {
        lo = Math.min(lo, d.value); hi = Math.max(hi, d.value);
      } else {
        for (const p of d.parts) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
      }
    }
    if (hi === lo) hi = lo + 1;
    const y = d3.scaleLinear().domain([lo, hi]).nice().range([height - m.bottom, m.top]);
    const zero = y(0);

    // Gridlines behind, and the baseline drawn heavier than the rest because it
    // is the line every length is measured from.
    for (const t of y.ticks(5)) {
      sel.append('line')
        .attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t))
        .attr('stroke', 'var(--_ink)').attr('stroke-opacity', t === 0 ? 0.34 : 0.09);
      sel.append('text')
        .attr('x', m.left - 10).attr('y', y(t)).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6)
        .text(fmt(t));
    }

    const rows = [];
    ordered.forEach((d, i) => {
      const marks = [];
      const place = (name, value, x0, w, y0, y1) => {
        // ONE MEASURE IS ONE COLOUR. With no split there is nothing for hue to
        // encode — the category is already named on the axis — so six colours
        // would be decoration pretending to be information. The house rule
        // (ranked-bar, single-series trend) is a field of `--_mark` with the
        // accent on the mark the headline is about. Where a series IS bound,
        // hue carries it and the palette does the work.
        const subject = !split && stats.biggest && d.name === stats.biggest.name;
        const rect = sel.append('rect')
          .attr('x', x0).attr('width', Math.max(1, w))
          .attr('y', Math.min(y0, y1)).attr('height', Math.max(1, Math.abs(y1 - y0)))
          .attr('fill', split ? (colorFor.get(name) || accent) : (subject ? 'var(--_accent)' : 'var(--_mark)'))
          .attr('fill-opacity', split ? 0.9 : (subject ? 1 : 'var(--_mark-opacity)'))
          // The build reads these: which way the bar grows out of the baseline,
          // and the order along the axis it grows in.
          .attr('data-vf-grow', value < 0 ? 'down' : 'up')
          .attr('data-vf-order', i)
          .attr('data-name', d.name)
          .style('cursor', 'pointer');
        if (subject) rect.attr('data-vf-peak', '1');
        // The RESTING opacity, remembered — a blanket restore to one value is
        // how a field-and-accent chart flattens to one tone the first time a
        // cursor crosses it.
        rect.attr('data-vf-rest', split ? 0.9 : (subject ? 1 : 'var(--_mark-opacity)'));
        marks.push(rect);
        return rect;
      };

      if (!split) {
        place(d.name, d.value, x(d.name), x.bandwidth(), zero, y(d.value));
      } else if (stacked) {
        // Positive above the line, negative below, each stacking away from zero
        // so a mixed-sign stack does not overlap itself.
        let up = 0;
        let down = 0;
        for (const p of d.parts) {
          if (p.value >= 0) { place(p.name, p.value, x(d.name), x.bandwidth(), y(up), y(up + p.value)); up += p.value; }
          else { place(p.name, p.value, x(d.name), x.bandwidth(), y(down), y(down + p.value)); down += p.value; }
        }
      } else {
        const inner = d3.scaleBand().domain(stats.seriesNames).range([x(d.name), x(d.name) + x.bandwidth()]).padding(0.08);
        for (const p of d.parts) place(p.name, p.value, inner(p.name), inner.bandwidth(), zero, y(p.value));
      }

      const label = sel.append('text')
        .attr('font-family', 'var(--_fl)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.78)
        .text(d.name);
      if (rotate) {
        // Truncated to whatever the reserved band actually holds, so a capped
        // margin shows shortened labels rather than labels running off the frame.
        const room = Math.round((m.bottom - 22) / Math.sin(Math.PI * 42 / 180));
        label.text(fitText(d.name, room, LABEL_PX) || '')
          .attr('text-anchor', 'end')
          .attr('transform', `translate(${x(d.name) + x.bandwidth() / 2},${height - m.bottom + 12}) rotate(-42)`);
      } else {
        // fitText takes a STRING and RETURNS one — it is not a DOM operation.
        // Passing the node did nothing at all and threw the result away.
        // Truncated against the band PITCH, not the bar width: labels are
        // centred under their bars, so the padding gutter between bars is
        // usable and the thing that must not collide is the NEIGHBOUR'S label.
        // Clipping to bandwidth cost ~45px per label and shortened names that
        // fit perfectly well.
        label.text(fitText(d.name, band - 6, LABEL_PX) || '')
          .attr('x', x(d.name) + x.bandwidth() / 2)
          .attr('y', height - m.bottom + 18)
          .attr('text-anchor', 'middle');
      }

      rows.push({ d, marks });
    });

    // HOVER: the bar under the cursor holds its colour and every sibling drops
    // back, so a single value is readable against a field of forty.
    for (const row of rows) {
      const enter = () => {
        motion.hold();
        for (const other of rows) {
          for (const mk of other.marks) {
            mk.attr('fill-opacity', other === row ? 1 : 0.16);
          }
        }
        const share = !stats.hasNegative && !stats.rateLike && stats.total > 0
          ? `<div style="opacity:.7">${((100 * row.d.value) / stats.total).toFixed(1)}% of the ${fmt(stats.total)} total</div>`
          : '';
        const breakdown = split
          ? row.d.parts.filter((p) => p.value !== 0)
            .map((p) => `<div><span style="color:${colorFor.get(p.name)}">■</span> ${p.name} &middot; <b>${fmt(p.value)}</b></div>`)
            .join('')
          : '';
        tip.show(`<div><b>${row.d.name}</b></div><div>${fmt(row.d.value)}</div>${breakdown}${share}`,
          x(row.d.name) + x.bandwidth() / 2, Math.min(zero, y(row.d.value)));
      };
      const leave = () => {
        for (const other of rows) {
          for (const mk of other.marks) mk.attr('fill-opacity', mk.attr('data-vf-rest'));
        }
        tip.hide();
        motion.free();
      };
      for (const mk of row.marks) { mk.on('pointerenter', enter); mk.on('pointerleave', leave); }
    }

    return null;
  },
});
