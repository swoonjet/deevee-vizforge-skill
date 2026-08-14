// assets/modules/ranked-bar.js
//
// RANKED BAR — interactive category comparison, optionally with a delta against
// a second value. Portable module.
//
// WHY THIS EXISTS. `nominal + quantitative` is the second-commonest shape the
// wizard's profiler finds, and it had no interactive technique. "Which is
// biggest" is the workhorse of every deck and dashboard; the four Dimensional
// pieces are all multivariate and answer a different question entirely.
//
// HONESTY, and why it is stricter here than in trend. Bar LENGTH is the
// encoding, so the baseline is not a disclosure question — a truncated bar is
// simply a lie about ratio, and no footnote repairs it. lengthDomain() anchors
// at zero unconditionally and there is deliberately no option to override it.
// (docs/honesty-rules.md; the same rule the `bar` scaffold's gate enforces.)
//
// Negative values are supported and drawn from a real zero line in both
// directions, rather than being flipped or absolute-valued.
//
// When `compare` is bound, each row gets a reference RULE at the second value.
// The delta is computed, never asserted: the headline states the actual largest
// mover.
//
// TWO ENCODINGS, ONE MODULE, and the difference is not cosmetic. With
// `dumbbell: true` a row becomes two POSITION-encoded markers joined by a
// connector — hollow before, filled after — and the axis is then free of the
// zero-baseline rule above, because nothing in the mark claims a ratio to zero.
// It must say so instead, which is the exact inverse of the bar's rule, so the
// note, the dek, the domain and the entrance all switch together. The gallery's
// `conv-dumbbell` card has always shown this form; the bar-with-a-rule was a
// port that quietly answered the same question with a different picture.

import {
  buildFrame, observeSize, resolveCategories, linearScale, bandScale, ticks,
  lengthDomain, positionDomain, formatNumber, svgEl, showTip, hideTip, clamp, interactionNote, toNumber,
  createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'ranked-bar';

export const roles = {
  category: { types: ['nominal', 'ordinal'], required: true, label: 'Category' },
  value: { types: ['quantitative'], required: true, label: 'Value (bar length)' },
  compare: { types: ['quantitative'], required: false, label: 'Compare against (optional second value)' },
};

export function shape(rows, bindings = {}) {
  const catCol = bindings.category;
  const valCol = bindings.value;
  const cmpCol = bindings.compare;

  const byCategory = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const label = row[catCol];
    if (label === undefined || label === null || String(label).trim() === '') continue;
    const value = toNumber(row[valCol]);
    if (!Number.isFinite(value)) continue;
    const key = String(label);

    // Repeated categories SUM, which is what a reader expects of a ranked bar
    // over transactional rows. Stated in the source line via rowCount so the
    // aggregation is never silent.
    const prev = byCategory.get(key) || { label: key, value: 0, compare: cmpCol ? 0 : null, n: 0 };
    prev.value += value;
    if (cmpCol) {
      const c = toNumber(row[cmpCol]);
      if (Number.isFinite(c)) prev.compare += c;
    }
    prev.n += 1;
    byCategory.set(key, prev);
  }

  const data = [...byCategory.values()].sort((a, b) => b.value - a.value);
  data.forEach((d, i) => {
    d.rank = i + 1;
    d.delta = d.compare === null ? null : d.value - d.compare;
    d.deltaPct = d.compare === null || d.compare === 0 ? null : (d.value - d.compare) / Math.abs(d.compare);
  });

  const values = data.map((d) => d.value);
  const total = values.reduce((a, b) => a + b, 0);
  const withDelta = data.filter((d) => d.deltaPct !== null);
  const movers = withDelta.slice().sort((a, b) => b.deltaPct - a.deltaPct);
  const aggregated = data.some((d) => d.n > 1);

  return {
    data,
    stats: {
      rowCount: data.length,
      sourceRowCount: (rows || []).length,
      aggregated,
      hasCompare: Boolean(cmpCol) && withDelta.length > 0,
      total,
      top: data[0] || null,
      bottom: data[data.length - 1] || null,
      ratio: data.length > 1 && data[data.length - 1].value !== 0
        ? data[0].value / data[data.length - 1].value
        : null,
      topShare: total !== 0 && data[0] ? data[0].value / total : null,
      biggestGain: movers[0] || null,
      biggestDrop: movers.length > 1 ? movers[movers.length - 1] : null,
      hasNegative: values.some((v) => v < 0),
    },
  };
}

