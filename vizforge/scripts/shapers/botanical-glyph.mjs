// scripts/shapers/botanical-glyph.mjs
//
// EXP-01 (Phase 24 Plan 02) -- the Fragapane botanical/organism glyph
// technique's shaper. One designed plant per bound entity (company), four
// data-bearing visual channels, ALL declared in the tier-3 mapping[] and
// keyed by the auto-generated legend (scripts/qa/checks/legend-required
// .check.mjs, 24-01):
//
//   1. STEM HEIGHT = stem role (fcf_margin_pct) -- LINEAR from a ZERO
//      baseline (honest length encoding, docs/honesty-rules.md). stemH's
//      ratio against MAX_STEM_HEIGHT equals stemValue's ratio against the
//      bound set's own max stem value -- never a sqrt.
//   2. LEAF COUNT = leaves role (growth_pct) -- Math.round(value / 4), an
//      Isotype-discipline DISCRETE repeated-unit count (quantity by COUNT,
//      never by resizing a single leaf).
//   3. BLOOM AREA = bloom role (revenue_bn) -- radius via sqrtRadius(),
//      mirrors scripts/shapers/nightingale-rose.mjs's own inlined helper
//      (assets/snippets/scale-helpers.js's browser-side sqrtRadius(), kept
//      in sync by hand since Node-side shapers don't import browser
//      snippets). AREA, not radius, is proportional to value.
//   4. BLOOM HUE = ruleOf40 status, DERIVED here (never a bound column):
//      (leavesValue + stemValue) >= 40 -- both fcf_margin_pct and
//      growth_pct are percentage-point quantities, so summing them directly
//      reproduces the standard "Rule of 40" health test.
//
// Layout (x/row/col/baseY/stemTopY/bloomCenterY) is pre-computed HERE
// (Node-side), exactly like nightingale-rose.mjs's own d3-free arc-geometry
// precedent -- deterministic, no re-layout in the browser, against a FIXED
// internal canvas (CANVAS_WIDTH/CANVAS_HEIGHT/COLS/MARGIN_* below); the
// scaffold duplicates these same constants (comment-linked) purely to size
// its SVG viewBox, never to recompute position.

const CANVAS_WIDTH = 1300;
const CANVAS_HEIGHT = 620;
const COLS = 12;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 50;
const GROUND_PAD = 46; // space below each row's baseline reserved for the company label
const MAX_STEM_HEIGHT = 130;
const MAX_BLOOM_RADIUS = 24;

const MIN_ENTITIES = 15;
const MAX_ENTITIES = 50;

function coerceNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  return Number(v);
}

/**
 * sqrtRadius honesty helper -- mirrors assets/snippets/scale-helpers.js's
 * browser-inlined sqrtRadius() formula exactly (radius scaled by the square
 * root of the value ratio, so AREA is proportional to value).
 */
function sqrtRadius(value, maxValue, maxRadius) {
  if (maxValue <= 0) return 0;
  const ratio = Math.max(0, value) / maxValue;
  return Math.sqrt(ratio) * maxRadius;
}

function normalizedRows(rows, bindings) {
  const entityCol = bindings.entity;
  const stemCol = bindings.stem;
  const leavesCol = bindings.leaves;
  const bloomCol = bindings.bloom;
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const entity = row[entityCol];
    const stemValue = coerceNumber(row[stemCol]);
    const leavesValue = coerceNumber(row[leavesCol]);
    const bloomValue = coerceNumber(row[bloomCol]);
    if (entity === undefined || entity === null || String(entity).trim() === '') continue;
    if (!Number.isFinite(stemValue) || !Number.isFinite(leavesValue) || !Number.isFinite(bloomValue)) continue;
    out.push({ entity: String(entity), stemValue, leavesValue, bloomValue });
  }
  return out;
}

/**
 * shape(rows, bindings) -> {
 *   data: [{ entity, stemValue, stemH, leaves, growthValue, bloomValue,
 *            bloomR, ruleOf40, score, row, col, x, baseY, stemTopY,
 *            bloomCenterY }],
 *   stats: { entityCount, ruleOf40Count, maxStemValue, maxBloomValue,
 *            totalRows }
 * }
 *
 * Sorted by score (stemValue + leavesValue) DESCENDING -- the healthiest
 * companies read left-to-right, top-to-bottom (a "garden" ordering). Fully
 * deterministic across repeat calls: no Math.random, no wall-clock read,
 * Array.prototype.sort is stable (ES2019+) so any true score tie keeps the
 * bound rows' own original relative order.
 */
