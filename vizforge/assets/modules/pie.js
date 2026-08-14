// PIE / DONUT (conv-pie) — part-to-whole, and only ever part-to-whole.
//
// The most-argued-about chart there is, so the constraints are worth stating.
// A pie is honest for ONE question — how a whole divides — and dishonest for
// almost every other, because comparing two angles is far harder than comparing
// two lengths. This module therefore does three things a default pie does not:
//
//   1. REFUSES what it cannot show. Negative values have no angle; parts that
//      do not sum to a meaningful whole (a rate, an average) have no whole; and
//      past a dozen slices nobody can read the small ones. The registry's fit
//      rule turns each of those into a named refusal that points at a bar.
//   2. PRINTS THE NUMBER on every slice big enough to hold it, because the
//      angle is the weak part of the encoding and the label is the strong one.
//   3. ORDERS BY SIZE from twelve o'clock, so the reader's first comparison —
//      the two biggest — is the one comparison a pie is actually good at.
//
// DONUT vs PIE is `options.donut`, and it is not decoration: the hole is where
// the total goes, which turns "these are the shares" into "these are the shares
// OF THIS", stated rather than implied.
//
// THE ENTRANCE sweeps each slice open through its own angle from twelve
// o'clock, in size order — the circle filling itself in. Not a fade and not a
// scale: a slice's ANGLE is its value, so the angle is what has to arrive
// ([[feedback_viz_no_fade_builds]]).
//
// THE BREAKDOWN, and why this form needs a second column. A circle is
// HEIGHT-BOUND: on the 2.8:1 stage this library mounts into, a disc at 78% of
// the height reached 28% of the width and the other 72% was blank paper. A
// bigger radius wins nothing there — the fix is a layout, not a scale. So in a
// box too wide for a circle, the width the circle cannot use carries a table:
// swatch, part, value, share, and a RUNNING share.
//
// What that table deliberately is NOT is a bar chart. Length beside angle would
// be the same numbers encoded twice, and the stronger encoding would win — the
// registry's own refusal past eight slices already says to use a bar when
// length is what you want, so drawing one here would make the disc decoration.
// A table adds what the disc cannot hold instead: every part named (including
// the ones under 4% that no slice can label), the exact figures, and the
// running column, which is the one part-to-whole reading a pie is silent about
// — how few parts it takes to make most of the whole. Rows and slices are the
// same hover, in both directions, so the table is a control and not a caption.

import { d3Piece, radialSideTable } from './d3-piece.js';
import { catShape, catRoles, catNote, catColors } from './cat-shape.js';
import { formatNumber, resolveAccent, fitText } from './vf-core.js';

export const slug = 'pie';
export const roles = catRoles;
export const shape = catShape;

function pieHeadline(stats) {
  const b = stats.biggest;
  if (!b) return 'Nothing to divide';
  const measure = stats.counting ? 'rows' : stats.valueName;
  return `${b.name} is ${Math.round(b.share * 100)}% of the ${formatNumber(stats.total)} ${measure}`;
}

