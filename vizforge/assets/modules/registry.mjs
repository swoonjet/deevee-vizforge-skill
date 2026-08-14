// assets/modules/registry.mjs
//
// THE MODULE LIBRARY + THE APPROPRIATENESS FILTER.
//
// Given a profiled dataset (scripts/profile.mjs output: fields with inferred
// types, plus row count), this decides which modules FIT and — the part that
// matters — why each one that doesn't, doesn't.
//
// WHY IT STATES REASONS. The existing wizard's recommend.mjs already refuses
// dishonest techniques with a named alternative rather than silently dropping
// them, and every scaffold carries its honesty risks in the manifest. A filter
// that just showed fewer cards would lose that. So each verdict carries prose:
// "needs a date or ordered column; this data has none" beats an empty list.
//
// SEPARATE FROM skill/manifest/*.json ON PURPOSE (for now). Those 40 fragments
// drive the Playwright/gate/export pipeline for STATIC scaffolds and are
// asserted at exactly 40 by scaffold-gate-sweep. Modules render client-side
// and need no capture, so they carry their own lighter registry. Merging the
// two is a real follow-up, not a quiet default.

import { toNumber } from './vf-core.js';

export const TYPES = {
  QUANT: 'quantitative',
  TEMPORAL: 'temporal',
  NOMINAL: 'nominal',
  ORDINAL: 'ordinal',
};

/**
 * A module entry.
 *
 *   roles     — channel -> accepted profiled types + whether required
 *   fit(p)    — given a profile summary, return {ok, why, bindings?, confidence}
 *   honesty   — the constraint a reader must be told about, shown in the UI
 *               BEFORE they pick it, not buried in the export
 */
