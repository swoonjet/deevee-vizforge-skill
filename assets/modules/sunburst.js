// SUNBURST — the gallery's `unc-sunburst` ("What the flagships are made of")
// and its interactive sibling `int-sunburst`, ported to take any nested table.
//
// HONESTY, and it is the difference between this and the gallery's original:
// ANGLE IS THE SHARE. The gallery piece gave every repo an EQUAL wedge and let
// the outer ring divide it, which is a legitimate small-multiple-in-a-circle
// but is not a sunburst — a reader who assumes the standard reading gets a
// false comparison between the twelve. Here a wedge's angle is its value's
// share of its parent, so both rings partition and the two readings agree.
//
// The other rule a ring form owes its reader: a ring only PARTITIONS if every
// child is present. Where a group's children do not add up to the group (they
// cannot here — the shaper sums the children to make the parent) there would
// have to be a remainder wedge, and the piece would have to name it.
//
// ZOOM (`options.zoom`, which is what makes this int-sunburst): clicking a
// wedge makes it the whole circle, and the centre then states the branch total
// AND what share of the whole it is — so a child is never read as a share of
// something it is not.

import { d3Piece, radialSideTable } from './d3-piece.js';
import {
  hierShape, hierRoles, hierHeadline, hierDek, hierNote, groupColors, colorOf,
} from './hier-shape.js';
import { resolveAccent, fitText, textWidth, ifLive} from './vf-core.js';

export const slug = 'sunburst';
export const roles = hierRoles;
export const shape = hierShape;