export function shape(rows, bindings) {
  const points = normalizedRows(rows, bindings);

  const withScore = points.map((p) => ({
    entity: p.entity,
    stemValue: p.stemValue,
    growthValue: p.leavesValue,
    bloomValue: p.bloomValue,
    leaves: Math.round(p.leavesValue / 4),
    score: p.stemValue + p.leavesValue,
    ruleOf40: p.stemValue + p.leavesValue >= 40,
  }));

  withScore.sort((a, b) => b.score - a.score);

  const maxStemValue = withScore.length > 0 ? Math.max(...withScore.map((d) => d.stemValue), 0) : 0;
  const maxBloomValue = withScore.length > 0 ? Math.max(...withScore.map((d) => d.bloomValue), 0) : 0;

  const count = withScore.length;
  const totalRows = count > 0 ? Math.ceil(count / COLS) : 0;
  const rowHeight = totalRows > 0 ? (CANVAS_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / totalRows : 0;
  const slotWidth = CANVAS_WIDTH / COLS;

  const data = withScore.map((d, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const stemH = maxStemValue > 0 ? (d.stemValue / maxStemValue) * MAX_STEM_HEIGHT : 0;
    const bloomR = sqrtRadius(d.bloomValue, maxBloomValue, MAX_BLOOM_RADIUS);
    const baseY = MARGIN_TOP + (row + 1) * rowHeight - GROUND_PAD;
    const stemTopY = baseY - stemH;
    const bloomCenterY = stemTopY - bloomR;
    const x = col * slotWidth + slotWidth / 2;
    return {
      entity: d.entity,
      stemValue: d.stemValue,
      stemH,
      leaves: d.leaves,
      growthValue: d.growthValue,
      bloomValue: d.bloomValue,
      bloomR,
      ruleOf40: d.ruleOf40,
      score: d.score,
      row,
      col,
      x,
      baseY,
      stemTopY,
      bloomCenterY,
    };
  });

  const stats = {
    entityCount: count,
    ruleOf40Count: data.filter((d) => d.ruleOf40).length,
    maxStemValue,
    maxBloomValue,
    totalRows,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings) -> Array<{channel,problem,remedy}>
 *
 * - between MIN_ENTITIES (15) and MAX_ENTITIES (50) distinct entities
 *   required (the Fragapane legibility range) -- fewer reads as sparse,
 *   more as illegible clutter at this glyph scale.
 * - no negative values on any of the three quantitative roles (length /
 *   count / area cannot honestly encode a negative magnitude).
 */
export function validate(rows, bindings) {
  const points = normalizedRows(rows, bindings);
  const distinctEntities = new Set(points.map((p) => p.entity));
  const errors = [];

  if (distinctEntities.size < MIN_ENTITIES || distinctEntities.size > MAX_ENTITIES) {
    errors.push({
      channel: 'entity',
      problem: `channel 'entity': ${distinctEntities.size} distinct entities found -- a botanical glyph garden needs between ${MIN_ENTITIES} and ${MAX_ENTITIES} entities to stay legible (the Fragapane range)`,
      remedy: `bind 'entity' to a column with between ${MIN_ENTITIES} and ${MAX_ENTITIES} distinct entity values`,
    });
  }

  const negativeStem = points.some((p) => p.stemValue < 0);
  if (negativeStem) {
    errors.push({
      channel: 'stem',
      problem: "channel 'stem': at least one negative value found -- stem HEIGHT is a length encoding and cannot honestly represent a negative magnitude",
      remedy: "bind 'stem' to a column whose values are all >= 0, or pre-filter/rebase negative rows before binding",
    });
  }

  const negativeLeaves = points.some((p) => p.leavesValue < 0);
  if (negativeLeaves) {
    errors.push({
      channel: 'leaves',
      problem: "channel 'leaves': at least one negative value found -- leaf COUNT is an integer-units encoding and cannot honestly represent a negative quantity",
      remedy: "bind 'leaves' to a column whose values are all >= 0, or pre-filter/rebase negative rows before binding",
    });
  }

  const negativeBloom = points.some((p) => p.bloomValue < 0);
  if (negativeBloom) {
    errors.push({
      channel: 'bloom',
      problem: "channel 'bloom': at least one negative value found -- bloom AREA cannot honestly represent a negative magnitude",
      remedy: "bind 'bloom' to a column whose values are all >= 0, or pre-filter/rebase negative rows before binding",
    });
  }

  return errors;
}

export const __canvas = {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  COLS,
  MARGIN_TOP,
  MARGIN_BOTTOM,
  GROUND_PAD,
  MAX_STEM_HEIGHT,
  MAX_BLOOM_RADIUS,
  MIN_ENTITIES,
  MAX_ENTITIES,
};