export default d3Piece({
  slug, title: 'Pie / donut', roles, shape,
  build: 'ring', rest: 'walk', dur: 3400, aspect: 0.62, minHeight: 300,
  // The registry has always declared `walk` here, and nothing was tagged for it
  // — `walk` selects `[data-vf-walk]`, found none, and returned null, so the one
  // place documenting this form's motion described a rest that never ran. The
  // spotlight is apt for a part-to-whole: it reads the slices out in size order.
  restSelect: '[data-vf-walk]',
  // Stays slice-only because `hoverNote` is resolved at frame-build time, before
  // the box is measured — it cannot know whether there are rows to hover. The
  // row link is stated by the dek instead, which is written from inside draw().
  hoverNote: 'Hover a slice for its exact share.',

  headline: pieHeadline,
  dek(stats) {
    const measure = stats.counting ? 'rows' : stats.valueName;
    const two = stats.categoryCount > 2
      ? ` The two largest hold ${Math.round(100 * stats.topTwoShare)}% between them.`
      : '';
    return `${stats.categoryCount} parts of ${formatNumber(stats.total)} ${measure}.${two}`;
  },
  note: (stats) => catNote(stats,
    'each slice is its share of the whole and the slices sum to 100% — angle is a weak comparison, so every '
    + 'readable slice carries its own number'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, config, motion, el } = ctx;
    if (!data.length || stats.total <= 0) return null;

    // Options from a registry fit land at the TOP LEVEL of config (the screen
    // does Object.assign(config, entry.options)), which is the same place
    // treemap reads `drill` and sankey reads `isolate`. Reading config.options
    // instead silently disables the mode: the picture draws, correctly, in the
    // wrong variant, and no test that only counts marks can see it.
    const donut = Boolean(config.donut);
    const accent = resolveAccent(el);
    const colorFor = catColors(stats, colors, accent);

    // ONE rounding for the whole figure. A slice printed "10%" beside a row
    // reading "9.6%" is the same number said two ways inside one picture, which
    // is the kind of small contradiction a reader is right not to forgive. Under
    // a tenth the decimal earns its place: it is what separates 9.6 from 5.9.
    const pct = (share) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

    // THE SPLIT AND THE TABLE both come from the shared radial helper: a circle
    // is height-bound, so the width it cannot use carries a breakdown. What is
    // IN that breakdown is this form's own decision and stays here — every part
    // named (including the ones no slice is wide enough to label), its figure,
    // its share, and a RUNNING share, which is the one part-to-whole reading a
    // pie is silent about: how few parts make most of the whole.
    const showRunning = data.length >= 4;
    let running = 0;
    const tableRows = data.map((d) => {
      const share = stats.total > 0 ? d.value / stats.total : 0;
      running += share;
      return {
        name: d.name,
        colour: colorFor.get(d.name) || accent,
        cells: {
          value: fmt(d.value),
          share: pct(share),
          running: showRunning ? `${Math.round(running * 100)}%` : '',
        },
      };
    });

    const box = radialSideTable(ctx, {
      columns: [
        { key: 'name', header: stats.categoryName },
        { key: 'value', header: stats.counting ? 'rows' : stats.valueName },
        { key: 'share', header: 'share', weight: 600 },
        ...(showRunning ? [{ key: 'running', header: 'running', fade: 0.55 }] : []),
      ],
      rows: tableRows,
      // THE HOLE STATES THE TOTAL WHERE THERE IS ONE. In pie mode there is no
      // hole, so the table takes the foot — that is the whole difference the
      // donut option makes, kept consistent rather than said twice.
      foot: donut ? null : { name: 'Total', cells: { value: fmt(stats.total), share: '100%' } },
    });
    const { split, cx, cy, outer } = box;
    const rows = box.bands;
    const inner = donut ? outer * 0.58 : 0;

    // Biggest first from twelve o'clock: the one comparison a pie is good at is
    // between adjacent large slices, so they are put next to each other.
    const arcs = d3.pie().sort(null).value((d) => Math.max(0, d.value))(data);
    const arc = d3.arc().innerRadius(inner).outerRadius(outer).padAngle(0.006);
    const labelArc = d3.arc().innerRadius((inner + outer) / 2).outerRadius((inner + outer) / 2);

    // ONE translated group for everything radial, so the arc generator, the
    // slice labels and the sweep all work in the same space — the centre.
    // Drawing at the origin and re-parenting afterwards is how a radial piece
    // ends up with its labels a half-frame away from its wedges.
    const g = sel.append('g').attr('transform', `translate(${cx},${cy})`);

    const slices = [];
    arcs.forEach((a, i) => {
      const share = a.data.value / stats.total;
      const path = g.append('path')
        .attr('d', arc(a))
        .attr('fill', colorFor.get(a.data.name) || accent)
        .attr('fill-opacity', 0.9)
        .attr('data-vf-arc', '1')
        .attr('data-vf-order', i)
        .attr('data-vf-walk', '')
        .attr('data-name', a.data.name)
        .style('cursor', 'pointer');
      slices.push({ a, path, share });

      // A slice under about 4% cannot hold text without overlapping its
      // neighbours, so it goes unlabelled rather than illegibly labelled — and
      // the dek says how many did, so a reader is never left counting.
      if (share >= 0.04) {
        const [lx, ly] = labelArc.centroid(a);
        const t = g.append('text')
          .attr('x', lx).attr('y', ly)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 12)
          .attr('fill', 'var(--_paper)').attr('font-weight', 600)
          .attr('pointer-events', 'none')
          .text(pct(share));
        // fitText is a STRING helper (name, maxPx, fontPx) -> string. It was
        // being handed the DOM node and its result discarded, so it did nothing.
        // A percentage is at most 5 characters, so this only ever bites on a very
        // thin donut ring.
        t.text(fitText(pct(share), (outer - inner) * 0.9, 12) || '');
      }
    });

    // Direct labels around the rim, which is what removes the need for a legend
    // — a legend makes the reader look away from the picture to decode it. In
    // split mode the table is that direct labelling, in a column, with the
    // figures attached; repeating the names on the rim would be the same words
    // twice and would cost the disc the 54px inset they need.
    if (!split) {
      slices.forEach(({ a, share }) => {
        if (share < 0.04) return;
        const mid = (a.startAngle + a.endAngle) / 2 - Math.PI / 2;
        const r = outer + 14;
        const anchor = Math.cos(mid) < -0.15 ? 'end' : Math.cos(mid) > 0.15 ? 'start' : 'middle';
        g.append('text')
          .attr('x', Math.cos(mid) * r).attr('y', Math.sin(mid) * r)
          .attr('text-anchor', anchor).attr('dominant-baseline', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', 11.5)
          .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.82)
          .attr('pointer-events', 'none')
          .text(a.data.name);
      });
    }

    const unlabelled = slices.filter((s) => s.share < 0.04).length;
    if (split) {
      // WHY THE ORDER IS STATED. Taking the rim labels off makes colour the only
      // thing joining a row to its slice, and the palette is six colours — a
      // seventh part reuses one, which is cosmetic on a treemap (its rectangles
      // are labelled) and misleading here. The rows and the slices are the same
      // sequence, so saying so replaces the swatch as the link and costs no ink.
      // Cheaper and truer than capping the form at six or inventing a colour.
      // `static: true` is a raster, and vf-core's interactionNote() drops the
      // "Hover to…" clause from the dek for exactly that reason — a PNG cannot be
      // hovered. This sentence is written from inside draw() and so bypasses that
      // filter; it has to honour the same rule itself or the export ships an
      // instruction the reader cannot follow.
      // One imperative per dek: the declared hoverNote already says to hover, so
      // this states the READING (the order, which is what replaces the swatch as
      // the row-to-slice link) and the fact that the two are joined — without a
      // second "hover" sitting one clause away from the first.
      const clockwise = 'Rows run clockwise from twelve o\'clock, largest first';
      const order = config.static ? `${clockwise}.` : `${clockwise}, and a row lights its slice.`;
      ctx.setCopy({
        dekAppend: unlabelled
          // Not an apology any more: the parts a slice is too thin to label are
          // in the table with their figures, so the sentence says where to look.
          ? `${order} ${unlabelled} ${unlabelled === 1 ? 'slice is' : 'slices are'} under 4% and too narrow `
            + 'to label — the breakdown carries every part.'
          : order,
      });
    } else if (!unlabelled) {
      ctx.setCopy({ dekAppend: '' });
    } else {
      ctx.setCopy({
        dekAppend: `${unlabelled} ${unlabelled === 1 ? 'slice is' : 'slices are'} under 4% and too narrow to label — `
          + 'hover for their values.',
      });
    }

    // THE HOLE IS NOT DECORATION: it states what the shares are shares OF.
    if (donut) {
      g.append('text')
        .attr('x', 0).attr('y', -6).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_fh)').attr('font-size', Math.min(34, inner * 0.42)).attr('font-weight', 700)
        .attr('fill', 'var(--_ink)').attr('pointer-events', 'none')
        .text(fmt(stats.total));
      g.append('text')
        .attr('x', 0).attr('y', 16).attr('text-anchor', 'middle')
        .attr('font-family', 'var(--_ff)').attr('font-size', 11)
        .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.6).attr('pointer-events', 'none')
        .text(stats.counting ? 'rows in total' : `total ${stats.valueName}`);
    }

    // ONE emphasis for both surfaces. `motion.hold()` is not optional: the walk
    // rest writes style.opacity on the same arcs, and a rest that yields and
    // restores lands ONE FRAME AFTER the handler dimmed, so the emphasised slice
    // refuses to dim with its siblings. hold() tears it down synchronously.
    const emphasise = (name) => {
      motion.hold();
      for (const o of slices) o.path.attr('fill-opacity', o.a.data.name === name ? 1 : 0.18);
      for (const r of rows) r.band.attr('fill-opacity', r.name === name ? 0.055 : 0);
    };
    const relax = () => {
      for (const o of slices) o.path.attr('fill-opacity', 0.9);
      for (const r of rows) r.band.attr('fill-opacity', 0);
      tip.hide();
      motion.free();
    };

    for (const s of slices) {
      s.path.on('pointerenter', () => {
        emphasise(s.a.data.name);
        const [lx, ly] = labelArc.centroid(s.a);
        tip.show(
          `<div><b>${s.a.data.name}</b></div>`
          + `<div>${fmt(s.a.data.value)} &middot; <b>${(s.share * 100).toFixed(1)}%</b></div>`
          + `<div style="opacity:.7">of ${fmt(stats.total)} ${stats.counting ? 'rows' : stats.valueName}</div>`,
          cx + lx, cy + ly
        );
      });
      s.path.on('pointerleave', relax);
    }

    // A row hover raises no tip, deliberately: the row already prints the value,
    // the share and the running share, so a tooltip would repeat the line the
    // cursor is on. What the row cannot show is WHICH slice it is, and that is
    // exactly what the emphasis answers.
    for (const r of rows) {
      r.band.on('pointerenter', () => emphasise(r.name));
      r.band.on('pointerleave', relax);
    }

    // THE SWEEP: each slice opens through its OWN angle, in size order. Handing
    // this to the harness rather than letting `ring` scale a finished path is
    // what keeps the motion radial — see the sunburst for the same contract.
    const sweepAt = (i, t) => {
      const rec = slices[i];
      if (!rec) return;
      const e = Math.max(0, Math.min(1, t));
      rec.path.attr('d', arc({ ...rec.a, endAngle: rec.a.startAngle + (rec.a.endAngle - rec.a.startAngle) * e }));
    };

    return {
      origin: [cx, cy],
      sweep: {
        count: slices.length,
        apply(i, t) {
          if (i < 0) { for (let k = 0; k < slices.length; k += 1) sweepAt(k, t); return; }
          sweepAt(i, t);
        },
      },
    };
  },
});