export function validate(rows, bindings, { profile } = {}) {
  const errors = [];
  const { data } = shape(rows, bindings);
  if (data.length < 2) {
    errors.push({
      channel: 'category',
      problem: `channel 'category': fewer than 2 distinct categories with usable values`,
      remedy: `bind 'category' to a column with at least 2 distinct labels`,
    });
  }
  return errors;
}

function defaultHeadline(stats) {
  const { top, bottom, ratio, biggestGain, hasCompare } = stats;
  if (hasCompare && biggestGain && biggestGain.deltaPct !== null) {
    const dir = biggestGain.deltaPct >= 0 ? 'gained' : 'lost';
    return `"${biggestGain.label}" ${dir} the most, ${Math.abs(Math.round(biggestGain.deltaPct * 100))}%`;
  }
  if (top && bottom && ratio !== null && ratio > 1.15 && top.label !== bottom.label) {
    return `"${top.label}" leads at ${ratio.toFixed(1)}× the value of "${bottom.label}"`;
  }
  if (top) return `"${top.label}" leads at ${formatNumber(top.value)}`;
  return 'No ranked values in the bound data';
}

/**
 * WHICH BAR CARRIES THE ACCENT — the row the headline is ABOUT, not simply the
 * longest bar.
 *
 * The accent used to be hardcoded to rank 1 while defaultHeadline() named the
 * biggest MOVER whenever a comparison column was bound. On any before/after
 * dataset the piece then said one thing and pointed at another: "APAC gained
 * the most" over a magenta North America bar. One emphasis per piece
 * (docs/color.md) is only worth anything if it lands on the piece's subject.
 *
 * When the reader supplies their own headline we cannot know what it is about,
 * so the accent falls back to the leader — the conventional reading of a ranked
 * bar, and what the piece did before.
 */
export function emphasisLabel(stats, copy) {
  if ((copy || {}).headline) return stats.top ? stats.top.label : null;
  if (stats.hasCompare && stats.biggestGain && stats.biggestGain.deltaPct !== null) {
    return stats.biggestGain.label;
  }
  return stats.top ? stats.top.label : null;
}

