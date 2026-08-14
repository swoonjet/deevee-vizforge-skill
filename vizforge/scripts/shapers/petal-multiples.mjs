// scripts/shapers/petal-multiples.mjs
//
// EXP-02 (Phase 24 Plan 03) -- the Stefaner-register petal/flower
// small-multiples technique's shaper. One bloom per ENTITY (bindings.entity),
// one petal per INDICATOR column (bindings.indicators, a multiColumn role --
// streamgraph.json's `layers` precedent, scripts/bind-data.mjs's existing
// multiColumn handling; zero new binding-layer code).
//
// HONESTY (24-CONTEXT.md, 24-RESEARCH.md Pitfall 4) -- THE LOAD-BEARING
// PROPERTY: petal LENGTH (outerRadius) is LINEAR in value, from a SHARED
// ZERO baseline -- never area, never sqrt. Critically, the scale is
// per-INDICATOR, NEVER global: one [0, max-across-all-entities] linear
// domain is computed ONCE PER indicator column, and that column's own
// domain is applied to its petal position in EVERY bloom. Collapsing all
// three indicators onto one shared numeric domain would be the exact
// "global scale" lie the phase's honesty crux forbids.
//
// GRID-COMPARABILITY: every bloom shares the same petal COUNT, the same
// fixed angular POSITIONS (equally spaced, first petal centered at 12
// o'clock / angle 0, proceeding clockwise -- matching d3.arc()'s own angle
// convention), and the same fixed angular WIDTH per position -- only
// outerRadius (length) ever varies bloom-to-bloom. Positions/widths are
// computed ONCE, outside the per-entity map, so repeat calls are
// byte-for-byte identical (fully deterministic, no Math.random).
//
// PETAL SHAPE: reuses nightingale-rose.mjs's exact wedge-record shape
// ({innerRadius, outerRadius, startAngle, endAngle}) -- the scaffold draws
// with the same d3.arc() machinery, adding a cornerRadius for rounded
// petal tips (24-RESEARCH.md Code Example 2). innerRadius is always 0
// (shared zero baseline).
//
// Layout is pre-computed HERE (Node-side), mirroring circle-packing.mjs /
// nightingale-rose.mjs's own precedent, against a FIXED internal per-bloom
// canvas (BLOOM_RADIUS below); the scaffold duplicates this same constant
// (comment-linked) purely to size each bloom's SVG viewBox, never to
// recompute radius.

const BLOOM_RADIUS = 52;
const MIN_INDICATORS = 2;
const MAX_INDICATORS = 12;
const MAX_ENTITIES = 64;

function coerceNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  return Number(v);
}

function indicatorColumns(bindings) {
  const raw = bindings ? bindings.indicators : undefined;
  return Array.isArray(raw) ? raw : [];
}

function normalizedEntities(rows, bindings) {
  const entityCol = bindings ? bindings.entity : undefined;
  const indicatorCols = indicatorColumns(bindings);
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const entity = row[entityCol];
    if (entity === undefined || entity === null || String(entity).trim() === '') continue;
    const values = indicatorCols.map((col) => coerceNumber(row[col]));
    if (values.some((v) => !Number.isFinite(v))) continue;
    out.push({ entity: String(entity), values });
  }
  return out;
}

/**
 * Fixed petal positions/widths shared by EVERY bloom -- computed once from
 * indicator COUNT alone (never from any bloom's own values). First petal
 * centered at angle 0 (12 o'clock in d3.arc()'s convention); remaining
 * petals proceed clockwise at equal (2*PI/N) spacing. Petal angular width
 * is a fixed fraction of its slot, leaving a visible gap between petals.
 */
function petalPositions(indicatorCount) {
  const slotAngle = indicatorCount > 0 ? (2 * Math.PI) / indicatorCount : 0;
  const width = slotAngle * 0.62;
  const positions = [];
  for (let i = 0; i < indicatorCount; i++) {
    const center = i * slotAngle;
    positions.push({ startAngle: center - width / 2, endAngle: center + width / 2 });
  }
  return positions;
}

/**
 * shape(rows, bindings) -> {
 *   data: [{ entity, petals: [{indicator, value, outerRadius, startAngle,
 *            endAngle, hueIndex}] }],
 *   stats: { entityCount, indicatorCount, rowCount, maxByIndicator,
 *            maxHolderByIndicator }
 * }
 *
 * Exactly one bloom per distinct entity, sorted by the FIRST indicator
 * column DESCENDING (this dataset's demoBinding orders `population_2020`
 * first, producing the plan's required population-descending grid).
 * Deterministic: no Math.random, no wall-clock read.
 */
