// scripts/shapers/ambient-sculpture.mjs
//
// BIND-01/02/04/05 (Phase 7 Plan 13) -- ambient-sculpture's `series` shaper.
// This technique needs a real, ordered time series carrying up to three
// independently-meaningful quantitative channels (`radius`/`jitter`/`hue` --
// the exact role names skill/manifest/ambient-sculpture.json's existing
// `mapping[]` block already targets, per 07-RESEARCH.md's shape vocabulary:
// "dataBinding.roles for tier-3 techniques should reuse the SAME role names
// the existing mapping array already names").
//
// The demo binds scripts/tests/fixtures/binding/rtsw_ambient_merged.csv (see
// that file's own header comment): the shipped scaffold's OWN runtime join
// of data/rtsw_wind_1m.json (plasma) + data/rtsw_mag_1m.json (magnetic
// field) by time_tag -- pre-computed ONCE into a flat fixture so a general
// single-dataset `series` dataBinding can bind it (bind-data.mjs only ever
// profiles ONE file per demoBinding).

function isFiniteNumberString(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function coerceNum(raw) {
  if (!isFiniteNumberString(raw)) return null;
  return Number(String(raw).trim());
}

// Mirrors horizon.mjs/radial-cyclical.mjs's own coerceX (duplicated per the
// shaper contract's self-contained-file convention) -- numeric-looking
// values coerce directly; everything else goes through Date.parse.
function coerceTime(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isFiniteNumberString(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * normalizedRows(rows, bindings) -> Array<{time,timeRaw,radius,jitter,hue}>
 * A row is kept only when BOTH `time` and `radius` coerce to real values --
 * these two channels are structurally required to place a point at all
 * (angular position + radial extent). `jitter`/`hue` are optional per-role
 * (dataBinding.roles) -- when bound but a given row's value doesn't coerce,
 * that row's jitter/hue is `null` (a graceful per-point degradation, not a
 * dropped row), letting the scaffold fall back to zero displacement / a
 * neutral hue for that point only. Sorted ascending by time -- the general
 * contract never assumes input is pre-sorted, even though this project's
 * own demo fixture already is.
 */
function normalizedRows(rows, bindings) {
  const timeCol = bindings.time;
  const radiusCol = bindings.radius;
  const jitterCol = bindings.jitter;
  const hueCol = bindings.hue;

  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const time = coerceTime(row[timeCol]);
    if (!Number.isFinite(time)) continue;
    const radius = coerceNum(row[radiusCol]);
    if (radius === null) continue;

    out.push({
      time,
      timeRaw: String(row[timeCol]).trim(),
      radius,
      jitter: jitterCol ? coerceNum(row[jitterCol]) : null,
      hue: hueCol ? coerceNum(row[hueCol]) : null,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : { min: null, max: null };
}

/**
 * shape(rows, bindings) -> { series: [{time,radius,jitter,hue}], stats:
 * {rowCount,timeStart,timeEnd,radiusMin,radiusMax,jitterMin,jitterMax,
 * hueMin,hueMax,peakRadius,peakTime} }
 *
 * `series` carries the RAW (unnormalized) bound values in chronological
 * order -- normalizing radius/jitter to [0,1], quantizing hue to the house
 * diverging ramp's discrete stops, and drawing the seeded per-vertex jitter
 * displacement all stay in the scaffold (DOM/CSS ramp tokens + this
 * project's seeded-RNG conventions aren't available to a pure Node shaper).
 * `time` in the output is the ORIGINAL bound string (never the coerced
 * numeric sort key) so the scaffold's own formatting/attribution logic
 * keeps working on real timestamp text.
 */
export function shape(rows, bindings) {
  const points = normalizedRows(rows, bindings);

  const series = points.map((p) => ({
    time: p.timeRaw,
    radius: p.radius,
    jitter: p.jitter,
    hue: p.hue,
  }));

  const radiusRange = minMax(points.map((p) => p.radius));
  const jitterRange = minMax(points.map((p) => p.jitter));
  const hueRange = minMax(points.map((p) => p.hue));

  let peak = points.length > 0 ? points[0] : null;
  for (const p of points) {
    if (p.radius > peak.radius) peak = p;
  }

  const stats = {
    rowCount: points.length,
    timeStart: points.length > 0 ? points[0].timeRaw : null,
    timeEnd: points.length > 0 ? points[points.length - 1].timeRaw : null,
    radiusMin: radiusRange.min,
    radiusMax: radiusRange.max,
    jitterMin: jitterRange.min,
    jitterMax: jitterRange.max,
    hueMin: hueRange.min,
    hueMax: hueRange.max,
    peakRadius: peak ? peak.radius : null,
    peakTime: peak ? peak.timeRaw : null,
  };

  return { series, stats };
}

// A real time series (not a single snapshot) needs meaningfully more than a
// handful of ordered points to read as a genuine ambient sculpture -- this
// project's own conservative floor (mirrors radial-cyclical's own "at least
// N distinct positions to read as a genuine X" convention, scaled up for
// this technique's much denser intended point count).
const MIN_SERIES_POINTS = 20;

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than MIN_SERIES_POINTS usable (time,radius) rows -> named error
 *   ("not a single snapshot").
 * - every usable row shares the exact same timestamp -> named error (a
 *   single repeated snapshot is not a time series either, even if it has
 *   many rows).
 */
export function validate(rows, bindings) {
  const errors = [];
  const points = normalizedRows(rows, bindings);

  if (points.length < MIN_SERIES_POINTS) {
    errors.push({
      channel: 'time',
      problem: `channel 'time': only ${points.length} usable row(s) with both a real time and radius value -- ambient-sculpture needs a genuine time series (at least ${MIN_SERIES_POINTS} ordered points), not a single snapshot`,
      remedy: `bind 'time'/'radius' to a dataset with at least ${MIN_SERIES_POINTS} timestamped rows`,
    });
    return errors;
  }

  const distinctTimes = new Set(points.map((p) => p.time)).size;
  if (distinctTimes < 2) {
    errors.push({
      channel: 'time',
      problem: "channel 'time': every bound row shares the exact same timestamp -- this is a single snapshot, not a time series",
      remedy: "bind 'time' to a column with genuinely distinct timestamps across the window",
    });
  }

  return errors;
}
