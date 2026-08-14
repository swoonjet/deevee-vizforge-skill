// scripts/shapers/streamgraph.mjs
//
// BIND-01/02/04 (Phase 7 Plan 12) -- streamgraph's shaper. UNLIKE every prior
// technique in this phase, streamgraph's dataBinding declares a MULTI-COLUMN
// `layers` role (07-RESEARCH.md Pitfall 5): each bound column becomes ONE
// independently-meaningful stacked band, so `bindings.layers` is an ARRAY of
// column names, not a single value. The scaffold's d3.stack().keys() reads
// this shaper's own `keys` output (the bound column names, in bound order)
// -- never a scaffold-side literal KEYS array.
//
// ONE shaper drives BOTH scaffolds/streamgraph.html and
// scaffolds/streamgraph-animated.html -- identical shape() output, consumed
// via regenerateFromDemoBinding's srcPath override (mirrors bump.mjs's own
// shared-shaper precedent, Phase 7 Plan 08).

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Coerces a bound x value to a plottable number -- handles both a plain
// quantitative number and a genuine temporal value (mirrors
// scripts/shapers/bump.mjs's own coerceX, duplicated here per the shaper
// contract's self-contained-file convention).
function coerceX(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  if (isCoercibleNumber(v)) return Number(v);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function layerColumns(bindings) {
  const raw = bindings ? bindings.layers : undefined;
  return Array.isArray(raw) ? raw.filter((c) => typeof c === 'string' && c.length > 0) : [];
}

// This project's own documented convention (matches the shipped scaffold's
// honest fossil/renewables framing, STATE.md Phase 03 decision) for
// electricity-style layer sets: when the bound layers include any of these
// names, their combined share of the total is reported as `fossilPctFirst`/
// `fossilPctLast` alongside the always-generic largest-layer finding below.
// Gracefully omitted (null) for any bound layer set that doesn't name these
// columns -- NEVER assumed for arbitrary data, and never affects shape()'s
// generic band data or the layer-count ceiling check.
const FOSSIL_KEYS = ['coal', 'gas', 'oil'];

/**
 * shape(rows, bindings) -> {data:[{x, [layer]:value, ...}], keys:string[], stats}
 *
 * `data` rows are keyed by the bound x column plus one numeric value per
 * bound layer column -- exactly the shape d3.stack() consumes when given
 * `.keys(BOUND_DATA.keys)`. `keys` is the bound layer column NAMES, in bound
 * order -- the scaffold's stack generator derives its keys from THIS array,
 * never a literal list.
 */
export function shape(rows, bindings) {
  const xCol = bindings.x;
  const keys = layerColumns(bindings);

  const data = [];
  for (const row of rows || []) {
    if (!row) continue;
    const x = coerceX(row[xCol]);
    if (!Number.isFinite(x)) continue;
    const rec = { x };
    for (const key of keys) {
      rec[key] = isCoercibleNumber(row[key]) ? Number(row[key]) : 0;
    }
    data.push(rec);
  }
  data.sort((a, b) => a.x - b.x);

  const firstRec = data.length > 0 ? data[0] : null;
  const lastRec = data.length > 0 ? data[data.length - 1] : null;

  function total(rec) {
    if (!rec) return null;
    return keys.reduce((sum, key) => sum + (rec[key] || 0), 0);
  }

  const totalFirst = total(firstRec);
  const totalLast = total(lastRec);

  // Per-layer share of the total at the last bound x -- a fully generic
  // finding (works for ANY bound layer set, not just electricity's own
  // 6 named bands): which single layer holds the largest share right now.
  let largestLayerLast = null;
  let largestLayerShareLast = null;
  if (lastRec && totalLast) {
    for (const key of keys) {
      const share = (lastRec[key] || 0) / totalLast;
      if (largestLayerShareLast === null || share > largestLayerShareLast) {
        largestLayerShareLast = share;
        largestLayerLast = key;
      }
    }
  }

  const boundFossilKeys = FOSSIL_KEYS.filter((k) => keys.includes(k));
  let fossilPctFirst = null;
  let fossilPctLast = null;
  if (boundFossilKeys.length > 0) {
    if (firstRec && totalFirst) {
      const fossilFirst = boundFossilKeys.reduce((sum, k) => sum + (firstRec[k] || 0), 0);
      fossilPctFirst = (fossilFirst / totalFirst) * 100;
    }
    if (lastRec && totalLast) {
      const fossilLast = boundFossilKeys.reduce((sum, k) => sum + (lastRec[k] || 0), 0);
      fossilPctLast = (fossilLast / totalLast) * 100;
    }
  }

  const stats = {
    rowCount: data.length,
    layerCount: keys.length,
    firstX: firstRec ? firstRec.x : null,
    lastX: lastRec ? lastRec.x : null,
    totalFirst,
    totalLast,
    largestLayerLast,
    largestLayerShareLast,
    fossilPctFirst,
    fossilPctLast,
  };

  return { data, keys, stats };
}

/**
 * validate(rows, bindings, {contract}) -> Array<{channel,problem,remedy}>
 *
 * - fewer than 2 bound layer columns -> a streamgraph needs at least 2
 *   stacked bands to show any composition.
 * - more than `contract.seriesLimits.maxCategories` bound layer columns
 *   (when present on the passed contract) -> named {channel:'layers'} error
 *   (BIND-04). Absent entirely -> no ceiling enforced here (mirrors bar.mjs/
 *   bump.mjs's own contract.seriesLimits convention -- the framework's demo/
 *   regeneration path passes `contract:fragment.dataBinding` only; a caller
 *   that also wants the ceiling enforced merges in `fragment.seriesLimits`
 *   itself, see this plan's proof test).
 *
 * A per-column type check (each bound layer column must be quantitative) is
 * already generic in scripts/bind-data.mjs's validateBinding() -- a
 * `multiColumn` role validates every column in its bound array against the
 * role's declared `types`, so it is NOT duplicated here.
 */
export function validate(rows, bindings, { contract } = {}) {
  const errors = [];
  const keys = layerColumns(bindings);

  if (keys.length < 2) {
    errors.push({
      channel: 'layers',
      problem: `channel 'layers': a streamgraph needs at least 2 stacked bands, found ${keys.length}`,
      remedy: `bind 'layers' to at least 2 quantitative columns`,
    });
  }

  const maxCategories =
    contract && contract.seriesLimits && typeof contract.seriesLimits.maxCategories === 'number'
      ? contract.seriesLimits.maxCategories
      : undefined;

  if (maxCategories !== undefined && keys.length > maxCategories) {
    errors.push({
      channel: 'layers',
      problem: `channel 'layers': ${keys.length} bound layer columns exceeds the maximum of ${maxCategories} stacked bands`,
      remedy: `bind 'layers' to at most ${maxCategories} quantitative columns, or pre-aggregate rarer columns together`,
    });
  }

  return errors;
}