export function shape(rows, bindings) {
  const indicatorCols = indicatorColumns(bindings);
  const entities = normalizedEntities(rows, bindings);

  const maxByIndicator = {};
  const maxHolderByIndicator = {};
  indicatorCols.forEach((col, idx) => {
    let max = 0;
    let holder = null;
    let holderValue = 0;
    for (const e of entities) {
      const v = Math.max(0, e.values[idx]);
      if (v > max) max = v;
      if (holder === null || v > holderValue) {
        holder = e.entity;
        holderValue = v;
      }
    }
    maxByIndicator[col] = max;
    maxHolderByIndicator[col] = { entity: holder, value: holderValue };
  });

  const positions = petalPositions(indicatorCols.length);

  const sorted = entities.slice().sort((a, b) => {
    const av = indicatorCols.length > 0 ? a.values[0] : 0;
    const bv = indicatorCols.length > 0 ? b.values[0] : 0;
    return bv - av;
  });

  const data = sorted.map((e) => ({
    entity: e.entity,
    petals: indicatorCols.map((col, idx) => {
      const value = Math.max(0, e.values[idx]);
      const max = maxByIndicator[col];
      const outerRadius = max > 0 ? (value / max) * BLOOM_RADIUS : 0;
      return {
        indicator: col,
        value,
        outerRadius,
        startAngle: positions[idx].startAngle,
        endAngle: positions[idx].endAngle,
        hueIndex: idx,
      };
    }),
  }));

  const stats = {
    entityCount: sorted.length,
    indicatorCount: indicatorCols.length,
    rowCount: entities.length,
    maxByIndicator,
    maxHolderByIndicator,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings) -> Array<{channel,problem,remedy}>
 *
 * - rejects fewer than MIN_INDICATORS or more than MAX_INDICATORS bound
 *   indicator columns (petal legibility).
 * - rejects any negative indicator value (length cannot honestly encode a
 *   negative from a zero baseline).
 * - rejects duplicate entity values (one bloom per distinct entity).
 * - rejects entity counts outside a legible grid range (1..MAX_ENTITIES).
 */
export function validate(rows, bindings) {
  const errors = [];
  const indicatorCols = indicatorColumns(bindings);
  const entityCol = bindings ? bindings.entity : undefined;

  if (indicatorCols.length < MIN_INDICATORS || indicatorCols.length > MAX_INDICATORS) {
    errors.push({
      channel: 'indicators',
      problem: `channel 'indicators': ${indicatorCols.length} column(s) bound -- a petal bloom needs between ${MIN_INDICATORS} and ${MAX_INDICATORS} indicator columns for legible, comparable petals`,
      remedy: `bind between ${MIN_INDICATORS} and ${MAX_INDICATORS} quantitative columns to 'indicators'`,
    });
  }

  let sawNegative = false;
  const entityValues = [];
  for (const row of rows || []) {
    if (!row) continue;
    const entity = row[entityCol];
    if (entity !== undefined && entity !== null && String(entity).trim() !== '') {
      entityValues.push(String(entity));
    }
    for (const col of indicatorCols) {
      const v = coerceNumber(row[col]);
      if (Number.isFinite(v) && v < 0) sawNegative = true;
    }
  }

  if (sawNegative) {
    errors.push({
      channel: 'indicators',
      problem: "channel 'indicators': at least one bound indicator value is negative -- petal length cannot honestly encode a negative value from a shared zero baseline",
      remedy: 'bind only non-negative quantitative columns to \'indicators\', or pre-filter negative rows',
    });
  }

  const distinctEntities = new Set(entityValues);
  if (distinctEntities.size !== entityValues.length) {
    errors.push({
      channel: 'entity',
      problem: `channel 'entity': ${entityValues.length - distinctEntities.size} duplicate entity value(s) found -- exactly one bloom per distinct entity is required`,
      remedy: "bind 'entity' to a column with no duplicate values, or pre-aggregate to one row per entity",
    });
  }

  if (distinctEntities.size === 0) {
    errors.push({
      channel: 'entity',
      problem: "channel 'entity': no usable entity rows found",
      remedy: "bind 'entity' to a column with at least one non-empty value",
    });
  } else if (distinctEntities.size > MAX_ENTITIES) {
    errors.push({
      channel: 'entity',
      problem: `channel 'entity': ${distinctEntities.size} distinct entities found -- exceeds the legible grid cap of ${MAX_ENTITIES} blooms`,
      remedy: `bind 'entity' to a column with at most ${MAX_ENTITIES} distinct values, or pre-filter to a top-N subset`,
    });
  }

  return errors;
}

export const __canvas = { BLOOM_RADIUS, MIN_INDICATORS, MAX_INDICATORS, MAX_ENTITIES };
