// assets/modules/box-whisker.js
//
// BOX & WHISKER + every raw value behind it — interactive distribution
// comparison. Portable module.
//
// WHY THIS EXISTS. The library could compare one number per category
// (ranked-bar) and several measures per entity (radar, parallel), but it had no
// way to ask "how much do these groups actually overlap?" — the question a mean
// hides. It is the Studio's counterpart to the B2B gallery's Dimensional box
// piece, whose whole finding was that three families' averages ranked cleanly
// while their ranges sat on top of each other.
//
// WHAT IT DRAWS, and why the raw dots are not decoration. A box alone invites
// the reader to treat five numbers as the distribution. Plotting every bound
// value behind the box shows the sample it came from — how many there are,
// whether they cluster or spread, whether the "outliers" are lonely or part of a
// tail. Tufte's argument for the dot-strip, and the reason the gallery piece
// hovers individual tasks.
//
// HONESTY, three disclosures, all stated on the piece:
//   1. The value axis is a POSITION encoding, so a non-zero baseline is
//      permitted — and is disclosed whenever it happens (docs/honesty-rules.md,
//      the same rule trend follows and that `box-violin`'s gate enforces).
//   2. HORIZONTAL POSITION CARRIES NOTHING. The dots are jittered sideways only
//      so they stop overlapping. A reader who reads left-to-right meaning into a
//      cloud has been misled, so the piece says so.
//   3. The box is quartiles and the whiskers are Tukey's 1.5xIQR — a convention,
//      not a property of the data. Values beyond are drawn individually rather
//      than dropped, because a discarded point is a silent edit.
//
// The jitter is SEEDED and computed once in shape(), so it is identical on every
// redraw, at every size, in every process. No Math.random anywhere in this
// project's render paths (docs/determinism.md).

import {
  buildFrame, observeSize, linearScale, bandScale, ticks, positionDomain,
  formatNumber, svgEl, showTip, hideTip, interactionNote, toNumber, createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'box-whisker';

export const roles = {
  category: { types: ['nominal', 'ordinal'], required: true, label: 'Group (one box each)' },
  value: { types: ['quantitative'], required: true, label: 'Value (the distribution)' },
};

/** mulberry32 — small, fast, fully deterministic from an integer seed. */
function seeded(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gaussian KDE with Silverman's rule-of-thumb bandwidth, sampled evenly across
 * the GLOBAL value range so every group's curve is comparable on one axis.
 *
 * This is what makes the difference between the two cards this module serves. A
 * raincloud and a violin are both DENSITY forms: the curve is the shape of the
 * sample, and the box (where there is one) is a summary laid over it. Without a
 * density estimate the module could only ever draw the summary, which is why
 * both cards used to render the same box-and-dots picture and neither matched
 * its own thumbnail.
 *
 * Falls back to a small fixed bandwidth when a group's variance is 0 (every
 * value identical), so the curve degenerates to a spike instead of dividing by
 * zero. Same estimator as scripts/shapers/box-violin.mjs.
 */
function kde(values, domainMin, domainMax, points = 48) {
  const n = values.length;
  if (n === 0 || domainMax <= domainMin) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const bandwidth = sd > 0 ? 1.06 * sd * (n ** (-1 / 5)) : (domainMax - domainMin) / 20 || 1;
  const step = (domainMax - domainMin) / (points - 1);
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const x = domainMin + i * step;
    let sum = 0;
    for (const v of values) {
      const u = (x - v) / bandwidth;
      sum += Math.exp(-0.5 * u * u);
    }
    out.push({ x, y: sum / (n * bandwidth * Math.sqrt(2 * Math.PI)) });
  }
  return out;
}

/** Linear-interpolated quantile over an ASCENDING array. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/**
 * Five-number summary + Tukey fences.
 *
 * `whiskerLo/whiskerHi` are the most extreme values still INSIDE the fences —
 * never the fences themselves, which are usually not data points at all.
 */