export const MODULES = [
  {
    slug: 'trend',
    title: 'Trend',
    blurb: 'One line per series over time. Hover for exact values at any point.',
    answers: 'How has this changed?',
    roles: {
      x: { types: [TYPES.TEMPORAL, TYPES.QUANT], required: true, label: 'Time or ordered value' },
      y: { types: [TYPES.QUANT], required: true, label: 'Value' },
      series: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: false, label: 'Series (one line each)' },
    },
    honesty: 'Position encoding, so a non-zero baseline is allowed — and is disclosed in the source line whenever it happens.',
    fit(p) {
      const temporalX = pick(p, [TYPES.TEMPORAL]);
      // A NUMERIC x only qualifies if it is genuinely SEQUENTIAL. Without this
      // guard the filter happily offered "trend" for a table of region / won /
      // prior, binding x=won and y=prior — two unrelated money columns drawn as
      // a time series. That is a meaningless chart presented as a finding,
      // exactly what the honesty rules exist to stop. A year column passes; a
      // revenue column does not.
      const sequentialX = temporalX ? null : pick(p, [TYPES.QUANT], [], looksSequential);

      const x = temporalX || sequentialX;
      if (!x) {
        const anyQuant = pick(p, [TYPES.QUANT]);
        return no(
          anyQuant
            ? `needs a date column, or a numeric column that is genuinely sequential like a year — "${anyQuant.name}" is a measured value, not an ordering`
            : 'needs a date or an ordered numeric column to run along the x-axis; this data has neither'
        );
      }
      const y = pick(p, [TYPES.QUANT], [x.name]);
      if (!y) {
        return no(
          temporalX
            ? 'needs a numeric column to plot against the date; found none'
            : `only one numeric column ("${x.name}") and no date column, so there is nothing to plot against it`
        );
      }
      if (p.rowCount < 2) return no(`needs at least 2 rows to draw a line (found ${p.rowCount})`);

      const series = pick(p, [TYPES.NOMINAL, TYPES.ORDINAL], [], (f) => f.distinct >= 2 && f.distinct <= 12);
      const temporal = x.type === TYPES.TEMPORAL;
      return yes(
        temporal
          ? `"${x.name}" is a date and "${y.name}" is numeric — the shape a trend is for`
          : `"${x.name}" is numeric and ordered, so it can carry a trend, though a real date column would read better`,
        { x: x.name, y: y.name, series: series ? series.name : undefined },
        temporal ? 'strong' : 'possible',
        { xType: temporal ? 'temporal' : 'quantitative' }
      );
    },
  },

  {
    slug: 'ranked-bar',
    title: 'Ranked bar',
    blurb: 'Categories sorted by value, largest first. Optional second value as a comparison rule.',
    answers: 'Which is biggest?',
    roles: {
      category: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: true, label: 'Category' },
      value: { types: [TYPES.QUANT], required: true, label: 'Value (bar length)' },
      compare: { types: [TYPES.QUANT], required: false, label: 'Compare against' },
    },
    honesty: 'Length encoding, so bars always start at zero. There is no option to truncate — a cut bar misstates the ratio and no footnote repairs it.',
    fit(p) {
      const category = pick(p, [TYPES.NOMINAL, TYPES.ORDINAL], [], (f) => f.distinct >= 2);
      if (!category) {
        return no('needs a category column with at least 2 distinct labels; this data has no usable categorical field');
      }
      const value = pick(p, [TYPES.QUANT]);
      if (!value) return no('needs a numeric column to set bar length; found none');
      if (category.distinct > 40) {
        return no(`"${category.name}" has ${category.distinct} distinct values — past the point where ranked bars stay readable`);
      }

      const compare = pick(p, [TYPES.QUANT], [value.name]);

      // Fewer categories than rows means the module will SUM repeats. That is
      // often what you want over transactional rows, but it is a real
      // transformation — say so here, and hold confidence back, rather than
      // letting the reader discover it in the source line afterwards.
      const aggregates = category.distinct < p.rowCount;
      const why = `"${category.name}" gives ${category.distinct} categories and "${value.name}" is numeric`
        + (compare ? `; "${compare.name}" can serve as the comparison` : '')
        + (aggregates ? `; ${p.rowCount} rows will be summed into those ${category.distinct} categories` : '');

      return yes(
        why,
        { category: category.name, value: value.name, compare: compare ? compare.name : undefined },
        category.distinct <= 12 && !aggregates ? 'strong' : 'possible'
      );
    },
  },

  {
    slug: 'radar',
    title: 'Radar',
    blurb: 'A named shape per entity across several measures. Hover a vertex for its value.',
    answers: 'What is each one shaped like?',
    roles: {
      series: { types: [TYPES.NOMINAL], required: true, label: 'Series (one shape each)' },
      axis: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: true, label: 'Measure (one spoke each)' },
      value: { types: [TYPES.QUANT], required: true, label: 'Value (reach along spoke)' },
    },
    honesty: 'Reach along each spoke is the encoding — never the enclosed area, which grows with the square of reach and changes with axis order. Stated on the piece.',
    fit(p) {
      // Radar wants LONG form: series, axis, value. Two categoricals plus a
      // number. Wide form (one column per measure) is a different reshape and
      // is refused rather than silently mis-bound.
      const cats = all(p, [TYPES.NOMINAL, TYPES.ORDINAL]).filter((f) => f.distinct >= 2);
      const value = pick(p, [TYPES.QUANT]);
      if (!value) return no('needs a numeric column for the spoke values; found none');
      if (cats.length < 2) {
        return no(
          cats.length === 1
            ? `needs two categorical columns — one naming the shapes, one naming the measures — and only found "${cats[0].name}"`
            : 'needs two categorical columns (one per shape, one per measure); this data has none'
        );
      }
      // The column with FEWER distinct values names the shapes; the other
      // names the spokes. Reversed is almost always wrong.
      const sorted = cats.slice().sort((a, b) => a.distinct - b.distinct);
      const series = sorted[0];
      const axis = sorted[1];
      if (axis.distinct < 3) {
        return no(`a radar needs at least 3 measures; "${axis.name}" has only ${axis.distinct}`);
      }
      if (axis.distinct > 12) {
        return no(`"${axis.name}" has ${axis.distinct} measures — past legibility for a radar`);
      }
      return yes(
        `"${series.name}" gives ${series.distinct} shapes across ${axis.distinct} measures from "${axis.name}"`,
        { series: series.name, axis: axis.name, value: value.name },
        series.distinct <= 5 ? 'strong' : 'possible'
      );
    },
  },

  {
    slug: 'parallel',
    title: 'Parallel measures',
    blurb: 'One line per row, threaded across every numeric column. Drag an axis to keep a range.',
    answers: 'How do these measures trade off?',
    roles: {
      measures: { types: [TYPES.QUANT], required: true, multiple: true, label: 'Measures (one axis each)' },
      id: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: false, label: 'Row label' },
      group: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: false, label: 'Group (one colour each)' },
    },
    honesty: 'Each axis is scaled to its own min–max, so a height compares rows within an axis and never between axes — every axis prints its own range. Axis order follows your columns: it changes which crossings you can see, not which relationships exist.',
    fit(p) {
      // An identifier column is a name that happens to be numeric, not a
      // measure. Threading an axis through row ids draws a meaningless ramp.
      const quants = all(p, [TYPES.QUANT]).filter((f) => !f.identifier);
      if (quants.length < 2) {
        return no(
          quants.length === 1
            ? `needs at least two numeric columns to thread a line between — only "${quants[0].name}" is numeric, which is a ranked bar's job`
            : 'needs at least two numeric columns, one per axis; this data has none'
        );
      }
      if (p.rowCount < 2) return no(`needs at least 2 rows to compare (found ${p.rowCount})`);

      const cats = all(p, [TYPES.NOMINAL, TYPES.ORDINAL]);
      // A column with one distinct value per row NAMES the rows; anything
      // coarser groups them.
      const id = cats.find((f) => f.distinct === p.rowCount) || null;
      const group = cats.find((f) => f !== id && f.distinct >= 2 && f.distinct <= 8) || null;

      // More than eight axes stops being readable. Truncating is legitimate;
      // truncating SILENTLY is not, so the cap is part of the stated reason.
      const AXIS_CAP = 8;
      const chosen = quants.slice(0, AXIS_CAP);
      const capped = quants.length > AXIS_CAP;

      const rest = chosen.length - 2;
      const measurePhrase = capped
        ? `the first ${AXIS_CAP} of ${quants.length} numeric columns become axes (past ${AXIS_CAP} the lines stop being readable)`
        : rest > 0
          ? `${chosen.slice(0, 2).map((f) => `"${f.name}"`).join(', ')} and ${rest} more numeric ${rest === 1 ? 'column' : 'columns'} each become an axis`
          : `${chosen.map((f) => `"${f.name}"`).join(' and ')} become the two axes, so this reads as a slope between them`;

      const why = `${measurePhrase}; ${p.rowCount} rows draw ${p.rowCount} lines`
        + (group ? `, coloured by "${group.name}"` : '')
        + (id ? `, each named by "${id.name}"` : '');

      // Two axes is a slope, which is honest but is not what this form is for;
      // hundreds of lines overplot. Both are offered, neither is recommended.
      const confidence = chosen.length >= 3 && p.rowCount <= 800 ? 'strong' : 'possible';

      return yes(
        why,
        {
          measures: chosen.map((f) => f.name),
          id: id ? id.name : undefined,
          group: group ? group.name : undefined,
        },
        confidence
      );
    },
  },

  {
    slug: 'box-whisker',
    title: 'Distribution',
    blurb: 'A box per group with every raw value behind it. Hover a dot for one value, the box for its quartiles.',
    answers: 'How much do these groups overlap?',
    roles: {
      category: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: true, label: 'Group (one box each)' },
      value: { types: [TYPES.QUANT], required: true, label: 'Value (the distribution)' },
    },
    honesty: 'The box is quartiles and the whiskers are the 1.5×IQR convention, not a property of your data; values beyond are drawn individually rather than dropped. Dots are jittered sideways only so they stop overlapping — horizontal position carries nothing, and the piece says so.',
    fit(p) {
      const value = pick(p, [TYPES.QUANT], [], (f) => !f.identifier);
      if (!value) {
        return no(
          pick(p, [TYPES.QUANT])
            ? 'the only numeric column reads as a row identifier, not a measurement — a distribution of ids says nothing'
            : 'needs a numeric column to describe the spread of; this data has none'
        );
      }

      const cats = all(p, [TYPES.NOMINAL, TYPES.ORDINAL]).filter((f) => f.distinct >= 2);
      if (!cats.length) {
        return no('needs a categorical column to group by; this data has none with 2 or more distinct values');
      }

      // The GROUPING column is the coarsest one: a box needs several values
      // inside it. A column with one distinct value per row names the rows and
      // would draw one box per observation.
      const grouped = cats.slice().sort((a, b) => a.distinct - b.distinct);
      const category = grouped[0];

      if (category.distinct > 12) {
        return no(`"${category.name}" has ${category.distinct} groups — past legibility for side-by-side boxes`);
      }

      // fit() sees the profile, not the grouping, so this is the average — the
      // real per-group count is checked by the module's own validate(). Below
      // roughly three values a box is quartiles of almost nothing, which is
      // worth refusing rather than drawing with a caveat.
      const perGroup = p.rowCount / category.distinct;
      if (perGroup < 2.5) {
        return no(
          `${p.rowCount} rows across ${category.distinct} groups is about ${perGroup.toFixed(1)} values each — `
          + 'too few for quartiles; a ranked bar compares single values honestly'
        );
      }

      return yes(
        `"${category.name}" gives ${category.distinct} groups, about ${Math.round(perGroup)} values of "${value.name}" each`,
        { category: category.name, value: value.name },
        perGroup >= 6 ? 'strong' : 'possible'
      );
    },
  },

  {
    slug: 'data-cube',
    title: 'Data cube',
    blurb: 'Three measures at once in a cube you turn. Snap to a face to read any two as a flat scatter.',
    answers: 'Does anything achieve all three?',
    roles: {
      x: { types: [TYPES.QUANT], required: true, label: 'First measure' },
      y: { types: [TYPES.QUANT], required: true, label: 'Second measure' },
      z: { types: [TYPES.QUANT], required: true, label: 'Third measure' },
      label: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: false, label: 'Point label' },
      group: { types: [TYPES.NOMINAL, TYPES.ORDINAL], required: false, label: 'Group (one colour each)' },
    },
    honesty: 'The one honest 3-D, and only because both of the reasons 3-D lies are removed: the projection is ORTHOGRAPHIC, so a dot at the back is drawn at exactly the same scale as one at the front, and YOU turn it, so nothing stays hidden behind anything else. Snapping to a face collapses the third measure and leaves a true flat scatter of the other two. Nearer dots are drawn slightly larger purely as a depth cue — size carries no value.',
    fit(p) {
      // Identifier columns are names that happen to be numeric; an axis through
      // row ids places every point on a diagonal that means nothing.
      const quants = all(p, [TYPES.QUANT]).filter((f) => !f.identifier);
      if (quants.length < 3) {
        return no(
          quants.length
            ? `needs three numeric columns to place a point in space; this data has ${quants.length}`
            : 'needs three numeric columns; this data has none that are measurements'
        );
      }
      if (p.rowCount < 3) return no(`needs at least 3 rows to make a cloud worth turning (found ${p.rowCount})`);

      const cats = all(p, [TYPES.NOMINAL, TYPES.ORDINAL]);
      const label = cats.find((f) => f.distinct === p.rowCount) || null;
      const group = cats.find((f) => f !== label && f.distinct >= 2 && f.distinct <= 8) || null;

      const [x, y, z] = quants;
      const extra = quants.length - 3;
      const why = `"${x.name}", "${y.name}" and "${z.name}" place each of ${p.rowCount} rows in the cube`
        + (extra > 0 ? `; ${extra} further numeric ${extra === 1 ? 'column is' : 'columns are'} not shown — rebind an axis to swap one in` : '')
        + (group ? `, coloured by "${group.name}"` : '')
        + (label ? `, each named by "${label.name}"` : '');

      // Deliberately never 'strong'. A rotatable cube is a genuine reading of
      // three measures, but a flat scatter or parallel measures answers most
      // questions with less work from the reader, and registry order puts this
      // last so an equally-ranked module keeps the default. Offered, honest,
      // never pushed.
      return yes(
        why,
        {
          x: x.name, y: y.name, z: z.name,
          label: label ? label.name : undefined,
          group: group ? group.name : undefined,
        },
        'possible'
      );
    },
  },
];

