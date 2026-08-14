// assets/modules/gallery-registry.mjs
//
// THE ANIMATED FRITZ GALLERY, AS A LIBRARY YOU CAN BROWSE.
//
// The deployed gallery ("Forty-six ways to look at the technology business.
// In motion.") holds 48 pieces, of which 32 carry a build-and-rest animation
// from demo/builders/anim2.js. Those 32 are the library — Jon's call, and the
// reason is that a still piece in a motion gallery reads as an unfinished one.
//
// WHAT THIS FILE IS FOR. The Studio's job is to let someone see the WHOLE
// library at once and understand its breadth, then find the handful of forms
// their own table can actually carry. So every entry states, in a sentence a
// non-specialist can act on, what kind of data it wants — and `fit()` turns
// that sentence into a verdict against a real profile, with the reason written
// out when the answer is no. A greyed card is never a dead end: it says which
// column it is missing.
//
// PORTABLE vs NOT. `module` names the portable `assets/modules/<slug>.js` that
// renders the form against arbitrary bound data. Where it is null the form
// exists in the gallery as hand-written D3 over its own fixed dataset and has
// not been ported yet. That is a DIFFERENT state from "does not fit your data"
// and the screen must show it differently — conflating the two would tell a
// reader their data is wrong when the truth is the library is incomplete.
//
// This registry deliberately shares no code with the atlas (skill/manifest/*).
// The atlas is the static-scaffold lineage; this is the gallery lineage.

export const TIERS = ['Conventional', 'Unconventional', 'Experimental', 'Interactive'];

const T = { QUANT: 'quantitative', TEMPORAL: 'temporal', NOMINAL: 'nominal', ORDINAL: 'ordinal' };

// --- profile shape helpers -------------------------------------------------

const fieldsOf = (p) => (p && Array.isArray(p.fields) ? p.fields : []);
/**
 * Rows and distinct-count, read off the REAL profile contract
 * (scripts/profile.mjs emits {fields:[{name,type,cardinality,missing}], rows}).
 * Writing these against a guessed `distinct`/`rowCount` is how a fit rule ends
 * up silently comparing undefined and offering every form for every table.
 */
const rowsOf = (p) => (p && Array.isArray(p.rows) ? p.rows : []);
const nRows = (p) => (p && Number.isFinite(p.rowCount) ? p.rowCount : rowsOf(p).length);
/**
 * TWO FIELD SHAPES REACH THIS FILE and they disagree on one key.
 * scripts/profile.mjs emits `cardinality`; the summary that POST /studio/profile
 * actually sends to the browser (registry.summarize) emits `distinct`. Reading
 * only one of them returns 0 for every column, which fails every rule that
 * needs a category — so the whole library greys out and the reasons all read
 * "needs a category column" over a table that plainly has one.
 */
const distinct = (f) => {
  if (!f) return 0;
  if (Number.isFinite(f.cardinality)) return f.cardinality;
  if (Number.isFinite(f.distinct)) return f.distinct;
  return 0;
};
/** Numeric extent for a column, computed from the rows when a rule needs it. */
function extent(p, name) {
  let lo = Infinity; let hi = -Infinity; let sum = 0; let n = 0;
  for (const row of rowsOf(p)) {
    const v = Number(row[name]);
    if (!Number.isFinite(v) || String(row[name]).trim() === '') continue;
    if (v < lo) lo = v; if (v > hi) hi = v; sum += v; n += 1;
  }
  return n ? { min: lo, max: hi, sum, count: n } : null;
}
const byType = (p, types, exclude = []) =>
  fieldsOf(p).filter((f) => types.includes(f.type) && !exclude.includes(f.name));
const first = (p, types, exclude = [], test) => {
  const found = byType(p, types, exclude).filter((f) => (test ? test(f) : true));
  return found[0] || null;
};
const quants = (p, exclude = []) => byType(p, [T.QUANT], exclude);
const cats = (p, lo = 2, hi = Infinity, exclude = []) =>
  byType(p, [T.NOMINAL, T.ORDINAL], exclude).filter((f) => distinct(f) >= lo && distinct(f) <= hi);

/**
 * A numeric column that is an ORDERING rather than a measurement — a year, a
 * week index. Without this a revenue column gets drawn as a time axis.
 */
