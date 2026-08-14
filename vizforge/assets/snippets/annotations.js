// assets/snippets/annotations.js
//
// Shared annotation-layering treatment (TRT-01, Phase 25 Plan 01). Five
// reusable newsroom annotation-layer helpers, designed to be INLINED into a
// piece's single HTML file via
// `<!-- @inline-module assets/snippets/annotations.js -->` (PIPE-01) --
// exported as small `export function`s (assemble-scaffold.mjs's own
// stripExportTokens strips the leading `export ` token at inline time), so
// this same source also loads as a real ES module for unit testing
// (mirrors scale-helpers.js's style: small, focused, no imports).
//
// CONTRACT: every position argument these helpers receive (pos, start, end,
// from/to, crossStart/crossEnd, x/y, fromX/fromY/textX/textY) must already
// be the OUTPUT of a real d3 scale applied to a real bound-data value --
// these helpers draw exactly where they are told and never invent a pixel
// position of their own. Keeping every annotation data-anchored is the
// CALLER's job; this file only draws.
//
// CLASS-NAME LAW (pattern-scan.mjs hard-fail, docs/craft-law.md): no class
// name emitted below may contain the whole word "rule" or "divider".

const HALO_STROKE_WIDTH_PX = '3px';

// Solid paper-color text-halo pattern (circle-packing.html's precedent) --
// a real vector stroke rendered BEHIND the glyph fill via paint-order, never
// a blur/shadow filter. Keeps any label legible over whichever hue (or ink)
// happens to sit behind it.
function applyHalo(textSelection) {
  return textSelection
    .style('paint-order', 'stroke')
    .style('stroke', 'var(--color-paper)')
    .style('stroke-width', HALO_STROKE_WIDTH_PX)
    .style('stroke-linejoin', 'round');
}

function requireLabel(label, what) {
  if (label === undefined || label === null || String(label).trim().length === 0) {
    throw new Error(`${what} requires a data label`);
  }
}

/**
 * heroOpacity(isHero, {dim}) -> 1 | dim
 *
 * Mirrors bump.html's `isHighlighted(d) ? 1 : 0.4` precedent: a hero mark
 * renders at full opacity, every other mark at a reduced (never recolored)
 * opacity of the SAME hue. Pure.
 */
export function heroOpacity(isHero, { dim = 0.4 } = {}) {
  return isHero ? 1 : dim;
}

/**
 * declutterLabels(items, {minGap, boundsMin, boundsMax}) -> items[]
 *
 * Generalizes slope.html's proven per-side greedy label-declutter algorithm
 * to a single axis. `items` is an array of plain objects each carrying a
 * `pos` field (already scale-computed); returns a NEW array (input never
 * mutated) of `{...item, pos, moved}` objects where `pos` has been nudged
 * apart to keep at least `minGap` between neighbors (positions clamped to
 * [boundsMin, boundsMax]) and `moved` is true iff that item's position
 * actually changed by more than 1px from its original input value. Pure and
 * deterministic -- same inputs always produce the same outputs.
 */
export function declutterLabels(items, { minGap, boundsMin, boundsMax } = {}) {
  const working = items
    .map((item) => ({ ...item, pos: item.pos }))
    .sort((a, b) => a.pos - b.pos);
  const originals = working.map((item) => item.pos);

  for (let iter = 0; iter < 200; iter++) {
    let moved = false;

    if (working.length > 0) {
      if (working[0].pos < boundsMin) {
        working[0].pos = boundsMin;
        moved = true;
      }
      if (working[working.length - 1].pos > boundsMax) {
        working[working.length - 1].pos = boundsMax;
        moved = true;
      }
    }

    for (let i = 1; i < working.length; i++) {
      const gap = working[i].pos - working[i - 1].pos;
      if (gap < minGap) {
        const adjust = (minGap - gap) / 2;
        working[i - 1].pos -= adjust;
        working[i].pos += adjust;
        moved = true;
      }
    }

    if (!moved) break;
  }

  return working.map((item, i) => ({
    ...item,
    moved: Math.abs(item.pos - originals[i]) > 1,
  }));
}

/**
 * appendReferenceLine(parent, {orientation, pos, start, end, label, labelAnchor})
 *
 * Draws a horizontal ('h', default) or vertical ('v') data-anchored
 * reading-aid line at scale-computed `pos`, spanning [start, end] along the
 * OTHER axis (ridgeline.html's zero-reference-line precedent: ink,
 * stroke-opacity ~0.35, stroke-width 1), plus a REQUIRED halo'd text label.
 * An unlabeled reference line is decoration, not an annotation -- this
 * helper refuses to draw one at all by throwing.
 */