// --- verdict helpers -------------------------------------------------------
// (data-cube is registered last: see its fit() note on why it never takes a
// default away from parallel.)

function yes(why, bindings, confidence = 'strong', options = {}) {
  return { ok: true, why, bindings, confidence, options };
}

function no(why) {
  return { ok: false, why };
}

function all(profile, types) {
  return (profile.fields || []).filter((f) => types.includes(f.type));
}

/**
 * Does a numeric field read as an ORDERING rather than a measurement?
 *
 * The signal is integer-valued, near-unique, and either in a plausible
 * year/period range or starting from a small index. A year (2019, 2020, 2021),
 * a quarter index or a row sequence passes; revenue, scores and populations do
 * not. Deliberately conservative: a false negative just means the module is
 * offered as a scatter-ish "possible" elsewhere, while a false positive draws a
 * fake time series.
 */
function looksSequential(f) {
  if (!f || f.type !== TYPES.QUANT) return false;
  if (!f.integerLike) return false;
  // Near-unique: an ordering visits each step about once.
  if (f.distinct < 3) return false;
  const yearish = f.min >= 1500 && f.max <= 2400;
  const indexish = f.min >= 0 && f.min <= 1 && f.max <= 10000;
  return Boolean(yearish || indexish);
}

/**
 * First field matching `types`, excluding names in `exclude`, optionally
 * passing `test`. Prefers the field with the most distinct values for
 * quantitative roles (a constant column makes a useless axis).
 */
