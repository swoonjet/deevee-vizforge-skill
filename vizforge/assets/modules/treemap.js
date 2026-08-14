// TREEMAP — the gallery's `unc-treemap` ("Where the CIO's $101 million goes")
// and its interactive sibling `int-treemap`, ported to take any group / item /
// size table.
//
// HONESTY: the AREA of a rectangle is the value and nothing else is. A tile's
// aspect ratio is an artefact of the squarified layout and its position is an
// artefact of the sort order — neither carries meaning, so the source line says
// so and the piece never invites a reader to compare two tiles by shape or
// place. The rules about what may be summed into a whole at all live in
// hier-shape.js, with the other two forms in this family.
//
// DRILL (`options.drill`, which is what makes this int-treemap): clicking a
// block descends into its group, and the level then restates its OWN total plus
// what share of the whole it is. Without that restatement a drilled level reads
// as the entire budget, which is the usual way an interactive treemap lies.

import { d3Piece } from './d3-piece.js';
import {
  hierShape, hierRoles, hierHeadline, hierDek, hierNote, groupColors, colorOf,
} from './hier-shape.js';
import { resolveAccent, fitText, ifLive} from './vf-core.js';

export const slug = 'treemap';
export const roles = hierRoles;
export const shape = hierShape;

const HEADER = 22;
const CRUMB = 20;

/** What the reader is owed when the layout could not draw everything. */
const smallNote = (n) => (n
  ? `${n} ${n === 1 ? 'item is' : 'items are'} too small to draw at this size and ${n === 1 ? 'is' : 'are'} not shown.`
  : undefined);