function summarize(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = sorted.filter((v) => v >= loFence && v <= hiFence);
  return {
    n: sorted.length,
    q1,
    median,
    q3,
    iqr,
    whiskerLo: inside.length ? inside[0] : sorted[0],
    whiskerHi: inside.length ? inside[inside.length - 1] : sorted[sorted.length - 1],
    outliers: sorted.filter((v) => v < loFence || v > hiFence),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function shape(rows, bindings = {}) {
  const catCol = bindings.category;
  const valCol = bindings.value;

  const byCategory = new Map();
  let skipped = 0;
  for (const row of rows || []) {
    if (!row) continue;
    const label = row[catCol];
    if (label === undefined || label === null || String(label).trim() === '') { skipped += 1; continue; }
    const value = toNumber(row[valCol]);
    // A blank cell is NOT zero (scripts/tests/smoke/blank-is-not-zero.test.mjs):
    // an empty string coerces to a finite 0 and would plant a phantom point at
    // the bottom of the box.
    if (!Number.isFinite(value)) { skipped += 1; continue; }
    const key = String(label);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(value);
  }

  // Ordered by median DESCENDING: a distribution comparison is read as a
  // ranking of typical values, and a stable order keeps the piece from
  // reshuffling between identical uploads.
  const data = [...byCategory.entries()]
    .map(([label, values]) => ({ label, values, ...summarize(values) }))
    .sort((a, b) => b.median - a.median || a.label.localeCompare(b.label));

  // Seeded jitter fractions in [-0.5, 0.5], assigned ONCE here so every redraw
  // and every process places the same dot in the same place.
  data.forEach((group, gi) => {
    const rand = seeded(0x5f3a + gi * 7919);
    group.points = group.values.map((v) => ({ value: v, jitter: rand() - 0.5 }));
  });

  // Density estimated over the GLOBAL value range, so every row sits on one
  // shared axis — then NORMALISED PER ROW, which is what the gallery piece does
  // and says it does ("normalized per row").
  //
  // The alternative, scaling every row against the tallest curve in the set,
  // is defensible and unreadable: a tight group has a high narrow peak, so
  // sharing that peak flattens every broad group into a straight line and the
  // shape — the one thing this form exists to show — disappears. Per-row is
  // honest because the curve is explicitly NOT a count (the note says so) and
  // each row prints its own n. Height compares shape; n compares size.
  const allValues = data.flatMap((g) => g.values);
  const gMin = allValues.length ? Math.min(...allValues) : 0;
  const gMax = allValues.length ? Math.max(...allValues) : 1;
  data.forEach((group) => {
    group.density = kde(group.values, gMin, gMax);
    group.densityPeak = group.density.reduce((h, p) => (p.y > h ? p.y : h), 0) || 1;
  });

  const totalValues = data.reduce((acc, g) => acc + g.n, 0);
  const thinnest = data.reduce((worst, g) => (worst === null || g.n < worst.n ? g : worst), null);

  // THE FINDING this form exists to state: do the ranked medians survive the
  // spread? Compared on the top two groups' whisker ranges, which is what a
  // reader's eye actually does.
  const top = data[0] || null;
  const runnerUp = data[1] || null;
  const overlaps = Boolean(
    top && runnerUp && top.whiskerLo <= runnerUp.whiskerHi && runnerUp.whiskerLo <= top.whiskerHi
  );

  return {
    data,
    stats: {
      groupCount: data.length,
      totalValues,
      sourceRowCount: (rows || []).length,
      skipped,
      top,
      runnerUp,
      bottom: data.length ? data[data.length - 1] : null,
      overlaps,
      medianGap: top && runnerUp ? top.median - runnerUp.median : null,
      thinnest,
      widest: data.reduce((w, g) => (w === null || g.iqr > w.iqr ? g : w), null),
      outlierCount: data.reduce((acc, g) => acc + g.outliers.length, 0),
    },
  };
}

export function validate(rows, bindings) {
  const errors = [];
  const { data } = shape(rows, bindings);

  if (data.length < 2) {
    errors.push({
      channel: 'category',
      problem: "channel 'category': fewer than 2 groups with usable values",
      remedy: "bind 'category' to a column with at least 2 distinct labels",
    });
  }
  // Quartiles of two numbers are the two numbers. A box drawn over that shape
  // looks like a distribution and is not one, so it is refused rather than
  // drawn with a caveat.
  if (data.length && data.every((g) => g.n < 3)) {
    errors.push({
      channel: 'value',
      problem: "channel 'value': every group holds fewer than 3 values, so there is no distribution to summarise",
      remedy: 'bind a column with several rows per group, or compare single values with a ranked bar instead',
    });
  }
  return errors;
}

function defaultHeadline(stats) {
  const { top, runnerUp, overlaps, medianGap } = stats;
  if (!top) return 'No distributions in the bound data';
  if (!runnerUp) return `"${top.label}" runs from ${formatNumber(top.min)} to ${formatNumber(top.max)}`;
  if (overlaps) {
    const gap = medianGap === null ? '' : ` by ${formatNumber(Math.abs(medianGap))}`;
    return `"${top.label}" has the higher median${gap} — but its range overlaps "${runnerUp.label}"`;
  }
  return `"${top.label}" clears "${runnerUp.label}" outright — the ranges do not overlap`;
}

/**
 * WHICH BOX CARRIES THE ACCENT — the group the headline is about.
 *
 * Mirrors ranked-bar's emphasisLabel(): one emphasis per piece (docs/color.md),
 * landing on the group the piece is actually talking about. Colour is NOT used
 * to name the groups here — the axis already does that, and a hue per box would
 * be a second encoding of the same fact.
 */
export function emphasisLabel(stats) {
  return stats.top ? stats.top.label : null;
}

function defaultDek(stats, copy, config, showBox) {
  const clauses = [
    `${stats.groupCount} ${stats.groupCount === 1 ? 'group' : 'groups'}, ${stats.totalValues} values`,
    showBox
      ? 'curve = density, box = middle half, whiskers = 1.5×IQR'
      : 'curve = density above, every value raining below, line = median',
  ];
  if (stats.outlierCount) {
    clauses.push(`${stats.outlierCount} beyond the whiskers, drawn open`);
  }
  const subject = (copy || {}).subject;
  return `${clauses.join(', ')}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(config, ' Every faint dot behind is one bound value; hover it.');
}

export function mount(el, config = {}) {
  let state = normalize(config);

  function frameOpts() {
    return {
      legend: false,
      ariaLabel: `${state.showBox ? 'Violin and box plot' : 'Raincloud plot'}, ${state.stats.groupCount} groups across ${state.stats.totalValues} values`,
      defaultHeadline: defaultHeadline(state.stats),
      defaultDek: defaultDek(state.stats, state.config.copy, state.config, state.showBox),
      note: state.note,
    };
  }

  let frame = buildFrame(el, state.config, frameOpts());
  let teardown = null;
  let currentSize = null;

  // The summary assembles — median, box, whiskers — and then the sample it
  // summarises rains in behind it. Afterwards the group the headline is about
  // keeps breathing.
  const motion = createMotion(el, config);

  function draw(width, height) {
    const { data, stats } = state;
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    if (!data.length) return;

    // HORIZONTAL ROWS, ONE PER GROUP — the layout both of this module's cards
    // have always shown, and the only one that fits a density curve plus its own
    // raw sample without the two fighting for the same vertical space. Value
    // runs along x, groups stack down y: the curve rises off each row's baseline
    // and the sample rains below it.
    const labelRoom = Math.min(150, Math.max(64, ...data.map((g) => g.label.length * 7 + 18)));
    const m = { top: 16, right: 26, bottom: 46, left: labelRoom };
    // Domain over EVERY bound value, outliers included — a fence is a reading
    // convention, never a reason to crop a real observation out of frame.
    const allValues = data.flatMap((g) => g.values);
    const vDomain = positionDomain(allValues).domain;
    const x = linearScale(vDomain, [m.left, width - m.right]);
    const band = bandScale(data.map((g) => g.label), [m.top, height - m.bottom], 0.3);
    const rowH = band.bandwidth();
    // The baseline sits low in the row: the curve needs the room above it, the
    // sample needs a thinner strip below.
    const curveH = rowH * 0.6;
    const rainH = rowH * 0.3;

    const grid = svgEl('g');
    for (const t of ticks(vDomain[0], vDomain[1], 5)) {
      const p = x(t);
      grid.appendChild(svgEl('line', {
        x1: p, x2: p, y1: m.top, y2: height - m.bottom,
        stroke: 'var(--_ink)', 'stroke-opacity': 0.09, 'stroke-width': 1,
      }));
      const label = svgEl('text', {
        x: p, y: height - m.bottom + 18, 'text-anchor': 'middle',
        fill: 'var(--_ink)', 'fill-opacity': 0.66,
        'font-family': 'var(--_fl)', 'font-size': 11, 'font-variant-numeric': 'tabular-nums',
      });
      label.textContent = formatNumber(t);
      grid.appendChild(label);
    }
    svg.appendChild(grid);

    const marks = svgEl('g');
    // group label -> every mark that belongs to it, so hovering one group can
    // drop the others back.
    const groupMarks = new Map();
    const claim = (label, node) => {
      if (!groupMarks.has(label)) groupMarks.set(label, []);
      groupMarks.get(label).push(node);
      return node;
    };

    data.forEach((group, gi) => {
      const base = band(group.label) + rowH * 0.68;
      const isSubject = group.label === state.emphasis;
      const stroke = isSubject ? 'var(--_accent)' : 'var(--_mark)';
      const strokeOpacity = isSubject ? 1 : 'var(--_mark-opacity)';

      // A faint rule per row, so a row with a narrow curve still reads as a row.
      marks.appendChild(claim(group.label, svgEl('line', {
        x1: m.left, x2: width - m.right, y1: base, y2: base,
        stroke, 'stroke-opacity': 0.28, 'stroke-width': 1,
      })));

      // 1. THE DENSITY CURVE — the shape of the sample, which is the subject of
      // both forms. Closed back along the baseline so it reads as one body.
      if (group.density.length) {
        const pts = group.density
          .map((d) => `${x(d.x).toFixed(2)},${(base - (d.y / group.densityPeak) * curveH).toFixed(2)}`)
          .join(' L');
        const violin = svgEl('path', {
          d: `M${x(group.density[0].x).toFixed(2)},${base.toFixed(2)} L${pts} L${x(group.density[group.density.length - 1].x).toFixed(2)},${base.toFixed(2)} Z`,
          fill: stroke, 'fill-opacity': isSubject ? 0.3 : 0.18,
          stroke, 'stroke-opacity': strokeOpacity, 'stroke-width': 1.4,
          'stroke-linejoin': 'round',
          // Grows up off its own baseline, which is where the reading starts.
          'data-vf-part': 'violin', 'data-vf-order': gi,
        });
        if (isSubject) violin.setAttribute('data-vf-peak', '');
        marks.appendChild(claim(group.label, violin));
      }

      // 2. The raw sample, raining below the baseline.
      group.points.forEach((point) => {
        const px = x(point.value);
        const py = base + rainH * 0.5 + point.jitter * rainH * 0.8;
        const dot = svgEl('circle', {
          cx: px, cy: py, r: 2.3,
          fill: stroke, 'fill-opacity': isSubject ? 0.4 : 0.26,
          style: 'cursor:default',
          'data-vf-part': 'dot',
        });
        claim(group.label, dot);
        const onEnter = () => {
          const box = frame.svg.getBoundingClientRect();
          showTip(
            frame.tip,
            `<div><b>${escapeHtml(group.label)}</b></div><div>one value · <b>${formatNumber(point.value)}</b></div>`,
            (px / width) * box.width,
            (py / height) * box.height
          );
        };
        dot.addEventListener('pointerenter', onEnter);
        dot.addEventListener('pointermove', onEnter);
        dot.addEventListener('pointerleave', () => hideTip(frame.tip));
        marks.appendChild(dot);
      });

      // 3. THE SUMMARY. With a box (a violin) it is quartiles and Tukey fences
      // laid over the curve; without one (a raincloud) the median alone carries
      // it, because a raincloud's claim is the SHAPE and a box on top of it is a
      // second, competing summary of the same numbers.
      const boxH = Math.min(20, rowH * 0.26);
      let hotspot = null;

      if (state.showBox) {
        for (const [from, to] of [[group.whiskerLo, group.q1], [group.q3, group.whiskerHi]]) {
          marks.appendChild(claim(group.label, svgEl('line', {
            x1: x(from), x2: x(to), y1: base, y2: base,
            stroke, 'stroke-opacity': strokeOpacity, 'stroke-width': 1.5,
            'data-vf-part': 'whisker',
          })));
        }
        for (const end of [group.whiskerLo, group.whiskerHi]) {
          marks.appendChild(claim(group.label, svgEl('line', {
            x1: x(end), x2: x(end), y1: base - boxH * 0.4, y2: base + boxH * 0.4,
            stroke, 'stroke-opacity': strokeOpacity, 'stroke-width': 1.5,
            'data-vf-part': 'whisker',
          })));
        }
        const bx = x(group.q1);
        const rect = svgEl('rect', {
          x: bx, y: base - boxH / 2,
          width: Math.max(1, x(group.q3) - bx), height: boxH, rx: 3,
          fill: 'var(--_paper)', 'fill-opacity': 0.92,
          stroke, 'stroke-opacity': strokeOpacity, 'stroke-width': 1.6,
          style: 'cursor:pointer',
          'data-vf-part': 'box',
        });
        if (isSubject) rect.setAttribute('data-vf-peak', '');
        marks.appendChild(claim(group.label, rect));
        hotspot = rect;
      }

      // The median is the heaviest mark in the row either way — it is the number
      // the row is read for.
      const median = svgEl('line', {
        x1: x(group.median), x2: x(group.median),
        y1: base - (state.showBox ? boxH / 2 : curveH * 0.62), y2: base + (state.showBox ? boxH / 2 : 2),
        stroke, 'stroke-opacity': 1, 'stroke-width': state.showBox ? 2.4 : 2,
        'data-vf-part': 'median',
      });
      if (isSubject) median.setAttribute('data-vf-peak', '');
      marks.appendChild(claim(group.label, median));

      // 4. Outliers, drawn open and individually — never dropped.
      group.outliers.forEach((v) => {
        marks.appendChild(claim(group.label, svgEl('circle', {
          cx: x(v), cy: base + rainH * 0.5, r: 3.6, fill: 'none',
          stroke, 'stroke-opacity': strokeOpacity, 'stroke-width': 1.4,
          'data-vf-part': 'outlier',
        })));
      });

      // 5. Group label, its n and its median, at the left of the row.
      const label = svgEl('text', {
        x: m.left - 10, y: base - 4, 'text-anchor': 'end',
        fill: isSubject ? 'var(--_accent)' : 'var(--_ink)', 'fill-opacity': isSubject ? 1 : 0.86,
        'font-family': 'var(--_fl)', 'font-size': 11.5, 'font-weight': isSubject ? 600 : 400,
      });
      label.textContent = group.label;
      marks.appendChild(label);

      const nLabel = svgEl('text', {
        x: m.left - 10, y: base + 10, 'text-anchor': 'end',
        fill: 'var(--_ink)', 'fill-opacity': 0.6,
        'font-family': 'var(--_ff)', 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums',
      });
      nLabel.textContent = `n=${group.n} · med ${formatNumber(group.median)}`;
      marks.appendChild(nLabel);

      // Sibling dimming, by GROUP. A distribution is read by comparison, so
      // pointing at one row has to push the others back rather than only
      // printing its own numbers. Without a box the CURVE is the hotspot.
      const summaryTip = () => {
        const box = frame.svg.getBoundingClientRect();
        const outlierLine = group.outliers.length
          ? `<div>${group.outliers.length} beyond the whiskers</div>`
          : '';
        showTip(
          frame.tip,
          `<div><b>${escapeHtml(group.label)}</b></div>`
          + `<div>median <b>${formatNumber(group.median)}</b> · Q1 <b>${formatNumber(group.q1)}</b> · Q3 <b>${formatNumber(group.q3)}</b></div>`
          + `<div>range <b>${formatNumber(group.min)}</b>–<b>${formatNumber(group.max)}</b> · ${group.n} values</div>`
          + outlierLine,
          (x(group.median) / width) * box.width,
          ((base - curveH * 0.4) / height) * box.height
        );
      };
      const isolate = () => {
        motion.hold();
        for (const [lab, nodes] of groupMarks) {
          const dim = lab === group.label ? '' : '0.2';
          for (const node of nodes) node.style.opacity = dim;
        }
      };
      const release = () => {
        for (const nodes of groupMarks.values()) {
          for (const node of nodes) node.style.opacity = '';
        }
        motion.free();
      };
      if (!hotspot) hotspot = marks.querySelector(`path[data-vf-order="${gi}"]`);
      if (hotspot) {
        hotspot.style.cursor = 'pointer';
        hotspot.addEventListener('pointerenter', () => { isolate(); summaryTip(); });
        hotspot.addEventListener('pointermove', summaryTip);
        hotspot.addEventListener('pointerleave', () => { release(); hideTip(frame.tip); });
      }
    });

    svg.appendChild(marks);

    motion.attach(svg, { build: 'rain', dur: 4000, rest: 'peak' });
  }

  function redraw() { if (currentSize) draw(currentSize[0], currentSize[1]); }

  function observe() {
    return observeSize(el, frame.plot, (w, h) => { currentSize = [w, h]; draw(w, h); }, {
      aspect: state.aspect,
      fit: state.fit,
      minHeight: 240,
    });
  }

  teardown = observe();

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
      frame = buildFrame(el, state.config, frameOpts());
      teardown = observe();
    },
    get stats() { return state.stats; },
    redraw,
  };
}

function normalize(config) {
  let data;
  let stats;

  // The simple form — [{label, values:[...]}] or [{label, value}] — exists so a
  // caller can hand-build a piece without a table, matching the other modules.
  if (Array.isArray(config.data) && !config.bindings) {
    const rows = [];
    for (const entry of config.data) {
      const label = entry.label ?? entry.category;
      if (Array.isArray(entry.values)) {
        for (const v of entry.values) rows.push({ c: label, v });
      } else {
        rows.push({ c: label, v: entry.value });
      }
    }
    ({ data, stats } = shape(rows, { category: 'c', value: 'v' }));
  } else {
    ({ data, stats } = shape(config.data || config.rows || [], config.bindings || {}));
  }

  const notes = [];
  // The value axis is position, so a non-zero baseline is legitimate AND must be
  // disclosed — the reader cannot otherwise judge the spread they are seeing.
  // Same wording as trend's disclosure, for the same reason.
  if (data.length) {
    const { domain } = positionDomain(data.flatMap((g) => g.values));
    if (domain[0] > 0) notes.push('the value axis does not start at zero (position encoding, disclosed)');
  }
  // TWO FORMS OUT OF ONE MODULE, and the note has to say which one you are
  // reading. A violin lays a quartile box over the curve; a raincloud does not,
  // because the curve IS its claim and a box on top is a second, competing
  // summary of the same numbers. Both disclose that the curve is an ESTIMATE —
  // a kernel smooth, not the sample itself, which is exactly why the sample is
  // drawn underneath it.
  const showBox = config.box !== false;
  notes.push('the curve is a kernel density estimate of the sample below it, scaled to its own row — height compares SHAPE, the n compares size');
  if (showBox) notes.push('box = middle half, whiskers = 1.5×IQR — a convention, not a property of the data');
  // Vertical position within a row is the one thing in this piece that means
  // nothing: the dots are spread to stop them overlapping.
  notes.push('dots are spread vertically only to stop them overlapping — that spread carries no value');
  if (stats.thinnest && stats.thinnest.n < 5) {
    notes.push(`"${stats.thinnest.label}" summarises only ${stats.thinnest.n} values`);
  }
  if (stats.skipped) {
    notes.push(`${stats.skipped} of ${stats.sourceRowCount} rows had no usable group or value and were left out`);
  }

  return {
    config,
    data,
    stats,
    emphasis: emphasisLabel(stats),
    showBox,
    note: notes.join('; '),
    aspect: config.aspect || 0.58,
    fit: config.fit || 'aspect',
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