function pick(profile, types, exclude = [], test = null) {
  const candidates = (profile.fields || [])
    .filter((f) => types.includes(f.type))
    .filter((f) => !exclude.includes(f.name))
    .filter((f) => (test ? test(f) : true));
  if (!candidates.length) return null;
  if (types.includes(TYPES.QUANT)) {
    return candidates.slice().sort((a, b) => (b.distinct || 0) - (a.distinct || 0))[0];
  }
  return candidates[0];
}

/**
 * Runs every module against a profile.
 *
 * @param {{fields:Array<{name,type,distinct}>, rowCount:number}} profile
 * @returns {{fits:Array, misfits:Array}} both ordered, both with prose
 */
export function filterModules(profile) {
  const fits = [];
  const misfits = [];

  for (const mod of MODULES) {
    let verdict;
    try {
      verdict = mod.fit(profile);
    } catch (err) {
      verdict = no(`could not be evaluated against this data (${err.message})`);
    }

    const entry = {
      slug: mod.slug,
      title: mod.title,
      blurb: mod.blurb,
      answers: mod.answers,
      honesty: mod.honesty,
      why: verdict.why,
    };

    if (verdict.ok) {
      fits.push({
        ...entry,
        bindings: verdict.bindings,
        options: verdict.options || {},
        confidence: verdict.confidence,
      });
    } else {
      misfits.push(entry);
    }
  }

  // Strong fits first; otherwise stable registry order so the list never
  // reshuffles between identical uploads.
  const rank = { strong: 0, possible: 1 };
  fits.sort((a, b) => (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9));

  return { fits, misfits };
}

