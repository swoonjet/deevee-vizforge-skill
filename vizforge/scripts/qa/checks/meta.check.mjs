// scripts/qa/checks/meta.check.mjs
//
// meta.json schema v2 validator (docs/qa-schemas.md contract #1) as a gate
// check module. Mirrors scripts/tests/smoke/meta-schema-fields.test.mjs's
// assertions (same schema, same source of truth) but reports named,
// specific VIOLATIONs instead of throwing — this check module IS the
// mechanically-enforced version of that schema for the gate.

export const name = 'meta';
export const needs = ['meta'];

const PALETTE_VOCAB = new Set(['ink', 'ink-emphasis', 'categorical', 'sequential', 'diverging']);
const VALID_CHANNELS = new Set(['position', 'length', 'area', 'angle', 'color']);

// Optional family signal (19-03, FND-03 Task 1). Backward-compatible: ALL 34
// existing scaffolds omit `family` entirely and must keep validating — so
// this is validated ONLY when present, never required. Family-scoped
// honesty checks (radial-baseline, and later geo-honesty/density-bandwidth/
// network-position) key off this field to decide applicability, mirroring
// at-rest.check.mjs's ANIMATED_ONLY inertness pattern for a meta-driven
// signal instead of a kind-driven one.
const VALID_FAMILIES = new Set(['geospatial', 'hierarchy', 'network', 'density', 'radial', 'expressive']);

export async function run(ctx) {
  const meta = ctx.meta ?? {};
  const problems = [];

  if (meta.schemaVersion !== 2) {
    problems.push(`schemaVersion must be 2 (got ${JSON.stringify(meta.schemaVersion)})`);
  }
  if (![1, 2, 3].includes(meta.tier)) {
    problems.push(`tier must be 1, 2, or 3 (got ${JSON.stringify(meta.tier)})`);
  }

  for (const field of ['technique', 'palette', 'composition']) {
    if (typeof meta[field] !== 'string' || meta[field].length === 0) {
      problems.push(`${field} must be a non-empty string (got ${JSON.stringify(meta[field])})`);
    }
  }

  if (typeof meta.dataset?.domain !== 'string' || meta.dataset.domain.length === 0) {
    problems.push('dataset.domain must be a non-empty string');
  }

  if (typeof meta.palette === 'string' && meta.palette.length > 0 && !PALETTE_VOCAB.has(meta.palette)) {
    problems.push(`palette "${meta.palette}" not in controlled vocabulary (${[...PALETTE_VOCAB].join(', ')})`);
  }

  // Optional family signal: validated only when present (backward-compat —
  // absence is always valid, never required).
  if (meta.family !== undefined && !VALID_FAMILIES.has(meta.family)) {
    problems.push(`family "${meta.family}" not in controlled vocabulary (${[...VALID_FAMILIES].join(', ')})`);
  }

  const encoding = meta.encoding;
  if (!encoding || typeof encoding !== 'object') {
    problems.push('encoding must be an object');
  } else {
    if (typeof encoding.channel !== 'string' || !VALID_CHANNELS.has(encoding.channel)) {
      problems.push(
        `encoding.channel must be one of ${[...VALID_CHANNELS].join('|')} (got ${JSON.stringify(encoding.channel)})`
      );
    }
    if (typeof encoding.baselineZero !== 'boolean') {
      problems.push(`encoding.baselineZero must be a boolean (got ${JSON.stringify(encoding.baselineZero)})`);
    }
    if (typeof encoding.baselineDisclosed !== 'boolean') {
      problems.push(
        `encoding.baselineDisclosed must be a boolean (got ${JSON.stringify(encoding.baselineDisclosed)})`
      );
    }
    if (
      encoding.baselineDisclosed === true &&
      (typeof encoding.disclosure !== 'string' || encoding.disclosure.length === 0)
    ) {
      problems.push('encoding.baselineDisclosed:true requires a non-empty encoding.disclosure string');
    }
  }

  if (meta.tier === 3) {
    if (!Array.isArray(meta.mapping) || meta.mapping.length === 0) {
      problems.push('tier 3 requires a non-empty mapping array');
    } else {
      for (const [i, m] of meta.mapping.entries()) {
        for (const key of ['visualParameter', 'dataField', 'transform']) {
          if (typeof m?.[key] !== 'string' || m[key].length === 0) {
            problems.push(`mapping[${i}].${key} must be a non-empty string`);
          }
        }
      }
    }
  }

  if (meta.kind === 'animated') {
    if (meta.easing !== 'sine-in-out') {
      problems.push(`kind "animated" requires easing: "sine-in-out" (got ${JSON.stringify(meta.easing)})`);
    }
    if (typeof meta.fps !== 'number' || meta.fps <= 0) {
      problems.push(`kind "animated" requires a positive numeric fps (got ${JSON.stringify(meta.fps)})`);
    }
    if (typeof meta.totalFrames !== 'number' || meta.totalFrames <= 0) {
      problems.push(`kind "animated" requires a positive numeric totalFrames (got ${JSON.stringify(meta.totalFrames)})`);
    }
    if (typeof meta.resolve !== 'string' || meta.resolve.length === 0) {
      problems.push('kind "animated" requires a resolve field ("loop" | "hold")');
    }
  }

  if (problems.length > 0) {
    return { name, severity: 'VIOLATION', evidence: problems.join('; ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `schemaVersion 2; tier=${meta.tier}; technique=${meta.technique}; palette=${meta.palette}; composition=${meta.composition}`,
  };
}