function defaultDek(stats, copy, config, dumbbell) {
  const clauses = [`${stats.rowCount} categories, sorted by value`];
  if (stats.topShare !== null && stats.topShare > 0.2 && !dumbbell) {
    clauses.push(`the leader holds ${Math.round(stats.topShare * 100)}% of the total`);
  }
  // A dumbbell has no rules on it, and no share of a total to quote — the two
  // markers and the gap are the whole reading.
  if (dumbbell) clauses.push('hollow is the before, filled is the after');
  else if (stats.hasCompare) clauses.push('rules mark the comparison value');
  const subject = (copy || {}).subject;
  // One em-dash maximum: the subject earns it, the clauses use commas.
  return `${clauses.join(', ')}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(config, 'Hover a bar for its exact value.');
}

export function mount(el, config = {}) {
  let state = normalize(config);

  let frame = buildFrame(el, state.config, {
    legend: false,
    ariaLabel: `Ranked bar chart, ${state.stats.rowCount} categories`,
    defaultHeadline: defaultHeadline(state.stats),
    defaultDek: defaultDek(state.stats, state.config.copy, state.config, state.dumbbell),
    note: state.note,
  });

  let colors = resolveCategories(el, 6);
  let teardown = null;
  let currentSize = null;

  // Bars rise from the zero line in rank order, and afterwards the one bar the
  // headline is about keeps breathing — the module form of the gallery's
  // "emphasis where the story peaks" law.
  const motion = createMotion(el, config);

  function draw(width, height) {
    const { data, stats } = state;
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    if (!data.length) return;

    const horizontal = state.orientation === 'horizontal';
    const longest = Math.max(...data.map((d) => String(d.label).length));
    const labelRoom = horizontal ? clamp(longest * 7.2, 70, width * 0.34) : 26;
    const m = horizontal
      ? { top: 6, right: 62, bottom: 26, left: labelRoom }
      : { top: 20, right: 12, bottom: 46, left: 46 };

    // A dumbbell reads POSITION, so it gets a padded domain over both ends and
    // the note discloses that it need not include zero. A bar reads LENGTH and
    // lengthDomain() anchors it at zero with no way to override.
    const bothEnds = data.map((d) => d.value).concat(
      stats.hasCompare ? data.map((d) => d.compare) : []
    );
    const vDomain = state.dumbbell ? positionDomain(bothEnds).domain : lengthDomain(bothEnds);

    const band = bandScale(
      data.map((d) => d.label),
      horizontal ? [m.top, height - m.bottom] : [m.left, width - m.right],
      0.26
    );
    const v = linearScale(vDomain, horizontal ? [m.left, width - m.right] : [height - m.bottom, m.top]);
    const zero = v(0);

    // Value gridlines, behind the bars.
    const grid = svgEl('g');
    for (const t of ticks(vDomain[0], vDomain[1], 5)) {
      const p = v(t);
      grid.appendChild(svgEl('line', {
        x1: horizontal ? p : m.left, x2: horizontal ? p : width - m.right,
        y1: horizontal ? m.top : p, y2: horizontal ? height - m.bottom : p,
        stroke: 'var(--_ink)', 'stroke-opacity': t === 0 ? 0.35 : 0.09, 'stroke-width': 1,
      }));
      const label = svgEl('text', {
        x: horizontal ? p : m.left - 8,
        y: horizontal ? height - m.bottom + 17 : p,
        'text-anchor': horizontal ? 'middle' : 'end',
        'dominant-baseline': horizontal ? 'auto' : 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.66,
        'font-family': 'var(--_fl)', 'font-size': 11, 'font-variant-numeric': 'tabular-nums',
      });
      label.textContent = formatNumber(t);
      grid.appendChild(label);
    }
    svg.appendChild(grid);

    const bars = svgEl('g');
    const barRects = [];
    data.forEach((d, i) => {
      const pos = band(d.label);
      const thickness = band.bandwidth();
      const end = v(d.value);
      const lo = Math.min(zero, end);
      const len = Math.abs(end - zero);
      // The headline's subject carries the single accent; everything else is
      // ink. One emphasis per piece (docs/color.md), landing on the row the
      // piece is actually talking about — see emphasisLabel().
      const isSubject = d.label === state.emphasis;
      const fill = isSubject ? 'var(--_accent)' : 'var(--_mark)';
      const opacity = isSubject ? 1 : 'var(--_mark-opacity)';

      // WHICH MARKS BELONG TO THIS ROW. A bar is one rect; a dumbbell is two
      // markers plus the connector between them, and all of them have to answer
      // the same hover and dim together with their row.
      const rowMarks = [];
      if (state.dumbbell) {
        // TWO MARKERS AND THE GAP BETWEEN THEM. The connector is drawn first and
        // behind, because it is not a value — it is the distance the two markers
        // already state, and drawing it over them would read as a third mark.
        const cp = v(d.compare);
        const mid = pos + thickness / 2;
        const rise = Math.min(7.5, Math.max(4, thickness * 0.34));
        const connector = svgEl('line', {
          x1: horizontal ? cp : mid, x2: horizontal ? end : mid,
          y1: horizontal ? mid : cp, y2: horizontal ? mid : end,
          stroke: 'var(--_ink)', 'stroke-opacity': 0.3,
          'stroke-width': Math.max(1.5, rise * 0.42), 'stroke-linecap': 'round',
          // The connector spans the pair, so it draws BETWEEN them rather than
          // growing from an axis: `stretch` dash-draws it after the dots land.
          'data-vf-part': 'connector', 'data-vf-order': i,
        });
        bars.appendChild(connector);
        barRects.push(connector);

        // The BEFORE end is hollow and the AFTER end is filled: the direction of
        // travel has to be readable without the legend, and without colour,
        // which is spent on the one row the headline is about.
        const before = svgEl('circle', {
          cx: horizontal ? cp : mid, cy: horizontal ? mid : cp, r: rise,
          fill: 'var(--_paper)', stroke: 'var(--_mark)', 'stroke-width': 2,
          'stroke-opacity': 0.85, style: 'cursor:pointer', 'data-vf-order': i,
        });
        const after = svgEl('circle', {
          cx: horizontal ? end : mid, cy: horizontal ? mid : end, r: rise,
          fill, 'fill-opacity': opacity, style: 'cursor:pointer', 'data-vf-order': i,
        });
        if (isSubject) after.setAttribute('data-vf-peak', '');
        bars.appendChild(before);
        bars.appendChild(after);
        barRects.push(before, after);
        rowMarks.push(connector, before, after);
      } else {
        const rect = svgEl('rect', {
          x: horizontal ? lo : pos,
          y: horizontal ? pos : lo,
          width: horizontal ? Math.max(1, len) : thickness,
          height: horizontal ? thickness : Math.max(1, len),
          fill, 'fill-opacity': opacity, style: 'cursor:pointer',
          // Which edge is the zero line — the one thing the motion kit cannot
          // work out for itself, and the difference between a bar growing out of
          // the axis and one growing out of thin air.
          'data-vf-grow': horizontal ? (d.value >= 0 ? 'right' : 'left') : (d.value >= 0 ? 'up' : 'down'),
          'data-vf-order': i,
        });
        if (isSubject) rect.setAttribute('data-vf-peak', '');
        bars.appendChild(rect);
        barRects.push(rect);
        rowMarks.push(rect);
      }

      // Category label
      const catLabel = svgEl('text', {
        x: horizontal ? m.left - 8 : pos + thickness / 2,
        y: horizontal ? pos + thickness / 2 : height - m.bottom + 17,
        'text-anchor': horizontal ? 'end' : 'middle',
        'dominant-baseline': horizontal ? 'middle' : 'auto',
        fill: 'var(--_ink)', 'fill-opacity': 0.86,
        'font-family': 'var(--_fl)', 'font-size': 11.5, 'font-weight': isSubject ? 600 : 400,
      });
      catLabel.textContent = d.label;
      bars.appendChild(catLabel);

      // Value label at the bar end
      // Clear of the marker in dumbbell mode, which occupies the value end.
      const valGap = state.dumbbell ? 15 : 7;
      const valLabel = svgEl('text', {
        x: horizontal ? end + (d.value >= 0 ? valGap : -valGap) : pos + thickness / 2,
        y: horizontal ? pos + thickness / 2 : end - valGap,
        'text-anchor': horizontal ? (d.value >= 0 ? 'start' : 'end') : 'middle',
        'dominant-baseline': horizontal ? 'middle' : 'auto',
        fill: 'var(--_ink)', 'fill-opacity': 0.72,
        'font-family': 'var(--_ff)', 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums',
      });
      valLabel.textContent = formatNumber(d.value);
      bars.appendChild(valLabel);

      // In dumbbell mode the compare value IS a marker, so the reference rule
      // would be a second drawing of the same number.
      if (!state.dumbbell && stats.hasCompare && d.compare !== null) {
        const cp = v(d.compare);
        bars.appendChild(svgEl('line', {
          x1: horizontal ? cp : pos + thickness * 0.12,
          x2: horizontal ? cp : pos + thickness * 0.88,
          y1: horizontal ? pos + thickness * 0.12 : cp,
          y2: horizontal ? pos + thickness * 0.88 : cp,
          stroke: 'var(--_ink)', 'stroke-width': 2, 'stroke-opacity': 0.85,
          // The rule is a comparison AGAINST the bar, so it arrives after the
          // bar does. Left alone it hangs in empty space for three seconds
          // marking a value next to nothing.
          'data-vf-part': 'rule',
        }));
      }

      const onEnter = () => {
        const box = frame.svg.getBoundingClientRect();
        const cx = horizontal ? (lo + len) : pos + thickness / 2;
        const cy = horizontal ? pos + thickness / 2 : lo;
        const deltaLine = d.delta === null
          ? ''
          : `<div>vs. compare <b>${d.delta >= 0 ? '+' : ''}${formatNumber(d.delta)}</b>${d.deltaPct === null ? '' : ` (${d.deltaPct >= 0 ? '+' : ''}${Math.round(d.deltaPct * 100)}%)`}</div>`;
        const rowsLine = d.n > 1 ? `<div>${d.n} rows summed</div>` : '';
        showTip(
          frame.tip,
          `<div><b>${escapeHtml(d.label)}</b></div><div>rank ${d.rank} of ${stats.rowCount} · <b>${formatNumber(d.value)}</b></div>${deltaLine}${rowsLine}`,
          (cx / width) * box.width,
          (cy / height) * box.height
        );
      };
      // Sibling dimming. A tooltip alone tells you the value you are pointing
      // at; dropping every other bar back tells you where it SITS in the set,
      // which is the whole question a ranked bar exists to answer.
      const isolate = () => {
        motion.hold();
        for (const other of barRects) other.style.opacity = rowMarks.includes(other) ? '1' : '0.26';
      };
      const release = () => {
        for (const other of barRects) other.style.opacity = '';
        motion.free();
      };

      for (const mark of rowMarks) {
        mark.addEventListener('pointerenter', () => { isolate(); onEnter(); });
        mark.addEventListener('pointermove', onEnter);
        mark.addEventListener('pointerleave', () => { release(); hideTip(frame.tip); });
      }
    });
    svg.appendChild(bars);

    // THE ENTRANCE FOLLOWS THE ENCODING, so it is chosen per render rather than
    // fixed in the spec: a bar grows off its zero line, a dumbbell's two ends
    // land and then stretch a connector between them. The same module draws both,
    // so a single hardcoded build would have to be wrong for one of them.
    motion.attach(svg, { build: state.dumbbell ? 'stretch' : 'grow', dur: 3200, rest: 'peak' });
  }

  function redraw() { if (currentSize) draw(currentSize[0], currentSize[1]); }

  teardown = observeSize(el, frame.plot, (w, h) => {
    currentSize = [w, h];
    // Many categories read better horizontally; the switch is a legibility
    // decision, never a change to the encoding.
    state.orientation = state.forcedOrientation
      || (state.stats.rowCount > 7 || w < 520 ? 'horizontal' : 'vertical');
    draw(w, h);
  }, { aspect: state.aspect, fit: state.fit, minHeight: Math.max(190, state.stats.rowCount * 26) });

  return {
    destroy() {
      if (teardown) teardown();
      motion.destroy();
      el.textContent = '';
      el.classList.remove('vf-module', frame.rootClass);
    },
    update(next) {
      if (teardown) teardown();
      if (dataChanged(state.config, next)) motion.replay();
      state = normalize(next);
      colors = resolveCategories(el, 6);
      frame = buildFrame(el, state.config, {
        legend: false,
        ariaLabel: `Ranked bar chart, ${state.stats.rowCount} categories`,
        defaultHeadline: defaultHeadline(state.stats),
        defaultDek: defaultDek(state.stats, state.config.copy, state.config, state.dumbbell),
        note: state.note,
      });
      teardown = observeSize(el, frame.plot, (w, h) => { currentSize = [w, h]; draw(w, h); },
        { aspect: state.aspect, fit: state.fit, minHeight: Math.max(190, state.stats.rowCount * 26) });
    },
    get stats() { return state.stats; },
    redraw,
  };
}

function normalize(config) {
  let data;
  let stats;

  if (Array.isArray(config.data) && !config.bindings) {
    ({ data, stats } = shape(
      config.data.map((d) => ({ c: d.label ?? d.category, v: d.value, k: d.compare })),
      { category: 'c', value: 'v', compare: config.data.some((d) => d.compare !== undefined) ? 'k' : undefined }
    ));
  } else {
    ({ data, stats } = shape(config.data || config.rows || [], config.bindings || {}));
  }

  // DUMBBELL is a different ENCODING, not a styling of the bar.
  //
  // A bar encodes with LENGTH, so it is anchored at zero unconditionally and
  // there is deliberately no option to override that. A dumbbell encodes with
  // POSITION: the reader compares two points and the distance between them, and
  // nothing in the mark claims a ratio to zero. So a dumbbell may sit on a
  // non-zero domain — and must SAY SO, which is the exact inverse of the bar's
  // rule. Conflating the two would either cramp every dumbbell against an
  // irrelevant zero or quietly let a bar float off its baseline.
  const dumbbell = Boolean(config.dumbbell) && stats.hasCompare;

  const notes = [];
  // Bars always start at zero, so there is no baseline to disclose — but an
  // aggregation the reader cannot see must be stated.
  if (stats.aggregated) notes.push(`categories aggregate ${stats.sourceRowCount} source rows`);
  if (dumbbell) {
    notes.push('each row is TWO positions and the gap between them — '
      + 'the connector carries no value of its own, and the axis need not start at zero');
  } else if (stats.hasNegative) {
    notes.push('negative values are drawn from a true zero line');
  }

  return {
    config,
    data,
    stats,
    dumbbell,
    // Resolved once here so the bar, its label and the headline can never
    // disagree about which row the piece is about.
    emphasis: emphasisLabel(stats, config.copy),
    note: notes.length ? notes.join('; ') : null,
    aspect: config.aspect || 0.55,
    fit: config.fit || 'aspect',
    forcedOrientation: config.orientation || null,
    orientation: config.orientation || 'vertical',
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