/**
 * BEST-EFFORT BINDINGS for a module the filter did NOT choose.
 *
 * The filter's job is to say what suits the data; picking a technique anyway is
 * the reader's prerogative — they may know something the profiler cannot see, or
 * simply want to look. But a refused module has no bindings, because fit()
 * returned before computing any. This assigns each role the first unused column
 * of an acceptable type, in role order, and REPORTS the roles it could not fill
 * rather than binding something of the wrong type to make the chart appear.
 *
 * Deliberately dumber than fit(): no business rules, no confidence, no
 * aggregation warnings. It exists to give a manual pick a sane starting point,
 * which the reader then edits.
 */
export function resolveBindings(mod, profile) {
  const fields = profile.fields || [];
  const used = new Set();
  const bindings = {};
  const missing = [];

  for (const [role, spec] of Object.entries(mod.roles || {})) {
    const candidates = fields.filter((f) => spec.types.includes(f.type) && !used.has(f.name));
    if (spec.multiple) {
      if (candidates.length) {
        bindings[role] = candidates.map((f) => f.name);
        for (const f of candidates) used.add(f.name);
      } else if (spec.required) {
        missing.push(role);
      }
      continue;
    }
    if (candidates.length) {
      bindings[role] = candidates[0].name;
      used.add(candidates[0].name);
    } else if (spec.required) {
      missing.push(role);
    }
  }

  return { bindings, missing };
}