const SEQ_NAME = /^(year|yr|month|week|day|period|quarter|q|date|time|t|step|index|idx|rank|n)$/i;
const sequential = (p, f) => {
  if (SEQ_NAME.test(String(f.name).trim())) return true;
  // An ordering is EVENLY SPACED, not merely small. Checking the span alone
  // let a four-row cost column (4, 5, 9, 12) pass as an axis of time, which
  // then offered a line chart, a bump chart and a streamgraph for a table with
  // no time in it at all. Real steps have a constant gap.
  const vals = [...new Set(rowsOf(p)
    .map((r) => Number(r[f.name]))
    .filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  if (vals.length < 5) return false;
  if (!vals.every((v) => Number.isInteger(v))) return false;
  const step = vals[1] - vals[0];
  if (!(step > 0)) return false;
  return vals.every((v, i) => i === 0 || Math.abs(v - vals[i - 1] - step) < 1e-9);
};

const temporal = (p) => first(p, [T.TEMPORAL]);
const ordered = (p) => temporal(p) || first(p, [T.QUANT], [], (f) => sequential(p, f));

/**
 * HOW MANY THINGS A FORM CAN ACTUALLY SHOW.
 *
 * Jon's rule: if a card cannot show enough, do not recommend that card. The
 * ts-family rules have always carried a cap — a line takes 2 to 12 series, a
 * bump 3 to 14 — but the edge and hierarchy families asked only whether the
 * columns EXIST, never how many distinct values they hold. So the screen lit up
 * and offered pictures that cannot be read:
 *
 *   - A CHORD on weekday x hour puts 19 members on the ring and 81 ribbons
 *     through the middle. It draws pale wisps, and its own source line already
 *     admits the order of the arcs means nothing.
 *   - A SANKEY on category x line item stands 27 targets in one column. Their
 *     labels overlap each other and the last one is clipped by the frame: about
 *     380px of stage height cannot label 27 nodes at 11px plus a value line,
 *     which is roughly 16 before they touch.
 *   - AN ARC DIAGRAM on the same table takes 34 nodes and truncates half the
 *     names it is there to compare ("Cloud & infras...", "Contact cen...").
 *
 * The numbers below are the readable limits those renders demonstrate, snapped
 * to the vocabulary this file already uses (12 is the house number for
 * "categories a reader can hold" — line series, marimekko, raincloud, violin).
 * A ring is the strictest because every member also crosses every other; a line
 * of nodes is the most forgiving because position does the separating. Each one
 * is named here so it is a single edit to retune.
 */
const LIMITS = {
  chordMembers: 12,   // arcs on a ring, each crossed by ribbons from all others
  flowPerColumn: 12,  // nodes stacked in one sankey column, each needing a label
  arcMembers: 24,     // nodes along an axis, labels rotated but written in full
};

/**
 * The members a ring or a flow actually has to draw and label.
 *
 * Per-side counts come from the field cardinality, which is computed over the
 * whole table; the ring's membership is the UNION of the two ends and has to be
 * counted from the rows, because a value like "Site visit" can be both a source
 * and a target. Rows may be a capped sample, so the union is floored at the
 * larger side's true cardinality rather than trusted on its own.
 */
function edgeScale(p, e) {
  const sources = distinct(e.source);
  const targets = distinct(e.target);
  const union = new Set();
  for (const row of rowsOf(p)) {
    const s = String(row[e.source.name] ?? '').trim();
    const t = String(row[e.target.name] ?? '').trim();
    if (s) union.add(s);
    if (t) union.add(t);
  }
  return { sources, targets, members: Math.max(union.size, sources, targets) };
}

/** source / target / weight — the shape a flow or a network needs. */
function edgePair(p) {
  const c = cats(p, 2);
  if (c.length < 2) return null;
  const named = c.filter((f) => /source|from|target|to|parent|child|left|right/i.test(f.name));
  const pair = named.length >= 2 ? named.slice(0, 2) : c.slice(0, 2);
  const w = quants(p, pair.map((f) => f.name))[0] || null;
  return { source: pair[0], target: pair[1], value: w };
}

/**
 * A number that ADDS UP, preferred over one that does not.
 *
 * Every area form here states a whole and divides it, so the size column gets
 * summed. Summing a rate — a price per seat, an average, a score — produces a
 * total that does not exist, and the first numeric column in the file is as
 * likely to be one as not. The name is the only signal available at this stage;
 * the modules disclose the doubt in the source line either way.
 */
const RATE_NAME = /(^|[\s_-])(per|rate|avg|average|mean|median|pct|percent|share|ratio|score|index|margin)([\s_-]|$)|_per_|%/i;
const sizeColumn = (p, exclude = []) => {
  const q = quants(p, exclude);
  return q.find((f) => !RATE_NAME.test(String(f.name))) || q[0] || null;
};

/** Two levels of category plus a size — what a treemap or a sunburst needs. */
function hierarchy(p) {
  const c = cats(p, 2);
  if (c.length < 2) return null;
  const parent = c.find((f) => distinct(f) <= 12) || c[0];
  const child = c.find((f) => f !== parent && distinct(f) > distinct(parent)) || c.find((f) => f !== parent);
  if (!child) return null;
  const size = sizeColumn(p) || null;
  return { parent, child, size };
}

const yes = (why, bindings = {}, confidence = 'strong', options = {}) =>
  ({ ok: true, why, bindings, confidence, options });
const no = (why) => ({ ok: false, why });

// --- the library -----------------------------------------------------------
//
// `data` is the sentence the card shows at rest: what this form is FOR, in
// terms of columns. `fit` is the same claim, checkable.

export const GALLERY = [
  // ---------------------------------------------------------------- Conventional
  {
    slug: 'conv-line', tier: 'Conventional', title: 'Line', module: 'trend',
    build: 'trace', rest: 'tracer',
    gallery: 'The AI SDK boom — weekly npm downloads',
    answers: 'How has this changed over time?',
    data: 'A date column and a number. Add a category column and you get one line per series.',
    honesty: 'Position encoding, so a non-zero baseline is allowed and is disclosed in the source line.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date column, or a numeric column that is genuinely an ordering like a year');
      const y = first(p, [T.QUANT], [x.name]);
      if (!y) return no('needs a numeric column to plot against the date');
      if (nRows(p) < 2) return no(`needs at least 2 rows to draw a line (found ${nRows(p)})`);
      const s = cats(p, 2, 12)[0];
      return yes(`"${x.name}" orders the x-axis and "${y.name}" is numeric`,
        { x: x.name, y: y.name, series: s ? s.name : undefined },
        x.type === T.TEMPORAL ? 'strong' : 'possible',
        { xType: x.type === T.TEMPORAL ? 'temporal' : 'quantitative' });
    },
  },
  {
    slug: 'conv-bump', tier: 'Conventional', title: 'Bump', module: 'bump',
    build: 'trace', rest: 'walk',
    gallery: 'Ten years to dethrone JavaScript',
    answers: 'Who overtook whom, and when?',
    data: 'A date or period column, a category, and a value — the value becomes a RANK per period, so it needs several categories measured at every step.',
    honesty: 'Rank hides magnitude. A series can climb the chart while its actual value falls.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date or period column to rank within');
      const c = cats(p, 3, 14)[0];
      if (!c) return no('needs a category column with 3 to 14 distinct values to rank against each other');
      const v = quants(p, [x.name])[0];
      if (!v) return no('needs a numeric column to rank by');
      return yes(`"${c.name}" ranked by "${v.name}" at each "${x.name}"`, { x: x.name, series: c.name, y: v.name });
    },
  },
  {
    slug: 'conv-connected', tier: 'Conventional', title: 'Connected scatter', module: 'connected',
    build: 'trace', rest: 'tracer',
    gallery: 'The cloud chase — a connected scatter',
    answers: 'How did two measures move together over time?',
    data: 'Two numeric columns plus a date, so the path can be threaded in time order. One entity per line.',
    honesty: 'The line between two points is a connector in time, not interpolation.',
    fit(p) {
      const t = ordered(p);
      if (!t) return no('needs a date or ordered column to thread the path in sequence');
      const q = quants(p, [t.name]);
      if (q.length < 2) return no(`needs two numeric columns for the two axes (found ${q.length})`);
      // A category, when there is one, becomes ONE PATH EACH. Without it every
      // entity's points thread into a single line that zigzags between them —
      // which is the card's "one entity per line" quietly broken.
      const who = cats(p, 2, 8)[0];
      return yes(`"${q[0].name}" against "${q[1].name}", threaded by "${t.name}"`
        + (who ? `, one path per "${who.name}"` : ''),
        { x: q[0].name, y: q[1].name, t: t.name, series: who ? who.name : undefined });
    },
  },
  {
    // KNOWN FORM MISMATCH (2026-08-02). The gallery piece is a true dumbbell —
    // two markers joined by a connector, position-encoded. `ranked-bar`'s
    // compare mode draws something else: a bar from zero with a reference RULE
    // at the second value. Both answer "what changed between two moments", and
    // the port is honest about what it draws, but it is not the picture on this
    // card's thumbnail, which is why the two disagree. `build: 'grow'` is
    // correct for a bar; the gallery's `stretch` would animate circles and a
    // connector that this module never draws. Fixing it means giving ranked-bar
    // a real dumbbell mode — a change of ENCODING (and of the honesty note,
    // since a dumbbell needs no zero baseline), not of the entrance.
    slug: 'conv-dumbbell', tier: 'Conventional', title: 'Dumbbell', module: 'ranked-bar',
    build: 'stretch', rest: 'peak',
    gallery: 'The cloud gap closes — share 2017 vs 2024',
    answers: 'What changed between two moments?',
    data: 'A category and TWO numeric columns — before and after, this year and last.',
    honesty: 'The dot pair shows the gap; the connector carries no values of its own.',
    fit(p) {
      const c = cats(p, 2, 30)[0];
      if (!c) return no('needs a category column to put on each row');
      const q = quants(p);
      if (q.length < 2) return no(`needs two numeric columns, a before and an after (found ${q.length})`);
      return yes(`"${c.name}" compared on "${q[0].name}" against "${q[1].name}"`,
        { category: c.name, value: q[0].name, compare: q[1].name }, 'strong',
        // A REAL DUMBBELL, not a bar with a reference tick. `dumbbell` switches
        // ranked-bar to two position-encoded markers joined by a connector, which
        // is what this card's thumbnail has always shown and what the gallery
        // piece draws. It also switches the honesty note, because position does
        // not need a zero baseline the way length does.
        { orientation: 'horizontal', dumbbell: true });
    },
  },
  {
    slug: 'conv-multiples', tier: 'Conventional', title: 'Small multiples', module: 'multiples',
    build: 'trace', rest: 'peak',
    gallery: 'There is React — and there is everyone else',
    answers: 'How does each one behave on its own?',
    data: 'A date, a number, and a category — one small chart per category, all on a shared scale.',
    honesty: 'Every panel shares one scale, so panels are comparable to each other.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date or ordered column for each panel to run along');
      const y = first(p, [T.QUANT], [x.name]);
      if (!y) return no('needs a numeric column to plot in each panel');
      const c = cats(p, 2, 16)[0];
      if (!c) return no('needs a category column with 2 to 16 values — one panel each');
      return yes(`one panel per "${c.name}", each plotting "${y.name}" over "${x.name}"`,
        { x: x.name, y: y.name, series: c.name });
    },
  },
  {
    slug: 'conv-waterfall', tier: 'Conventional', title: 'Waterfall', module: 'waterfall',
    build: 'grow', rest: 'peak',
    gallery: 'The ARR bridge — a benchmark SaaS year',
    answers: 'What added up to the final number?',
    data: 'An ordered list of steps with signed numbers — additions positive, subtractions negative. A bridge from a start to an end.',
    honesty: 'Bars sit on a running total, so length is a change and position is the level reached.',
    fit(p) {
      const c = cats(p, 3, 20)[0];
      if (!c) return no('needs a column of step labels, in the order they happen');
      const q = quants(p)[0];
      if (!q) return no('needs a numeric column of changes');
      const e = extent(p, q.name);
      if (!e || !(e.min < 0)) return no(`"${q.name}" has no negative values, so there is nothing to bridge down — a ranked bar suits this better`);
      return yes(`"${c.name}" as steps, "${q.name}" as signed changes`, { step: c.name, delta: q.name });
    },
  },

  // THE FIVE ORDINARY ONES, added 2026-08-03 (Jon: "develop some more standard
  // ones that are missing. Like pie, bar").
  //
  // The gallery's own "Conventional" tier came from a bespoke B2B deck, so it
  // held a bump chart and a dumbbell but no bar and no pie — the library could
  // draw a chord diagram of your data and not a bar chart of it. These five are
  // not ports of gallery pieces; they are written against the same harness, so
  // they animate and answer a hover like everything else here.
  //
  // ORDER MATTERS AND THEY GO LAST. The registry's order is the tiebreaker
  // between equally-confident modules, and putting a bar chart above `trend` or
  // `ranked-bar` would silently steal the default for tables those already
  // serve well (the trap `parallel` hit when the data cube was inserted above
  // it). At the end of the tier they win only where nothing else fits.
  {
    slug: 'conv-bar', tier: 'Conventional', title: 'Bar chart', module: 'bar',
    build: 'grow', rest: 'peak',
    gallery: 'The plainest comparison there is',
    answers: 'How do these categories compare?',
    data: 'A category column and a number. Add a second category to group or stack the bars.',
    honesty: 'Length encodes, so the axis always includes zero — negatives hang below the line rather than vanishing.',
    fit(p) {
      const c = cats(p, 2, 40)[0];
      if (!c) return no('needs a category column with between 2 and 40 distinct values');
      const v = sizeColumn(p);
      // No measure is not a refusal: "how many of each?" is a real question and
      // catShape counts rows when nothing is bound to value.
      const split = cats(p, 2, 6, [c.name])[0];
      const why = v
        ? `"${c.name}" compared on "${v.name}"${split ? `, split by "${split.name}"` : ''}`
        : `one bar per "${c.name}", counting rows`;
      return yes(why, { category: c.name, value: v ? v.name : undefined, series: split ? split.name : undefined },
        'strong', { stacked: Boolean(split) && distinct(c) > 8 });
    },
  },
  {
    slug: 'conv-pie', tier: 'Conventional', title: 'Pie / donut', module: 'pie',
    build: 'ring', rest: 'walk',
    gallery: 'One whole, divided',
    answers: 'How does the whole divide?',
    data: 'A category column with a handful of values, and a number that genuinely sums to a whole.',
    honesty: 'Slices sum to 100% of a real total. Angle is a weak comparison, so every readable slice is labelled.',
    fit(p) {
      const c = cats(p, 2, 40)[0];
      if (!c) return no('needs a category column to divide the whole into');
      // A pie is a part-to-whole claim, so the three things that make the whole
      // meaningless are hard refusals rather than warnings.
      if (distinct(c) > 8) {
        return no(`"${c.name}" has ${distinct(c)} values and a pie stops being readable past about 8 — `
          + 'a bar chart compares them by length, which the eye does far better than angle');
      }
      const v = sizeColumn(p);
      if (!v) return no('needs a numeric column whose values add up to a whole');
      if (RATE_NAME.test(String(v.name))) {
        return no(`"${v.name}" reads as a rate or an average, and those do not sum to a whole — `
          + 'a pie of them would show a total that does not exist. Use a bar chart');
      }
      const e = extent(p, v.name);
      if (e && e.min < 0) {
        return no(`"${v.name}" goes negative and a slice has no way to be minus eight percent — use a bar chart, `
          + 'which can sit below its baseline');
      }
      return yes(`"${c.name}" divides the total of "${v.name}"`,
        { category: c.name, value: v.name }, distinct(c) <= 6 ? 'strong' : 'possible', { donut: true });
    },
  },
  {
    slug: 'conv-scatter', tier: 'Conventional', title: 'Scatter plot', module: 'scatter',
    build: 'rain', rest: 'attract',
    gallery: 'Two measures, one dot per row',
    answers: 'Do these two measures move together?',
    data: 'Two numeric columns. Add a category to colour the dots. Drag a box to select a region.',
    honesty: 'Every row is its own dot — nothing is binned or averaged, and r is printed with its caveat.',
    fit(p) {
      const q = quants(p);
      if (q.length < 2) return no(`needs two numeric columns to put on the two axes (found ${q.length})`);
      if (nRows(p) < 4) return no(`needs at least 4 rows to show a relationship (found ${nRows(p)})`);
      const s = cats(p, 2, 8)[0];
      return yes(`"${q[0].name}" against "${q[1].name}"${s ? `, coloured by "${s.name}"` : ''}`,
        { x: q[0].name, y: q[1].name, series: s ? s.name : undefined });
    },
  },
  {
    slug: 'conv-histogram', tier: 'Conventional', title: 'Histogram', module: 'histogram',
    build: 'grow', rest: 'peak',
    gallery: 'The shape of one column',
    answers: 'How is this one measure distributed?',
    data: 'A single numeric column, and enough rows that a shape exists. Rebin it to test the shape.',
    honesty: 'The bin WIDTH is printed in data units, and the rule that chose it is named — bin width decides the picture.',
    fit(p) {
      const v = sizeColumn(p);
      if (!v) return no('needs a numeric column to distribute');
      // Below about 20 values a histogram is mostly binning artefacts; the
      // honest form for a handful of numbers is a strip that draws each one.
      if (nRows(p) < 20) {
        return no(`${nRows(p)} rows is too few to have a distribution — under about 20 the bars are the binning, `
          + 'not the data; a dot strip draws every value instead');
      }
      const e = extent(p, v.name);
      if (e && e.min === e.max) return no(`every value of "${v.name}" is ${e.min} — there is no shape to draw`);
      return yes(`the distribution of "${v.name}" across ${nRows(p)} rows`, { value: v.name });
    },
  },
  {
    slug: 'conv-area', tier: 'Conventional', title: 'Area chart', module: 'area',
    build: 'trace', rest: 'tracer',
    gallery: 'A quantity over time, filled',
    answers: 'How has this quantity accumulated?',
    data: 'A date column and a number that is a COUNT or a TOTAL. Add a category to stack the series.',
    honesty: 'The fill claims the quantity accumulates to zero, so the baseline is always zero — never truncated.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date column, or a numeric column that is genuinely an ordering like a year');
      const y = first(p, [T.QUANT], [x.name], (f) => !RATE_NAME.test(String(f.name)));
      if (!y) {
        const any = first(p, [T.QUANT], [x.name]);
        return any
          ? no(`"${any.name}" reads as a rate or an index, and the space under a rate is not a quantity of `
            + 'anything — a line chart shows the same numbers without claiming an area')
          : no('needs a numeric column to fill under');
      }
      const e = extent(p, y.name);
      if (e && e.min < 0) {
        return no(`"${y.name}" goes negative, and an area that crosses its own baseline reads as two quantities `
          + 'rather than one — use a line');
      }
      if (nRows(p) < 3) return no(`needs at least 3 points to fill under (found ${nRows(p)})`);
      const s = cats(p, 2, 8)[0];
      return yes(`"${y.name}" accumulating over "${x.name}"${s ? `, stacked by "${s.name}"` : ''}`,
        { x: x.name, y: y.name, series: s ? s.name : undefined },
        x.type === T.TEMPORAL ? 'strong' : 'possible',
        { stacked: Boolean(s), xType: x.type === T.TEMPORAL ? 'temporal' : 'quantitative' });
    },
  },

  // -------------------------------------------------------------- Unconventional
  {
    slug: 'unc-sankey', tier: 'Unconventional', title: 'Sankey', module: 'sankey',
    build: 'sankey', rest: 'flow',
    gallery: '10,000 leads in, 82 customers out',
    answers: 'Where did the volume go?',
    data: 'EDGES: a source column, a target column, and a quantity that flows between them.',
    honesty: 'Ribbon width is the quantity. Flows must conserve, or the diagram invents volume.',
    fit(p) {
      const e = edgePair(p);
      if (!e) return no('needs two category columns — a source and a target — to draw flows between');
      if (!e.value) return no(`found "${e.source.name}" and "${e.target.name}" to flow between, but no numeric column to carry the volume`);
      const n = edgeScale(p, e);
      const worst = n.sources >= n.targets ? e.source : e.target;
      if (Math.max(n.sources, n.targets) > LIMITS.flowPerColumn) {
        return no(`"${worst.name}" would stand ${Math.max(n.sources, n.targets)} nodes in one column — ` +
          `past about ${LIMITS.flowPerColumn} their labels overlap and the last one is clipped, so the flow ` +
          `cannot be read; a treemap or a ranked bar shows this many parts`);
      }
      return yes(`"${e.source.name}" to "${e.target.name}", weighted by "${e.value.name}"`,
        { source: e.source.name, target: e.target.name, value: e.value.name });
    },
  },
  {
    slug: 'unc-stream', tier: 'Unconventional', title: 'Streamgraph', module: 'stream',
    build: 'swell', rest: 'timescan',
    gallery: 'The race for second place — frameworks minus React',
    answers: 'How did the composition shift over time?',
    data: 'A date, a category, and a value — several series stacked into a flowing band.',
    honesty: 'Only the total and each band THICKNESS are readable; a band\'s position carries nothing.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date column for the stream to flow along');
      const c = cats(p, 2, 14)[0];
      if (!c) return no('needs a category column with 2 to 14 values to stack');
      const v = quants(p, [x.name])[0];
      if (!v) return no('needs a numeric column to give each band its thickness');
      return yes(`"${c.name}" stacked over "${x.name}" by "${v.name}"`, { x: x.name, series: c.name, y: v.name });
    },
  },
  {
    slug: 'unc-nightingale', tier: 'Unconventional', title: 'Nightingale rose', module: 'nightingale',
    build: 'petal', rest: 'wavebreathe',
    gallery: 'The second wave of ChatGPT curiosity',
    answers: 'How does a cycle vary through its turn?',
    data: 'A CYCLICAL category — months, hours, weekdays — and one number per step.',
    honesty: 'Radius is the square root of the value, because a petal\'s AREA is what the eye reads.',
    fit(p) {
      const c = cats(p, 4, 31)[0];
      if (!c) return no('needs a cyclical category — months, weekdays, hours — with 4 to 31 steps');
      const cyc = /month|hour|day|weekday|quarter|season|week/i.test(c.name);
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column for each petal');
      return cyc
        ? yes(`"${c.name}" is cyclical and "${v.name}" gives each petal its area`, { angle: c.name, value: v.name })
        : no(`"${c.name}" is not a cycle. A rose implies the last step joins the first, which would be a false claim about this data — use a ranked bar`);
    },
  },
  {
    slug: 'unc-calendar', tier: 'Unconventional', title: 'Calendar heatmap', module: 'calendar',
    build: 'wave', rest: 'wavebreathe',
    gallery: 'Three years of ChatGPT, one cell per day',
    answers: 'What does the daily rhythm look like across years?',
    data: 'A DAILY date column and one number per day. Spans of a year or more.',
    honesty: 'Colour is a sequential ramp; a cell says only which band its day fell in.',
    fit(p) {
      const t = temporal(p);
      if (!t) return no('needs a real date column, one row per day');
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column to colour each day');
      if (nRows(p) < 60) return no(`needs a long daily run to be worth a calendar (found ${nRows(p)} rows)`);
      return yes(`one cell per day of "${t.name}", coloured by "${v.name}"`, { date: t.name, value: v.name });
    },
  },
  {
    slug: 'unc-punchcard', tier: 'Unconventional', title: 'Punchcard', module: 'punchcard',
    build: 'wave', rest: 'wavebreathe',
    gallery: 'One project clocks in; the other never sleeps',
    answers: 'When in the week does this happen?',
    data: 'TWO cyclical categories crossed — weekday against hour — and a count for each cell.',
    honesty: 'Dot area is the count, so it uses the square root of the value.',
    fit(p) {
      const c = cats(p, 3, 31);
      if (c.length < 2) return no('needs two cyclical categories to cross, like weekday against hour');
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column to size each dot');
      // THEY HAVE TO ACTUALLY CROSS. Two categories where each value of one
      // belongs to exactly one value of the other (a category and its line
      // items) fill a diagonal, not a grid — the picture is a staircase and
      // every empty cell is a structural impossibility rather than a finding.
      const pairs = new Set(rowsOf(p).map((r) => `${r[c[0].name]}\u0000${r[c[1].name]}`)).size;
      const widest = Math.max(distinct(c[0]), distinct(c[1]));
      if (pairs < widest * 1.5) {
        return no(`"${c[0].name}" and "${c[1].name}" do not really cross — only ${pairs} combinations occur, `
          + 'so the grid would be a diagonal. A punchcard needs two independent cycles, like weekday against hour');
      }
      return yes(`"${c[0].name}" crossed with "${c[1].name}", sized by "${v.name}"`,
        { row: c[0].name, col: c[1].name, value: v.name });
    },
  },
  {
    slug: 'unc-marimekko', tier: 'Unconventional', title: 'Marimekko', module: 'marimekko',
    build: 'grow', rest: 'peak',
    gallery: 'The cloud market grew seven-fold',
    answers: 'How is a total split two ways at once?',
    data: 'Two categories and a value — column WIDTH is one share, segment HEIGHT is the other.',
    honesty: 'Both axes are percentages, so every rectangle\'s area is a real share of the whole.',
    fit(p) {
      const c = cats(p, 2, 12);
      if (c.length < 2) {
        const wide = cats(p, 13)[0];
        return no(wide
          ? `needs two category columns of at most 12 values each so the columns stay readable — "${wide.name}" `
            + `has ${distinct(wide)}`
          : 'needs two category columns — one for column width, one for the split inside');
      }
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column to give the rectangles their area');
      return yes(`"${c[0].name}" widths split by "${c[1].name}", areas from "${v.name}"`,
        { parent: c[0].name, child: c[1].name, value: v.name });
    },
  },
  {
    slug: 'unc-strip', tier: 'Unconventional', title: 'Dot strip', module: 'strip',
    build: 'rain', rest: 'peak',
    gallery: 'Ship cadence — every stable release of six frameworks',
    answers: 'When did each event happen?',
    data: 'A date and a category — one row of dots per category, one dot per event. No aggregation.',
    honesty: 'Every record is a mark. Overlapping dots are overlapping events, not a bigger one.',
    fit(p) {
      const t = temporal(p);
      if (!t) return no('needs a real date column — every event gets its own dot');
      const c = cats(p, 2, 20)[0];
      if (!c) return no('needs a category column to give each strip its row');
      const v = quants(p)[0];
      return yes(`every "${t.name}" plotted on a row per "${c.name}"`,
        { x: t.name, series: c.name, y: v ? v.name : undefined });
    },
  },
  {
    slug: 'unc-raincloud', tier: 'Unconventional', title: 'Raincloud', module: 'box-whisker',
    build: 'rain', rest: 'peak',
    gallery: 'The tempo of shipping software',
    answers: 'What is the shape of this distribution?',
    data: 'A category and a number, with MANY rows per category — the density, the box, and every raw value together.',
    honesty: 'Sideways jitter is spacing only; horizontal position carries no value.',
    fit(p) {
      const c = cats(p, 2, 12)[0];
      if (!c) return no('needs a category column to group the values by');
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column to describe the spread of');
      const per = nRows(p) / Math.max(1, distinct(c));
      if (per < 4) return no(`only about ${per.toFixed(0)} values per group — a distribution needs several per category`);
      return yes(`"${v.name}" spread within each "${c.name}", about ${per.toFixed(0)} values each`,
        { category: c.name, value: v.name }, 'strong',
        // A RAINCLOUD: density above, the raw sample raining below, NO box — the curve is the claim and a box over it summarises the same numbers twice.
        { box: false });
    },
  },
  {
    slug: 'unc-boxviolin', tier: 'Unconventional', title: 'Box and violin', module: 'box-whisker',
    build: 'rain', rest: 'peak',
    gallery: 'Every extra zero adds a quarter to the clock',
    answers: 'Do these groups actually differ, or do they overlap?',
    data: 'A category and a number, several values per category. Shows quartiles, whiskers and outliers.',
    honesty: 'The box is quartiles and the whiskers are the 1.5×IQR convention, not a property of your data.',
    fit(p) {
      const c = cats(p, 2, 12)[0];
      if (!c) return no('needs a category column to compare groups');
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column to summarise');
      const per = nRows(p) / Math.max(1, distinct(c));
      if (per < 4) return no(`only about ${per.toFixed(0)} values per group — quartiles need more than that to mean anything`);
      return yes(`quartiles of "${v.name}" for each "${c.name}"`, { category: c.name, value: v.name }, 'strong',
        // A VIOLIN: the quartile box laid over the density curve.
        { box: true });
    },
  },
  {
    slug: 'unc-parallel', tier: 'Unconventional', title: 'Parallel measures', module: 'parallel',
    build: 'trace', rest: 'walk',
    gallery: 'Four numbers tell most of a SaaS story',
    answers: 'Where is the trade-off?',
    data: 'One row per entity and SEVERAL numeric columns — each becomes an axis, each row a thread.',
    honesty: 'Every axis is scaled to its own range, so heights compare within an axis and never between them.',
    fit(p) {
      const q = quants(p);
      if (q.length < 3) return no(`needs at least 3 numeric columns to thread between (found ${q.length})`);
      const id = cats(p, 2)[0];
      return yes(`${q.length} numeric columns as axes${id ? `, one thread per "${id.name}"` : ''}`,
        { measures: q.slice(0, 8).map((f) => f.name), id: id ? id.name : undefined });
    },
  },
  {
    slug: 'unc-circlepack', tier: 'Unconventional', title: 'Circle packing', module: 'circlepack',
    build: 'tiles', rest: 'wavebreathe',
    gallery: 'The public SaaS universe, packed',
    answers: 'How do the parts nest inside the whole?',
    data: 'A HIERARCHY: a group column, an item column, and a size for each item.',
    honesty: 'Circle AREA is the value, so the radius is a square root. Never read the radius.',
    fit(p) {
      const h = hierarchy(p);
      if (!h) return no('needs two category columns — a group and the items inside it');
      if (!h.size) return no(`found "${h.parent.name}" grouping "${h.child.name}", but no numeric column to size the circles`);
      return yes(`"${h.child.name}" packed inside "${h.parent.name}", sized by "${h.size.name}"`,
        { parent: h.parent.name, child: h.child.name, value: h.size.name });
    },
  },
  {
    slug: 'unc-sunburst', tier: 'Unconventional', title: 'Sunburst', module: 'sunburst',
    build: 'ring', rest: 'walk',
    gallery: 'What the flagships are made of',
    answers: 'What is the composition, level by level?',
    data: 'A HIERARCHY of two or more levels plus a size. Rings read outward from the centre.',
    honesty: 'Angle is the share. A ring only partitions if every child is present.',
    fit(p) {
      const h = hierarchy(p);
      if (!h) return no('needs at least two nested category columns to make the rings');
      if (!h.size) return no(`"${h.parent.name}" and "${h.child.name}" can nest, but there is no numeric column to give the wedges their angle`);
      return yes(`"${h.parent.name}" then "${h.child.name}", angles from "${h.size.name}"`,
        { levels: [h.parent.name, h.child.name], value: h.size.name });
    },
  },
  {
    slug: 'unc-treemap', tier: 'Unconventional', title: 'Treemap', module: 'treemap',
    build: 'tiles', rest: 'peak',
    gallery: "Where the CIO's $101 million goes",
    answers: 'What takes up the most room?',
    data: 'A HIERARCHY plus a size. Best when a few items dominate a long tail.',
    honesty: 'Rectangle AREA is the value; the aspect ratio of a tile carries nothing.',
    fit(p) {
      const h = hierarchy(p);
      if (!h) return no('needs a group column and an item column to tile');
      if (!h.size) return no('needs a numeric column to give each tile its area');
      return yes(`"${h.child.name}" tiled inside "${h.parent.name}", areas from "${h.size.name}"`,
        { parent: h.parent.name, child: h.child.name, value: h.size.name });
    },
  },
  {
    slug: 'unc-chord', tier: 'Unconventional', title: 'Chord', module: 'chord',
    build: 'ring', rest: 'wavebreathe',
    gallery: 'Languages that live together',
    answers: 'What goes with what?',
    data: 'EDGES between members of ONE set — a pair of category columns drawn from the same vocabulary, plus a strength.',
    honesty: 'Ribbon width is the pair strength. The ring order is arbitrary and means nothing.',
    fit(p) {
      const e = edgePair(p);
      if (!e) return no('needs two category columns naming the two ends of each relationship');
      if (!e.value) return no('needs a numeric column for how strong each bond is');
      const n = edgeScale(p, e);
      if (n.members > LIMITS.chordMembers) {
        return no(`"${e.source.name}" and "${e.target.name}" hold ${n.members} members between them — ` +
          `a ring past about ${LIMITS.chordMembers} draws more ribbons than it can separate, and the ` +
          `order around the circle carries nothing to help; a heatmap keeps every pair readable`);
      }
      return yes(`bonds between "${e.source.name}" and "${e.target.name}", weighted by "${e.value.name}"`,
        { source: e.source.name, target: e.target.name, value: e.value.name });
    },
  },
  {
    slug: 'unc-horizon', tier: 'Unconventional', title: 'Horizon', module: 'horizon',
    build: 'rise', rest: 'timescan',
    gallery: 'Every Christmas, the registry holds its breath',
    answers: 'How do many series move, in very little vertical space?',
    data: 'A date, a value, and a category — dense series folded into colour bands so dozens fit on one screen.',
    honesty: 'Each fold is a fixed band of value; colour depth is the band count, not a separate measure.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date column');
      const v = quants(p, [x.name])[0];
      if (!v) return no('needs a numeric column to fold');
      const c = cats(p, 3, 40)[0];
      if (!c) return no('needs a category column with at least 3 series — one series does not need a horizon');
      return yes(`"${c.name}" series of "${v.name}" folded over "${x.name}"`, { x: x.name, y: v.name, series: c.name });
    },
  },
  {
    slug: 'unc-hexbin', tier: 'Unconventional', title: 'Hexbin', module: 'hexbin',
    build: 'wave', rest: 'wavebreathe',
    gallery: 'Nobody ships on Sunday',
    answers: 'Where do the points pile up?',
    data: 'TWO numeric columns and a lot of rows — overplotting becomes density instead of a black mass.',
    honesty: 'Bin size is a choice that changes the picture, so it is stated on the piece.',
    fit(p) {
      const q = quants(p);
      if (q.length < 2) return no(`needs two numeric columns for the two axes (found ${q.length})`);
      if (nRows(p) < 150) return no(`only ${nRows(p)} rows — below roughly 150 a plain scatter reads better and hides nothing`);
      return yes(`density of "${q[0].name}" against "${q[1].name}" over ${nRows(p)} rows`,
        { x: q[0].name, y: q[1].name });
    },
  },
  {
    slug: 'unc-contour', tier: 'Unconventional', title: 'Contour', module: 'contour',
    build: 'emerge', rest: 'ripple',
    gallery: 'B2B software lives on two islands',
    answers: 'Where are the clusters?',
    data: 'TWO numeric columns and many rows — a smoothed density surface with islands and ridges.',
    honesty: 'The surface is an estimate with a chosen bandwidth, which is disclosed on the piece.',
    fit(p) {
      const q = quants(p);
      if (q.length < 2) return no(`needs two numeric columns (found ${q.length})`);
      if (nRows(p) < 120) return no(`only ${nRows(p)} rows — a density estimate needs more before its shape means anything`);
      return yes(`estimated density of "${q[0].name}" against "${q[1].name}"`, { x: q[0].name, y: q[1].name });
    },
  },
  {
    slug: 'unc-units', tier: 'Unconventional', title: 'Unit chart', module: 'units',
    build: 'count', rest: 'peak',
    gallery: 'What a deal costs — 82 tiles',
    answers: 'How many, exactly?',
    data: 'A small COUNT, optionally split by category. One tile per thing, countable by eye.',
    honesty: 'Every tile is one unit and all tiles are the same size. Scaling a glyph would be a lie.',
    fit(p) {
      const v = quants(p)[0];
      if (!v) return no('needs a numeric column of counts');
      const e = extent(p, v.name);
      if (e && e.sum > 600) return no(`about ${Math.round(e.sum)} units in total — past a few hundred tiles nobody counts, so a bar reads better`);
      const c = cats(p, 2, 8)[0];
      return yes(`one tile per unit of "${v.name}"${c ? `, grouped by "${c.name}"` : ''}`,
        { value: v.name, category: c ? c.name : undefined });
    },
  },

  // --------------------------------------------------------------- Experimental
  {
    slug: 'exp-arcs', tier: 'Experimental', title: 'Arc diagram', module: 'arcs',
    build: 'trace', rest: 'walk',
    gallery: '$592 billion of consolidation',
    answers: 'Who connected to whom, along one line?',
    data: 'EDGES: two category columns and a weight. Nodes sit on a single axis; arcs hop between them.',
    honesty: 'Arc height is the distance along the axis, not a value. Only thickness carries weight.',
    fit(p) {
      const e = edgePair(p);
      if (!e) return no('needs two category columns to connect');
      const n = edgeScale(p, e);
      if (n.members > LIMITS.arcMembers) {
        return no(`"${e.source.name}" and "${e.target.name}" hold ${n.members} names to line up — ` +
          `past about ${LIMITS.arcMembers} the axis truncates the very labels it is there to compare`);
      }
      return yes(`arcs from "${e.source.name}" to "${e.target.name}"${e.value ? `, weighted by "${e.value.name}"` : ''}`,
        { source: e.source.name, target: e.target.name, value: e.value ? e.value.name : undefined });
    },
  },
  {
    slug: 'exp-linked', tier: 'Experimental', title: 'Linked brush', module: 'linked',
    build: 'emerge', rest: 'peak',
    gallery: 'Brush the field, read the bars',
    answers: 'What is this subset made of?',
    data: 'Two numeric columns to brush across, plus a category whose bars recompute from whatever you select.',
    honesty: 'The bars always state the size of the current selection, so a small brush cannot read as the whole.',
    fit(p) {
      const q = quants(p);
      if (q.length < 2) return no(`needs two numeric columns to brush across (found ${q.length})`);
      const c = cats(p, 2, 14)[0];
      if (!c) return no('needs a category column for the linked bars to break the selection down by');
      return yes(`brush "${q[0].name}" against "${q[1].name}", bars break down by "${c.name}"`,
        { x: q[0].name, y: q[1].name, series: c.name });
    },
  },

  // ---------------------------------------------------------------- Interactive
  {
    slug: 'int-sankey', tier: 'Interactive', title: 'Sankey, interrogable', module: 'sankey',
    build: 'sankey', rest: 'attract',
    gallery: 'Ten thousand leads, every path answerable',
    answers: 'Where did volume go, and what happened to any one path?',
    data: 'The same edges a Sankey needs, plus the reader picking a node to isolate its paths.',
    honesty: 'Isolating a path restates its share of the total rather than rescaling it to fill the frame.',
    fit(p) {
      const e = edgePair(p);
      if (!e || !e.value) return no('needs a source column, a target column and a volume');
      // Being interrogable does not rescue an unreadable column: you have to be
      // able to SEE a band before you can think to click it.
      const n = edgeScale(p, e);
      if (Math.max(n.sources, n.targets) > LIMITS.flowPerColumn) {
        return no(`${Math.max(n.sources, n.targets)} nodes would stack in one column — past about ` +
          `${LIMITS.flowPerColumn} the labels overlap, and a band you cannot see is a band you cannot click`);
      }
      return yes(`"${e.source.name}" to "${e.target.name}" by "${e.value.name}", every path clickable`,
        { source: e.source.name, target: e.target.name, value: e.value.name }, 'strong', { isolate: true });
    },
  },
  {
    slug: 'int-chord', tier: 'Interactive', title: 'Chord, untangled', module: 'chord',
    build: 'ring', rest: 'attract',
    gallery: 'Untangle the bonds one language at a time',
    answers: 'What does this one thing connect to?',
    data: 'Pair edges with a strength. Clicking a member drops every ribbon that is not its own.',
    honesty: 'The ring order is arbitrary; isolation is the only reliable way to read one member.',
    fit(p) {
      const e = edgePair(p);
      if (!e || !e.value) return no('needs two category columns and a bond strength');
      const n = edgeScale(p, e);
      if (n.members > LIMITS.chordMembers) {
        return no(`${n.members} members would go on the ring — past about ${LIMITS.chordMembers} there are ` +
          `more ribbons than it can separate, and isolating one at a time does not make the whole readable`);
      }
      return yes(`bonds between "${e.source.name}" and "${e.target.name}", isolate any one`,
        { source: e.source.name, target: e.target.name, value: e.value.name }, 'strong', { isolate: true });
    },
  },
  {
    slug: 'int-sunburst', tier: 'Interactive', title: 'Sunburst, zoomable', module: 'sunburst',
    build: 'ring', rest: 'attract',
    gallery: 'One language, twelve repos: light it up',
    answers: 'What is inside this branch?',
    data: 'A hierarchy and a size. Clicking a wedge makes it the new centre.',
    honesty: 'Zooming restates the branch total so a child is never read as a share of the whole.',
    fit(p) {
      const h = hierarchy(p);
      if (!h || !h.size) return no('needs two nested category columns and a numeric size');
      return yes(`"${h.parent.name}" then "${h.child.name}", any branch zoomable`,
        { levels: [h.parent.name, h.child.name], value: h.size.name }, 'strong', { zoom: true });
    },
  },
  {
    slug: 'int-treemap', tier: 'Interactive', title: 'Treemap, drillable', module: 'treemap',
    build: 'tiles', rest: 'attract',
    gallery: "Interrogate the CIO's hundred million",
    answers: 'What is this block actually made of?',
    data: 'A hierarchy and a size. Clicking a tile descends a level.',
    honesty: 'Each level restates its own total, so a drilled tile is never mistaken for the whole.',
    fit(p) {
      const h = hierarchy(p);
      if (!h || !h.size) return no('needs a group column, an item column and a numeric size');
      return yes(`drill from "${h.parent.name}" into "${h.child.name}" by "${h.size.name}"`,
        { parent: h.parent.name, child: h.child.name, value: h.size.name }, 'strong', { drill: true });
    },
  },
  {
    slug: 'int-stream', tier: 'Interactive', title: 'Streamgraph, isolable', module: 'stream',
    build: 'swell', rest: 'attract',
    gallery: "Isolate one framework's decade",
    answers: 'What did this one series do inside the whole?',
    data: 'A date, a category and a value. Clicking a band pulls it out to a baseline of its own.',
    honesty: 'Isolating a band switches it to a real zero baseline, which the piece says out loud.',
    fit(p) {
      const x = ordered(p);
      if (!x) return no('needs a date column');
      const c = cats(p, 2, 14)[0];
      if (!c) return no('needs a category column to stack and isolate');
      const v = quants(p, [x.name])[0];
      if (!v) return no('needs a numeric column for band thickness');
      return yes(`"${c.name}" over "${x.name}", any band isolable`,
        { x: x.name, series: c.name, y: v.name }, 'strong', { isolate: true });
    },
  },
  {
    slug: 'int-network', tier: 'Interactive', title: 'Ego network', module: 'network',
    build: null, rest: 'attract',
    gallery: "Every tool's ego network, on demand",
    answers: 'What sits around this one node?',
    data: 'EDGES: two category columns and a weight. Picking a node shows only its own neighbourhood.',
    honesty: 'Node POSITION carries no value — a force layout is a readability device, not an encoding.',
    fit(p) {
      const e = edgePair(p);
      if (!e) return no('needs two category columns naming the two ends of each link');
      return yes(`neighbourhoods around "${e.source.name}" and "${e.target.name}"`,
        { source: e.source.name, target: e.target.name, value: e.value ? e.value.name : undefined });
    },
  },
];

/**
 * Splits the whole library against a profile.
 *
 * Every entry comes back either way — the point of the screen is that you can
 * see all 32 and understand the range, so a misfit is a CARD WITH A REASON,
 * never an omission.
 */
export function reviewLibrary(profile) {
  return GALLERY.map((piece) => {
    let verdict;
    try {
      verdict = piece.fit(profile);
    } catch (err) {
      verdict = no(`could not be evaluated against this data (${err.message})`);
    }
    return {
      slug: piece.slug,
      tier: piece.tier,
      title: piece.title,
      gallery: piece.gallery,
      answers: piece.answers,
      data: piece.data,
      honesty: piece.honesty,
      build: piece.build,
      rest: piece.rest,
      module: piece.module,
      portable: Boolean(piece.module),
      fits: verdict.ok,
      why: verdict.why,
      bindings: verdict.ok ? verdict.bindings : null,
      options: verdict.ok ? verdict.options || {} : {},
      confidence: verdict.ok ? verdict.confidence : null,
    };
  });
}

export function countsFor(reviewed) {
  return {
    total: reviewed.length,
    fits: reviewed.filter((r) => r.fits).length,
    live: reviewed.filter((r) => r.fits && r.portable).length,
  };
}