export default d3Piece({
  slug, title: 'Sunburst', roles, shape,
  build: 'ring',
  rest: (config) => (config && config.zoom ? 'attract' : 'walk'),
  restSelect: '[data-vf-walk]',
  dur: 3800,
  aspect: 0.62,
  minHeight: 300,
  hoverNote: (config) => (config && config.zoom
    ? 'Hover a wedge to read its share; click one to make it the whole circle.'
    : 'Hover a wedge for its share of its ring.'),

  headline: hierHeadline,
  dek: hierDek,
  note: (stats) => hierNote(stats,
    'angle is the share of the ring it sits in — the inner ring is the whole, the outer ring divides it'),

  draw(ctx) {
    const { d3, sel, width, height, data, stats, colors, tip, fmt, view, config, motion } = ctx;
    if (!data.children || !data.children.length) return null;

    const zoom = Boolean(config.zoom);
    const groups = data.children;
    const opened = zoom && view.branch ? groups.find((g) => g.name === view.branch) || null : null;
    const shown = opened || data;
    const levelTotal = shown.value || 0;

    // THE LEVEL'S OWN BREAKDOWN, in the width a circle cannot use.
    //
    // A sunburst is height-bound like every radial form and was reaching 33% of
    // the plot width. What belongs in the rest of it is THIS LEVEL's parts —
    // which means the table follows the drill: at the top it lists the groups, and
    // inside an opened branch it lists that branch's own items. Share is share OF
    // THE LEVEL, matching what the wedges actually encode, because a ring's angle
    // is its share of the ring it sits in and nothing else.
    //
    // NO SWATCH WHEN OPENED. Inside one branch every wedge takes that branch's
    // colour, so a swatch column would print the same square on every row — a
    // legend for a distinction that is not being made.
    const levelParts = [...(shown.children || [])].sort((a, b) => b.value - a.value);
    const levelPalette = groupColors(stats, colors, {
      accent: resolveAccent(ctx.el),
      star: opened ? opened.name : (stats.biggestGroup ? stats.biggestGroup.name : null),
    });
    const box = radialSideTable(ctx, {
      // Its labels read outward INSIDE the wedges, so the unsplit inset is small:
      // there is no rim of names outside the disc to leave room for.
      rimRoom: 14,
      columns: [
        { key: 'name', header: opened ? `inside ${opened.name}` : (stats.levels || [])[0] || 'group' },
        { key: 'value', header: stats.valueName || 'value' },
        { key: 'share', header: 'of level', weight: 600 },
      ],
      rows: levelParts.map((c) => ({
        name: c.name,
        colour: opened ? null : colorOf(levelPalette, colors, c.name),
        cells: {
          value: fmt(c.value),
          share: `${Math.round((100 * c.value) / (levelTotal || 1))}%`,
        },
      })),
    });
    const cx = box.cx;
    const cy = box.split ? box.cy : height / 2;
    const R = box.outer;
    const hole = R * 0.34;

    const root = d3.hierarchy(shown, (d) => d.children)
      .sum((d) => (d.children && d.children.length ? 0 : d.value))
      .sort((a, b) => b.value - a.value);
    d3.partition().size([2 * Math.PI, 1])(root);

    const depth = Math.max(1, root.height);
    const bandOf = (d) => {
      const inner = hole + ((R - hole) * (d.depth - 1)) / depth;
      const outer = hole + ((R - hole) * d.depth) / depth;
      return [inner, outer - 2];
    };

    const arc = d3.arc()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => bandOf(d)[0])
      .outerRadius((d) => bandOf(d)[1])
      .padAngle(0.005)
      .padRadius(R);

    const g = sel.append('g').attr('transform', `translate(${cx},${cy})`);

    const palette = groupColors(stats, colors, {
      accent: resolveAccent(ctx.el),
      star: opened ? opened.name : (stats.biggestGroup ? stats.biggestGroup.name : null),
    });
    const colorFor = (n) => {
      if (opened) return colorOf(palette, colors, opened.name);
      const t = n.ancestors().find((a) => a.depth === 1);
      return colorOf(palette, colors, t ? t.data.name : n.data.name);
    };

    // The centre is the piece's readout: what you are looking at, and what it
    // is worth. It restates itself on hover and on zoom, which is where the
    // honesty of both interactions actually lives.
    //
    // AND IT HAS TO FIT THE HOLE. A readout wider than the centre disc runs out
    // over the wedges, where it is illegible and looks like a label belonging to
    // one of them — so a too-long line steps down to a shorter phrasing rather
    // than being drawn anyway.
    const nameSize = Math.min(20, hole * 0.36);
    const room = hole * 1.72;
    const centreName = g.append('text')
      .attr('text-anchor', 'middle').attr('y', -2)
      .attr('font-family', 'var(--_fh)').attr('font-size', nameSize)
      .attr('font-weight', 700).attr('fill', 'var(--_ink)');
    const centreValue = g.append('text')
      .attr('text-anchor', 'middle').attr('y', 18)
      .attr('font-family', 'var(--_ff)').attr('font-size', 11)
      .attr('fill', 'var(--_ink)').attr('fill-opacity', 0.7);

    /** name, then the first of `lines` that fits the hole. */
    const setCentre = (name, ...lines) => {
      centreName.text(fitText(name, room, nameSize) || '');
      const pick = lines.find((l) => l && textWidth(l, 11) <= room);
      centreValue.text(pick || fitText(lines[lines.length - 1] || '', room, 11) || '');
    };

    const restoreCentre = () => (opened
      ? setCentre(opened.name,
        `${fmt(levelTotal)} · ${((100 * levelTotal) / (stats.total || 1)).toFixed(0)}% of the whole`,
        fmt(levelTotal))
      : setCentre(`${stats.leafCount} items`, fmt(stats.total)));
    restoreCentre();

    const wedges = [];
    // EVERY wedge is drawn, including the slivers. A ring only partitions if
    // all of its children are there, so dropping the ones too thin to see would
    // leave a gap that reads as a missing category rather than a small one.
    const nodes = root.descendants().filter((n) => n.depth > 0 && n.x1 - n.x0 > 0);
    const orderIn = new Map();

    for (const n of nodes) {
      const seen = orderIn.get(n.depth) || 0;
      orderIn.set(n.depth, seen + 1);
      const color = colorFor(n);
      const outer = n.depth === root.height;
      const path = g.append('path')
        .attr('d', arc(n))
        .attr('fill', color)
        .attr('fill-opacity', outer ? 0.9 : 0.55)
        .attr('stroke', 'var(--_paper)')
        .attr('stroke-width', 1)
        .attr('data-vf-arc', '')
        .attr('data-vf-ring', n.depth)
        .attr('data-vf-order', seen)
        .attr('data-name', n.data.name)
        .style('cursor', zoom && n.depth === 1 && !opened ? 'zoom-in' : 'default');
      if (outer) path.attr('data-vf-walk', '');

      const rec = { path, node: n, name: n.data.name, value: n.value };
      wedges.push(rec);

      // A LABEL READS OUTWARD along its own radius, flipped on the left half so
      // it is never upside down. The flip is a second rotate AFTER the
      // translate — adding 180° to the FIRST rotation instead moves the anchor
      // to the opposite side of the circle, which is how the first cut of this
      // piece scattered half its labels onto other people's wedges.
      const mid = (n.x0 + n.x1) / 2;
      const [ri, ro] = bandOf(n);
      const tangential = (n.x1 - n.x0) * ((ri + ro) / 2); // room across the wedge
      const radial = ro - ri;                             // room along the label
      const size = Math.min(12.5, Math.max(9, Math.min(tangential * 0.62, radial / 3.2)));
      const label = tangential > 15 && radial > 26 ? fitText(n.data.name, radial - 10, size) : null;
      if (label) {
        const phi = mid - Math.PI / 2;
        const rot = (phi * 180) / Math.PI;
        const flip = Math.cos(phi) < 0;
        g.append('text')
          .attr('transform', `rotate(${rot}) translate(${(ri + ro) / 2},0) rotate(${flip ? 180 : 0})`)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .attr('font-family', 'var(--_fl)').attr('font-size', size)
          .attr('font-weight', n.depth === 1 ? 700 : 500)
          .attr('fill', 'var(--_paper)')
          .attr('pointer-events', 'none')
          .text(label);
      }

      const parentTotal = n.parent && n.parent.depth > 0 ? n.parent.value : levelTotal;
      const parentName = n.parent && n.parent.depth > 0 ? n.parent.data.name : null;

      path.on('pointerenter', () => {
        motion.hold();
        // ISOLATION IS THE READING. A ring's order is meaningful but its
        // neighbours are not, so the only reliable way to read one member is
        // to drop everything that is not on its own branch.
        for (const other of wedges) {
          const related = other === rec
            || other.node.ancestors().includes(n)
            || n.ancestors().includes(other.node);
          other.path.style('opacity', related ? 1 : 0.14);
        }
        const pct = ((100 * n.value) / (parentTotal || 1)).toFixed(0);
        setCentre(n.data.name,
          `${fmt(n.value)} · ${pct}% of ${parentName || (opened ? opened.name : 'the whole')}`,
          `${fmt(n.value)} · ${pct}% of its ring`,
          `${fmt(n.value)} · ${pct}%`);
      });
      path.on('pointermove', (event) => {
        const box = ctx.svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        const py = ((event.clientY - box.top) / box.height) * height;
        const ofAll = stats.total > 0 ? (100 * n.value) / stats.total : 0;
        tip.show(
          `<div style="color:${color}"><b>${n.data.name}</b></div>`
          + `<div><b>${fmt(n.value)}</b> &middot; ${((100 * n.value) / (parentTotal || 1)).toFixed(0)}% of `
          + `${parentName || 'the ring'}</div>`
          + `<div style="opacity:.7">${ofAll.toFixed(ofAll < 10 ? 1 : 0)}% of the ${fmt(stats.total)} whole</div>`,
          px, py
        );
      });
      path.on('pointerleave', () => {
        for (const other of wedges) other.path.style('opacity', '');
        tip.hide();
        restoreCentre();
        motion.free();
      });

      if (zoom && !opened && n.depth === 1 && n.children && n.children.length) {
        path.on('click', () => {
          tip.hide();
          view.branch = n.data.name;
          motion.replay();
          ctx.redraw();
        });
      }
    }

    // THE TABLE IS A CONTROL, NOT A CAPTION. A row lights its own wedge through
    // the WEDGE'S OWN handler — dispatched, not reimplemented — so the two
    // surfaces can never drift into disagreeing about what is emphasised.
    // Depth 1 only: levelParts are the children of whatever is open, and a leaf
    // sharing a group's name would otherwise claim the row.
    const byName = new Map(wedges.filter((w) => w.node.depth === 1).map((w) => [w.name, w]));
    for (const { name, band } of box.bands) {
      const hit = byName.get(name);
      if (!hit) continue;
      band.on('pointerenter', () => hit.path.dispatch('pointerenter'));
      band.on('pointerleave', () => hit.path.dispatch('pointerleave'));
    }

    if (zoom) {
      const goHome = () => {
        tip.hide();
        view.branch = null;
        motion.replay();
        ctx.redraw();
      };

      // A sunburst keeps its SECOND way back: the hole in the middle is the
      // parent, so clicking it to rise is the form's own logic and readers who
      // know sunbursts reach for it first. It is labelled, because an
      // unlabelled hit area is a secret — and it is no longer the ONLY way out,
      // which is what made a 10px centre label a problem rather than a nicety.
      if (opened) {
        g.append('text')
          .attr('text-anchor', 'middle').attr('y', 36)
          .attr('font-family', 'var(--_ff)').attr('font-size', 10)
          .attr('fill', 'var(--_accent)')
          .style('cursor', 'pointer')
          .text('← all groups')
          .on('click', goHome);
      }

      ctx.trail(opened ? {
        label: 'All groups',
        crumbs: opened.name,
        onHome: goHome,
      } : null);

      ctx.setCopy(opened
        ? {
          headline: `Inside ${opened.name}: ${(opened.children && opened.children[0]) ? opened.children[0].name : 'one item'} `
            + 'takes the largest share',
          dek: `${fmt(levelTotal)} in this branch — ${((100 * levelTotal) / (stats.total || 1)).toFixed(0)}% of the `
            + `${fmt(stats.total)} whole. The circle now shows this branch's own 100%.`
            + ifLive(config, ' Click the centre to come back out.'),
        }
        : {
          headline: hierHeadline(stats),
          dek: `${hierDek(stats)}${ifLive(config, ' Click a wedge to make it the whole circle.')}`,
        });
    }

    // ---- attract: the zoom previews itself, paint only ---------------------
    let attract;
    if (zoom && wedges.length > 1) {
      const order = wedges.filter((w) => w.node.depth === 1).sort((a, b) => b.value - a.value).slice(0, 6);
      if (order.length > 1) {
        let showing = -1;
        attract = {
          count: order.length,
          apply(i, amp) {
            const lit = order[i];
            for (const w of wedges) {
              const related = w === lit || w.node.ancestors().includes(lit.node);
              w.path.style('opacity', related ? '1' : String(1 - 0.45 * amp));
            }
            // The centre reads out what is lit, which is the whole point: a
            // preview that dims wedges without naming one demonstrates nothing.
            if (i !== showing) {
              showing = i;
              setCentre(lit.name,
                `${fmt(lit.value)} · ${((100 * lit.value) / (levelTotal || 1)).toFixed(0)}% of the whole`,
                fmt(lit.value));
            }
          },
          clear() {
            showing = -1;
            for (const w of wedges) w.path.style('opacity', '');
            restoreCentre();
          },
        };
      }
    }

    // THE RING SWEEPS THROUGH ITS OWN ANGLE. A partition's wedge is defined by
    // where it starts and how far round it goes, so opening it from its start
    // angle is the encoding drawing itself — and it reads as the circle being
    // filled in, which is what a sunburst is. Scaling the finished wedge instead
    // (what the ring build did: opacity 0 to 1 plus a 0.92 to 1 float) can only
    // look like the whole picture arriving from slightly too far away.
    //
    // Each wedge sweeps from ITS OWN start angle rather than from twelve
    // o'clock, so siblings open away from each other and the parent's span is
    // never briefly misrepresented as belonging to the first child.
    const sweepAt = (i, t) => {
      const rec = wedges[i];
      if (!rec) return;
      const n = rec.node;
      const e = Math.max(0, Math.min(1, t));
      rec.path.attr('d', arc({
        ...n,
        x0: n.x0,
        x1: n.x0 + (n.x1 - n.x0) * e,
        y0: n.y0,
        y1: n.y1,
      }));
    };

    return {
      origin: [cx, cy],
      attract,
      sweep: {
        count: wedges.length,
        apply(i, t) {
          if (i < 0) { for (let k = 0; k < wedges.length; k += 1) sweepAt(k, t); return; }
          sweepAt(i, t);
        },
      },
    };
  },
});