export default d3Piece({
  slug, title: 'Treemap', roles, shape,
  build: 'tiles',
  // A drillable piece previews its own drill on a cycle; a still one breathes
  // on the mark the headline names.
  rest: (config) => (config && config.drill ? 'attract' : 'peak'),
  dur: 3400,
  aspect: 0.56,
  hoverNote: (config) => (config && config.drill
    ? 'Hover any block for its exact share; click one to go inside its group.'
    : 'Hover a block for its share of its group and of the whole.'),

  headline: hierHeadline,
  dek: hierDek,
  note: (stats) => hierNote(stats,
    'rectangle AREA is the value — the shape of a tile and where it sits are the layout\'s doing and carry nothing'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.children || !data.children.length) return null;

    const drill = Boolean(config.drill);
    const groups = data.children;
    const opened = drill && view.group ? groups.find((g) => g.name === view.group) || null : null;
    const shown = opened || data;
    const levelTotal = shown.value || 0;

    const top = drill ? CRUMB : 0;
    const nested = (shown.children || []).some((c) => c.children && c.children.length);

    const root = d3.hierarchy(shown, (d) => d.children)
      .sum((d) => (d.children && d.children.length ? 0 : d.value))
      .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([width, Math.max(40, height - top)])
      .paddingOuter(3)
      .paddingTop(nested ? HEADER : 3)
      .paddingInner(2)
      .round(true)(root);

    const g = sel.append('g').attr('transform', `translate(0,${top})`);

    // WHAT THE ACCENT MARKS is whatever the headline says. At the top of a
    // nested table the finding is a GROUP; inside one — or in a flat table —
    // it is the largest item.
    const starIsGroup = !opened && nested && groups.length > 1;
    const star = opened
      ? (opened.children && opened.children.length ? opened.children[0].name : null)
      : (starIsGroup ? groups[0].name : (stats.biggestLeaf ? stats.biggestLeaf.name : null));

    const palette = groupColors(stats, colors, {
      accent: resolveAccent(ctx.el),
      star: starIsGroup ? star : (opened ? opened.name : null),
    });
    const colorFor = (n) => {
      if (opened) return colorOf(palette, colors, opened.name);
      const t = n.ancestors().find((a) => a.depth === 1);
      return colorOf(palette, colors, t ? t.data.name : n.data.name);
    };

    const leaves = [];
    // Rounding to whole pixels can take a genuinely small item to zero area.
    // Nothing is drawn for it, so the partition on screen is not quite the
    // partition in the data — and the piece has to say how many are missing
    // rather than let the reader assume they are looking at all of it.
    let tooSmall = 0;

    for (const n of root.descendants()) {
      if (n.depth === 0) continue;
      const w = n.x1 - n.x0;
      const h = n.y1 - n.y0;
      if (!(w > 0 && h > 0)) {
        if (!(n.children && n.children.length)) tooSmall += 1;
        continue;
      }

      const color = colorFor(n);
      const branch = Boolean(n.children && n.children.length);

      if (branch) {
        const isStar = starIsGroup && n.data.name === star;
        g.append('rect')
          .attr('x', n.x0).attr('y', n.y0).attr('width', w).attr('height', h).attr('rx', 4)
          .attr('fill', 'none')
          .attr('stroke', isStar ? 'var(--_accent)' : color)
          .attr('stroke-width', isStar ? 2 : 1.3)
          .attr('data-vf-tile', '');
        if (h > HEADER + 6) {
          // The value only when the name has already fitted — a header clipped
          // mid-number ("TELECOM · 5" over a 5.9 group) is worse than no number.
          const full = `${String(n.data.name).toUpperCase()} · ${fmt(n.value)}`;
          const header = fitText(full, w - 14, 10.5)
            || fitText(String(n.data.name).toUpperCase(), w - 14, 10.5);
          if (header) {
            g.append('text')
              .attr('x', n.x0 + 8).attr('y', n.y0 + 15)
              .attr('font-family', 'var(--_ff)').attr('font-size', 10.5).attr('font-weight', 700)
              .attr('letter-spacing', '.04em')
              .attr('fill', isStar ? 'var(--_accent)' : color)
              .text(header);
          }
        }
        continue;
      }

      const groupName = n.parent && n.parent.depth >= 1 ? n.parent.data.name : (opened ? opened.name : '');
      const groupTotal = n.parent && n.parent.depth >= 1 ? n.parent.value : levelTotal;
      // The mark breathes when it is the finding — including every tile of the
      // group the headline names, which must breathe TOGETHER or they read as
      // several separate signals.
      const peak = starIsGroup ? groupName === star : n.data.name === star;

      const rect = g.append('rect')
        .attr('x', n.x0).attr('y', n.y0).attr('width', w).attr('height', h).attr('rx', 3)
        .attr('fill', color)
        .attr('fill-opacity', peak ? 0.95 : 0.72)
        .attr('data-vf-tile', '')
        .attr('data-name', n.data.name);
      if (peak) rect.attr('data-vf-peak', '');

      const rec = { rect, name: n.data.name, group: groupName, value: n.value };
      leaves.push(rec);

      // A label only where it fits. A name that overflows its tile lands on the
      // next one and appears to label THAT.
      const nameSize = Math.min(14, Math.max(10, w / 11));
      const label = w > 60 && h > 30 ? fitText(n.data.name, w - 14, nameSize) : null;
      if (label) {
        g.append('text')
          .attr('x', n.x0 + 8).attr('y', n.y0 + 19)
          .attr('font-family', 'var(--_fl)').attr('font-size', nameSize)
          .attr('font-weight', 600).attr('fill', 'var(--_paper)')
          .text(label);
        if (h > 52) {
          g.append('text')
            .attr('x', n.x0 + 8).attr('y', n.y0 + 35)
            .attr('font-family', 'var(--_ff)').attr('font-size', 10.5)
            .attr('fill', 'var(--_paper)').attr('fill-opacity', 0.85)
            .text(fmt(n.value));
        }
      }

      const enter = () => {
        // The rest and this handler both write style.opacity; without the
        // handoff the rest lands one frame later and un-dims a sibling.
        motion.hold();
        for (const other of leaves) {
          other.rect.style('opacity', other === rec ? 1 : (other.group === groupName ? 0.45 : 0.15));
        }
        const ofGroup = groupTotal > 0 ? (100 * n.value) / groupTotal : 0;
        const ofAll = stats.total > 0 ? (100 * n.value) / stats.total : 0;
        // The group share is worth saying whenever the group is not the whole —
        // including inside a drill, where it is the more useful of the two.
        const inGroup = groupName && groupTotal > 0 && Math.abs(groupTotal - stats.total) > 1e-9;
        tip.show(
          `<div style="color:${color}"><b>${n.data.name}</b></div>`
          + `<div><b>${fmt(n.value)}</b>${inGroup ? ` &middot; ${ofGroup.toFixed(0)}% of ${String(groupName).toLowerCase()}` : ''}</div>`
          + `<div style="opacity:.7">${ofAll.toFixed(ofAll < 10 ? 1 : 0)}% of the ${fmt(stats.total)} whole</div>`,
          n.x0 + w / 2, top + n.y0 + h / 2
        );
      };

      rect.on('pointerenter', enter);
      rect.on('pointerleave', () => {
        for (const other of leaves) other.rect.style('opacity', '');
        tip.hide();
        motion.free();
      });

      if (drill && !opened && groupName) {
        rect.style('cursor', 'zoom-in');
        rect.on('click', () => {
          tip.hide();
          view.group = groupName;
          motion.replay();  // a new level is a new picture: let it assemble
          ctx.redraw();
        });
      }
    }

    // ---- the way back, and the restatement that keeps a drill honest -------
    if (drill) {
      // Declared, not drawn. The harness renders a real button with a hit area,
      // a hover state and an Escape binding; this used to be an 11px SVG <text>
      // that readers reasonably mistook for a caption and got stuck behind.
      // Nothing at all at the top level — the invitation to descend belongs in
      // the dek, and a permanent inert "All groups" was only clutter.
      ctx.trail(opened ? {
        label: 'All groups',
        crumbs: `${opened.name} · ${fmt(levelTotal)}`,
        onHome() {
          tip.hide();
          view.group = null;
          motion.replay();
          ctx.redraw();
        },
      } : null);

      ctx.setCopy(opened
        ? {
          dekAppend: smallNote(tooSmall),
          headline: `Inside ${opened.name}: ${star || 'one item'} leads `
            + `${opened.children ? opened.children.length : 0} line items`,
          // No longer explains the way out: the button above the picture says
          // it, and says it where the reader's eye already is. What the dek
          // owes them instead is the thing the picture cannot show — that the
          // shares they are about to read have changed denominator.
          dek: `${fmt(levelTotal)} in this group — ${((100 * levelTotal) / (stats.total || 1)).toFixed(0)}% of the `
            + `${fmt(stats.total)} whole. Shares below are of this group unless they say otherwise.`,
        }
        : {
          dekAppend: smallNote(tooSmall),
          headline: hierHeadline(stats),
          dek: `${hierDek(stats)}${ifLive(config, ' Click a block to go inside its group.')}`,
        });
    } else {
      ctx.setCopy({ dekAppend: smallNote(tooSmall) });
    }

    // ---- attract: the interaction demonstrates itself, paint only ----------
    let attract;
    if (drill && leaves.length > 1) {
      const order = [...leaves].sort((a, b) => b.value - a.value).slice(0, 6);
      attract = {
        count: order.length,
        apply(i, amp) {
          const lit = order[i];
          for (const t of leaves) t.rect.style('opacity', t === lit ? '1' : String(1 - 0.4 * amp));
        },
        clear() { for (const t of leaves) t.rect.style('opacity', ''); },
      };
    }

    return { attract };
  },
});