/**
 * THE WHOLE LIBRARY against one profile — what fits, what doesn't, and enough
 * for the screen to let someone preview any of it.
 *
 * The filter still leads: `status` carries strong / possible / refused and the
 * prose reason is unchanged, so choosing a refused technique is a visible
 * override rather than an equally-weighted option. Nothing here relaxes a
 * verdict; it only makes the refused ones reachable.
 */
export function libraryFor(profile) {
  const { fits, misfits } = filterModules(profile);
  const byFit = new Map(fits.map((f) => [f.slug, f]));
  const byMisfit = new Map(misfits.map((m) => [m.slug, m]));

  return MODULES.map((mod) => {
    const fit = byFit.get(mod.slug);
    const roles = Object.fromEntries(
      Object.entries(mod.roles || {}).map(([role, spec]) => [role, {
        label: spec.label,
        types: spec.types,
        required: Boolean(spec.required),
        multiple: Boolean(spec.multiple),
      }])
    );

    if (fit) {
      return {
        ...fit,
        roles,
        status: fit.confidence === 'strong' ? 'strong' : 'possible',
        missing: [],
      };
    }

    const refused = byMisfit.get(mod.slug) || { why: 'not evaluated' };
    const { bindings, missing } = resolveBindings(mod, profile);
    return {
      slug: mod.slug,
      title: mod.title,
      blurb: mod.blurb,
      answers: mod.answers,
      honesty: mod.honesty,
      why: refused.why,
      roles,
      status: 'refused',
      bindings,
      options: {},
      missing,
    };
  });
}

/**
 * Condenses a scripts/profile.mjs result into what the filter needs. Keeping
 * this narrow means the filter cannot accidentally depend on the profiler's
 * full shape and drift when that changes.
 */
export function summarize(profiled) {
  const rows = profiled.rows || [];

  const fields = (profiled.fields || []).map((f) => {
    // The profiler names this `cardinality`; the filter reads `distinct`.
    // Fall back to counting only when the profiler did not supply it.
    const distinct = f.cardinality !== undefined
      ? f.cardinality
      : new Set(rows.map((r) => r[f.name])).size;

    const out = { name: f.name, type: f.type, distinct, identifier: Boolean(f.identifier) };

    // min/max/integerLike are not part of the profiler's contract, so they are
    // derived here — looksSequential() needs them to tell a year column from a
    // revenue column.
    if (f.type === TYPES.QUANT) {
      let min = Infinity;
      let max = -Infinity;
      let allInts = true;
      let n = 0;
      for (const row of rows) {
        // toNumber, not Number: a blank cell would otherwise count as a real 0
        // and drag `min` down, which is exactly the signal looksSequential()
        // reads to tell a year column from a measurement.
        const v = toNumber(row[f.name]);
        if (!Number.isFinite(v)) continue;
        n += 1;
        if (v < min) min = v;
        if (v > max) max = v;
        if (!Number.isInteger(v)) allInts = false;
      }
      if (n > 0) {
        out.min = min;
        out.max = max;
        out.integerLike = allInts;
      }
    }

    return out;
  });

  return { fields, rowCount: rows.length };
}
