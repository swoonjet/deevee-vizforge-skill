// UNIT CHART — the gallery's `unc-units` ("What a deal costs — 82 tiles"),
// ported to take any count, optionally split by category.
//
// HONESTY: EVERY TILE IS ONE UNIT AND ALL TILES ARE THE SAME SIZE. That is the
// entire form. Scaling a glyph to represent "more" is the classic pictogram lie
// and the atlas refuses it outright; here the only thing that varies is HOW
// MANY, which is why a reader can literally count the answer.
//
// The other half of the rule is knowing when to stop: past a few hundred tiles
// nobody counts, and the piece becomes a texture pretending to be a tally. The
// registry refuses it there and names the bar chart instead.

import { d3Piece } from './d3-piece.js';
import { hierShape, hierRoles, hierNote, groupColors, colorOf } from './hier-shape.js';
import { resolveAccent, fitText, formatNumber } from './vf-core.js';

export const slug = 'units';
export const roles = {
  category: { types: ['nominal', 'ordinal'], required: false, label: 'Group' },
  value: { types: ['quantitative'], required: true, label: 'How many' },
};
export const shape = (rows, bindings = {}) => hierShape(rows, {
  levels: [bindings.category || bindings.parent].filter(Boolean),
  value: bindings.value,
});

const CAP = 600;

export default d3Piece({
  slug, title: 'Unit chart', roles, shape,
  build: 'count',
  rest: 'peak',
  dur: 3600,
  aspect: 0.52,
  hoverNote: 'Hover a group for its exact count.',

  headline(stats) {
    const g = stats.biggestGroup;
    const total = Math.round(stats.total);
    if (g && stats.groupCount > 1) {
      return `${total} in all, and ${Math.round(g.value)} of them are ${g.name}`;
    }
    return `${total} in all, one tile each`;
  },
  dek(stats) {
    return `${stats.groupCount > 1 ? `${stats.groupCount} groups, ` : ''}`
      + `${formatNumber(Math.round(stats.total))} units — every tile is one, and they are all the same size.`;
  },
  note: (stats) => hierNote(stats,
    'one tile is one unit and every tile is identical — a bigger glyph would be a bigger lie, not a bigger number'),

  draw(ctx) {
    const { sel, width, height, data, stats, colors, tip, fmt, motion } = ctx;
    const groups = (data.children && data.children.length ? data.children : [{ name: '', value: stats.total }])
      .map((gp) => ({ name: gp.name, value: Math.max(0, Math.round(gp.value)), seq: gp.seq || 0 }))
      .sort((a, b) => a.seq - b.seq);

    const total = groups.reduce((s, gp) => s + gp.value, 0);
    if (!total) return null;

    // ONE TILE PER UNIT until the tally stops being countable; past the cap the
    // piece says what one tile now stands for rather than quietly rounding.
    const per = total > CAP ? Math.ceil(total / CAP) : 1;
    const tilesFor = (v) => Math.max(v > 0 ? 1 : 0, Math.round(v / per));
    const drawn = groups.reduce((s, gp) => s + tilesFor(gp.value), 0);

    const labelRoom = groups.some((gp) => gp.name) ? Math.min(190, Math.max(90, width * 0.16)) : 8;
    const m = { top: 8, right: 12, bottom: 8, left: labelRoom };
    const plotW = Math.max(20, width - m.left - m.right);
    const plotH = Math.max(20, height - m.top - m.bottom);

    // A square-ish tile that fits every unit in the box, with its own gutter.
    const cols = Math.max(1, Math.ceil(Math.sqrt((drawn * plotW) / Math.max(1, plotH))));
    const rows = Math.max(1, Math.ceil(drawn / cols));
    const cell = Math.max(3, Math.min(plotW / cols, plotH / rows));
    const size = Math.max(2, cell * 0.78);

    const star = stats.biggestGroup ? stats.biggestGroup.name : null;
    const palette = groupColors(stats, colors, { accent: resolveAccent(ctx.el), star });

    let i = 0;
    const marks = [];
    for (const gp of groups) {
      const colour = colorOf(palette, colors, gp.name);
      const count = tilesFor(gp.value);
      const first = i;
      for (let k = 0; k < count; k += 1, i += 1) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const rect = sel.append('rect')
          .attr('x', m.left + col * cell).attr('y', m.top + row * cell)
          .attr('width', size).attr('height', size).attr('rx', Math.min(2, size / 4))
          .attr('fill', colour)
          .attr('fill-opacity', gp.name === star ? 0.95 : 0.8)
          .attr('data-vf-unit', '')
          .attr('data-name', gp.name);
        if (gp.name === star) rect.attr('data-vf-peak', '');
        marks.push({ rect, group: gp.name });
      }

      // The group's name against its own first tile, on the left.
      if (gp.name) {
        const row = Math.floor(first / cols);
        const label = fitText(gp.name, labelRoom - 14, 11.5);
        if (label) {
          sel.append('text')
            .attr('x', m.left - 10).attr('y', m.top + row * cell + size / 2 + 4).attr('text-anchor', 'end')
            .attr('font-family', 'var(--_fl)').attr('font-size', 11.5).attr('font-weight', 600)
            .attr('fill', gp.name === star ? 'var(--_accent)' : 'var(--_ink)')
            .attr('fill-opacity', gp.name === star ? 1 : 0.8)
            .text(label);
        }
      }
    }

    for (const mark of marks) {
      mark.rect.style('cursor', 'pointer');
      mark.rect.on('pointerenter', () => {
        motion.hold();
        for (const other of marks) other.rect.style('opacity', other.group === mark.group ? 1 : 0.2);
      });
      mark.rect.on('pointermove', (event) => {
        const gp = groups.find((x) => x.name === mark.group);
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        tip.show(
          `<div><b>${gp.name || 'All'}</b></div>`
          + `<div><b>${fmt(gp.value)}</b> of ${fmt(total)}</div>`
          + `<div style="opacity:.7">${((100 * gp.value) / total).toFixed(1)}%</div>`,
          px, py
        );
      });
      mark.rect.on('pointerleave', () => {
        for (const other of marks) other.rect.style('opacity', '');
        tip.hide();
        motion.free();
      });
    }

    // WHEN A TILE STOPS BEING ONE THING, SAY SO. This is the only condition
    // under which this form may draw fewer marks than it has units.
    ctx.setCopy({ dekAppend: per > 1 ? `One tile is ${per} units at this size.` : undefined });

    return null;
  },
});