export function appendReferenceLine(
  parent,
  { orientation = 'h', pos, start, end, label, labelAnchor = 'start' } = {}
) {
  requireLabel(label, 'reference line');

  const line = parent
    .append('line')
    .attr('class', 'annotation-ref-line')
    .style('stroke', 'var(--color-ink)')
    .style('stroke-opacity', 0.35)
    .attr('stroke-width', 1);

  if (orientation === 'v') {
    line.attr('x1', pos).attr('x2', pos).attr('y1', start).attr('y2', end);
  } else {
    line.attr('x1', start).attr('x2', end).attr('y1', pos).attr('y2', pos);
  }

  const text = parent
    .append('text')
    .attr('class', 'annotation-direct-label')
    .attr('text-anchor', labelAnchor)
    .style('font-family', 'var(--font-label)')
    .style('font-size', 'var(--size-annotation)')
    .style('fill', 'var(--color-ink)')
    .style('fill-opacity', 0.72)
    .text(label);

  if (orientation === 'v') {
    text.attr('x', pos + 6).attr('y', start + 12);
  } else {
    text.attr('x', labelAnchor === 'end' ? end : start).attr('y', pos - 6);
  }

  applyHalo(text);

  return line;
}

/**
 * appendEventBand(parent, {orientation, from, to, crossStart, crossEnd, label})
 *
 * Draws a shaded band -- 'v' (default) spans [from, to] along x and
 * [crossStart, crossEnd] along y; 'h' spans [from, to] along y and
 * [crossStart, crossEnd] along x -- ink fill at low opacity (~0.06), no
 * stroke, plus a REQUIRED halo'd label. Same required-label rule as
 * appendReferenceLine: an unlabeled band is decoration, refused by throwing.
 */
export function appendEventBand(parent, { orientation = 'v', from, to, crossStart, crossEnd, label } = {}) {
  requireLabel(label, 'event band');

  const rect = parent
    .append('rect')
    .attr('class', 'annotation-event-band')
    .style('fill', 'var(--color-ink)')
    .style('fill-opacity', 0.06)
    .style('stroke', 'none');

  const spanStart = Math.min(from, to);
  const spanEnd = Math.max(from, to);

  if (orientation === 'h') {
    rect.attr('y', spanStart).attr('height', spanEnd - spanStart).attr('x', crossStart).attr('width', crossEnd - crossStart);
  } else {
    rect.attr('x', spanStart).attr('width', spanEnd - spanStart).attr('y', crossStart).attr('height', crossEnd - crossStart);
  }

  const text = parent
    .append('text')
    .attr('class', 'annotation-direct-label')
    .attr('text-anchor', 'start')
    .style('font-family', 'var(--font-label)')
    .style('font-size', 'var(--size-annotation)')
    .style('fill', 'var(--color-ink)')
    .style('fill-opacity', 0.72)
    .text(label);

  if (orientation === 'h') {
    text.attr('x', crossStart + 6).attr('y', spanStart + 14);
  } else {
    text.attr('x', spanStart + 6).attr('y', crossStart + 14);
  }

  applyHalo(text);

  return rect;
}

/**
 * appendLeaderCallout(parent, {fromX, fromY, textX, textY, text, anchor})
 *
 * Draws a thin leader line (ink, stroke-opacity ~0.4) from a mark's true
 * scale-computed position to a (possibly decluttered) label position, plus
 * a halo'd direct label at the label end -- slope.html's leader-tick
 * precedent generalized to an arbitrary from/to pair.
 */
export function appendLeaderCallout(parent, { fromX, fromY, textX, textY, text: labelText, anchor = 'start' } = {}) {
  const line = parent
    .append('line')
    .attr('class', 'annotation-leader-line')
    .attr('x1', fromX)
    .attr('y1', fromY)
    .attr('x2', textX)
    .attr('y2', textY)
    .style('stroke', 'var(--color-ink)')
    .style('stroke-opacity', 0.4)
    .attr('stroke-width', 1);

  const text = parent
    .append('text')
    .attr('class', 'annotation-direct-label')
    .attr('x', textX)
    .attr('y', textY)
    .attr('text-anchor', anchor)
    .attr('dominant-baseline', 'middle')
    .style('font-family', 'var(--font-label)')
    .style('font-size', 'var(--size-annotation)')
    .style('fill', 'var(--color-ink)')
    .style('fill-opacity', 0.85)
    .text(labelText);

  applyHalo(text);

  return { line, text };
}

/**
 * appendDirectLabel(parent, {x, y, text, anchor, dy})
 *
 * Draws a single halo'd direct label at a scale-computed (x, y) -- e.g.
 * naming a hero series right beside its own point cloud.
 */
export function appendDirectLabel(parent, { x, y, text: labelText, anchor = 'start', dy = 0 } = {}) {
  const text = parent
    .append('text')
    .attr('class', 'annotation-direct-label')
    .attr('x', x)
    .attr('y', y)
    .attr('dy', dy)
    .attr('text-anchor', anchor)
    .style('font-family', 'var(--font-label)')
    .style('font-size', 'var(--size-annotation)')
    .style('fill', 'var(--color-ink)')
    .style('fill-opacity', 0.85)
    .text(labelText);

  applyHalo(text);

  return text;
}
