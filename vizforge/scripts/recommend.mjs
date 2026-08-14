#!/usr/bin/env node
// scripts/recommend.mjs
//
// FRAME-01/FRAME-02 decision engine (docs/atlas-manifest.md contract #4).
// Two-stage pure design, per 03-RESEARCH.md's CompassQL/Voyager-grounded
// recommendation:
//
//   STAGE 0 — refusal: an anti-pattern intent NEVER reaches ranking. Checked
//   before anything else so an anti-pattern request can never return the
//   anti-pattern itself.
//
//   STAGE 1 — honesty filter (pass/fail, not a score): data-shape fit +
//   seriesLimits + preconditions. An entry that fails ANY of these is
//   simply not a candidate — this is a filter, never a penalty.
//
//   STAGE 2 — interestingness ranking among survivors: tierWeight +
//   noveltyBonus (see 03-RESEARCH.md's SeeDB/Scagnostics-adjacent
//   "deviation from the boring default" framing). Ties break by ascending
//   slug — fully deterministic.
//
// CLI (locked invocation, appears verbatim in SKILL.md and its own tests):
//   node scripts/recommend.mjs --profile '<json>' --intent "<keywords>" [--manifest <path>]

import { readFile } from 'node:fs/promises';

// FT-vocabulary order — also the deterministic tie-break order used to pick
// a profile's "primary" shape when more than one candidate shape matches
// (first one in this canonical order wins, never insertion-order-of-checks).
const FT_ORDER = [
  'change-over-time',
  'magnitude',
  'distribution',
  'correlation',
  'ranking',
  'part-to-whole',
  'flow',
  // 'cyclical' is manually-declared only (radial/polar's honesty restriction) —
  // shapesFromProfile() below has NO heuristic that ever produces it, and none
  // is added here (orchestrator sign-off, 04-01-PLAN.md Task 1: vocabulary
  // only, no automatic cyclical-detection this phase).
  'cyclical',
  // 'geospatial', 'hierarchy', 'network' are ALSO manually-declared only,
  // mirroring 'cyclical' exactly (Phase 25 Plan 02 vocabulary-only fix,
  // 04-01/08-01 precedent) — shapesFromProfile() below has NO heuristic that
  // ever produces any of these three, and none is added here. They exist in
  // the manifest schema's dataShapes vocabulary (hex-tilegram/choropleth,
  // treemap/sunburst/circle-packing, arc-diagram/adjacency-matrix/node-link)
  // but were missing from this eligibility vocabulary, making all 8 of those
  // techniques permanently unreachable — chip-injection is the ONLY path.
  'geospatial',
  'hierarchy',
  'network',
];

const TIER_WEIGHTS = { 1: 0, 2: 2 };

/**
 * tierWeight(tier) -> number
 * Tier 1 -> 0, Tier 2 -> 2 (03-RESEARCH.md's locked formula). Tier 3 has no
 * defined weight yet (Phase 4 introduces tier-3 atlas entries) — defaults
 * to 0 rather than throwing, so an unexpected tier never crashes ranking.
 */
export function tierWeight(tier) {
  return TIER_WEIGHTS[tier] ?? 0;
}

/**
 * noveltyBonus(entry, primaryShape, defaults) -> 0 | 1
 * +1 iff entry.slug is NOT the locked default technique for primaryShape.
 * Kept as its own isolated, swappable function (03-RESEARCH.md Open
 * Question 1) so a future data-driven term can replace it without changing
 * recommend()'s public interface.
 */
export function noveltyBonus(entry, primaryShape, defaults) {
  if (!primaryShape) return 0;
  return entry.slug !== defaults?.[primaryShape] ? 1 : 0;
}

function quantitativeFieldCount(fields) {
  return (fields || []).filter((f) => f && f.type === 'quantitative').length;
}

/**
 * shapesFromProfile(profile) -> FT-vocabulary string[]
 * Derives candidate data shapes from profile.shape booleans + profile.fields
 * + profile.intent keywords. Returned in FT_ORDER (canonical, deterministic)
 * — the first entry is the profile's "primary" shape for noveltyBonus.
 */
export function shapesFromProfile(profile) {
  const shape = profile?.shape || {};
  const fields = profile?.fields || [];
  const intentText = (profile?.intent || []).join(' ').toLowerCase();

  const candidates = new Set();

  if (shape.hasTimeAxis) candidates.add('change-over-time');
  if (shape.isFlow) candidates.add('flow');
  if (shape.isPartToWhole) candidates.add('part-to-whole');
  if (shape.isDistribution) candidates.add('distribution');

  const quantCount = quantitativeFieldCount(fields);
  if (shape.hasCategories && quantCount >= 1) candidates.add('magnitude');
  if (quantCount >= 2 || /\b(correlation|relationship)\b/.test(intentText)) {
    candidates.add('correlation');
  }
  if (/\b(rank|ranking)\b/.test(intentText)) candidates.add('ranking');

  // REC-01: a chip's EXACT FT_ORDER slug placed in profile.intent (case-
  // insensitive, trimmed) adds that shape directly as a candidate — the
  // sanctioned "manual invocation" path. This is the ONLY way 'cyclical'
  // can ever surface (no heuristic above or in profile.mjs ever adds it —
  // see FT_ORDER's own comment). Free-text tokens still feed the existing
  // intentText regex path above, unchanged.
  const chipShapes = (profile?.intent || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => FT_ORDER.includes(s));
  for (const s of chipShapes) candidates.add(s);

  return FT_ORDER.filter((s) => candidates.has(s));
}

function preconditionViolated(precondition, shape) {
  if (precondition === 'acyclic-flow') {
    return shape?.hasCycles === true;
  }
  // grid-vector-field-required (flow-field's normalized short precondition
  // ID, per skill/manifest/flow-field.json) unconditionally excludes
  // flow-field from every auto-recommendation — 08-VALIDATION.md ruling #1:
  // flow-field is MANUAL-ONLY. profile.mjs deliberately has no grid/vector-
  // field detection heuristic, and none should ever be added; this defensive
  // check is the only real gate. Matched by substring (not exact string) so
  // this also catches the pre-rebuild legacy descriptive precondition text
  // still checked into skill/manifest.json today
  // ("real-directional-vector-field-required (u/v or speed+direction, NOT a
  // scalar series)") — that fragment's own source file
  // (skill/manifest/flow-field.json) already carries the normalized short
  // ID; the built skill/manifest.json artifact just hasn't been regenerated
  // from it yet. Rebuilding that artifact is out of this plan's scope
  // (logged in deferred-items.md) — this substring match keeps flow-field
  // excluded correctly either way.
  if (/vector-field-required/i.test(precondition)) {
    return true;
  }
  // small-directed-matrix-max-12-nodes (chord): intentionally a no-op here,
  // per 08-VALIDATION.md ruling #3 (never duplicate a numeric ceiling in two
  // places). The real 12-node ceiling is enforced honestly via
  // entry.seriesLimits.maxCategories against shape.categoryCardinality,
  // which profile.mjs's deriveShape() now folds the edge-list's real
  // union-of-source/target node count into. A second, cruder check here
  // could silently diverge from that one real number.
  if (precondition === 'small-directed-matrix-max-12-nodes') {
    return false;
  }
  // Unknown preconditions are forward-compatible: they don't block until a
  // recognized check exists for them (documented, not a silent no-op bug —
  // Wave 2 batch plans introducing a new precondition string must add its
  // check here).
  return false;
}

function seriesLimitsExceeded(entry, shape) {
  const limits = entry.seriesLimits;
  if (!limits) return false;
  if (
    limits.maxCategories !== undefined &&
    shape?.categoryCardinality !== undefined &&
    shape.categoryCardinality > limits.maxCategories
  ) {
    return true;
  }
  if (
    limits.maxPoints !== undefined &&
    shape?.pointCount !== undefined &&
    shape.pointCount > limits.maxPoints
  ) {
    return true;
  }
  return false;
}

/**
 * seriesLimitsDetail(entry, shape) -> { kind:'maxCategories'|'maxPoints', limit, have } | null
 * Same rule/order as seriesLimitsExceeded() (kept, unmodified, for internal
 * backward-compat) but retains WHICH limit tripped and its numbers, for
 * isEligible()'s structured verdict (REC-05).
 */
function seriesLimitsDetail(entry, shape) {
  const limits = entry.seriesLimits;
  if (!limits) return null;
  if (
    limits.maxCategories !== undefined &&
    shape?.categoryCardinality !== undefined &&
    shape.categoryCardinality > limits.maxCategories
  ) {
    return { kind: 'maxCategories', limit: limits.maxCategories, have: shape.categoryCardinality };
  }
  if (
    limits.maxPoints !== undefined &&
    shape?.pointCount !== undefined &&
    shape.pointCount > limits.maxPoints
  ) {
    return { kind: 'maxPoints', limit: limits.maxPoints, have: shape.pointCount };
  }
  return null;
}

/**
 * bindingIncompatDetail(entry, profile) -> null | { role, label, needs }
 * Opt-in (profile.strictBinding): a technique whose REQUIRED dataBinding
 * role has zero type-compatible columns in the profiled dataset can never
 * bind — offering it sends the user into a column-mapping dead end where
 * every possible choice fails. Only callers with a real per-column profile
 * (the app wizard) set strictBinding; the v1 skill CLI contract (shape-based
 * eligibility, REC-01..06 tests) is unchanged without it.
 */
function bindingIncompatDetail(entry, profile) {
  if (!profile?.strictBinding) return null;
  const roles = entry.dataBinding?.roles || [];
  const fields = profile.fields || [];
  if (roles.length === 0 || fields.length === 0) return null;
  for (const role of roles) {
    if (!role.required) continue;
    const types = role.types || [];
    if (types.length === 0) continue;
    if (!fields.some((f) => types.includes(f.type))) {
      return { role: role.role, label: role.label || role.role, needs: types };
    }
  }
  return null;
}

/**
 * isEligible(entry, candidateShapes, shape, profile) -> { ok:true } | { ok:false, reasonCode, reason, detail }
 * Structured verdict (REC-05/06) — reasonCodes: 'shape-mismatch' | 'cardinality' | 'precondition' | 'binding-incompat'.
 */
function isEligible(entry, candidateShapes, shape, profile) {
  // A demo-pinned technique is ruled out before anything about the data is
  // consulted, because nothing about the data can rescue it: the scaffold or
  // the shaper is fixed to the demo dataset's MEANING, so a perfect binding
  // still renders that dataset's question over your numbers, or throws.
  //
  // This is deliberately the first check. Ordering it after the shape test
  // would let a demo-pinned piece be refused for the wrong reason ("data shape
  // doesn't match") on some tables and offered on others, which is how these
  // two came to be offered at all.
  if (entry.demoOnly) {
    return {
      ok: false,
      reasonCode: 'demo-only',
      reason: entry.demoOnly.reason,
      detail: { demoOnly: true },
    };
  }

  const fits = (entry.dataShapes || []).some((s) => candidateShapes.includes(s));
  if (!fits) {
    return {
      ok: false,
      reasonCode: 'shape-mismatch',
      reason: `data shape doesn't match — "${entry.slug}" needs ${(entry.dataShapes || []).join('/')}`,
      detail: { needed: entry.dataShapes, have: candidateShapes },
    };
  }

  const limitDetail = seriesLimitsDetail(entry, shape);
  if (limitDetail) {
    const label = limitDetail.kind === 'maxPoints' ? 'point count' : 'category count';
    return {
      ok: false,
      reasonCode: 'cardinality',
      reason: `${label} (${limitDetail.have}) exceeds this form's limit (${limitDetail.limit})`,
      detail: { limit: limitDetail.limit, have: limitDetail.have },
    };
  }

  const preconditions = entry.preconditions || [];
  const failed = preconditions.find((p) => preconditionViolated(p, shape));
  if (failed) {
    return {
      ok: false,
      reasonCode: 'precondition',
      reason: `precondition "${failed}" not met for this data`,
      detail: { precondition: failed },
    };
  }

  const incompat = bindingIncompatDetail(entry, profile);
  if (incompat) {
    return {
      ok: false,
      reasonCode: 'binding-incompat',
      reason: `needs a ${incompat.needs.join(' or ')} column for "${incompat.label}" — this dataset has none`,
      detail: incompat,
    };
  }

  return { ok: true };
}

function matchedShapeFor(entry, candidateShapes) {
  return candidateShapes.find((s) => (entry.dataShapes || []).includes(s)) || null;
}

function honestyStatement(entry, matchedShape) {
  const risks = entry.honestyRisks || [];
  const base = `${matchedShape} shape matches; ${entry.expectedChannel} encoding`;
  return risks.length > 0 ? `${base} (watch: ${risks.join('; ')})` : base;
}

/**
 * rankCandidates(entries, candidateShapes, primaryShape, shape, defaults)
 * -> { recommendations: recommendation[], ineligible: ineligibleEntry[] }
 * Shared Stage 1 (filter) + Stage 2 (rank) pipeline, used both for a normal
 * request AND for computing "recommendations for the honest alternative's
 * shape" after a Stage 0 refusal.
 *
 * REC-05: partitions non-eligible entries too — an entry that fails but
 * still shares >=1 candidate shape (a genuine near-miss, per
 * matchedShapeFor) feeds the additive `ineligible` array. Entries with ZERO
 * shape overlap are omitted entirely (08-VALIDATION.md ruling #2 — never
 * surface all ~24 unrelated techniques, only shape-relevant near-misses).
 */
function rankCandidates(entries, candidateShapes, primaryShape, shape, defaults, profile) {
  if (candidateShapes.length === 0) return { recommendations: [], ineligible: [] };

  const eligible = [];
  const ineligible = [];
  for (const entry of entries) {
    const verdict = isEligible(entry, candidateShapes, shape, profile);
    if (verdict.ok) {
      eligible.push(entry);
    } else if (matchedShapeFor(entry, candidateShapes) !== null) {
      ineligible.push({
        slug: entry.slug,
        reasonCode: verdict.reasonCode,
        reason: verdict.reason,
        detail: verdict.detail,
      });
    }
  }
  ineligible.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const scored = eligible.map((entry) => {
    const matchedShape = matchedShapeFor(entry, candidateShapes);
    const tw = tierWeight(entry.tier);
    const nb = noveltyBonus(entry, primaryShape, defaults);
    return {
      slug: entry.slug,
      tier: entry.tier,
      score: tw + nb,
      scoreBreakdown: { tierWeight: tw, noveltyBonus: nb },
      honesty: honestyStatement(entry, matchedShape),
      referencePath: entry.referencePath,
      scaffoldPath: entry.scaffoldPath,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  return { recommendations: scored, ineligible };
}

function matchAntiPattern(antiPatterns, intentText) {
  for (const antiPattern of antiPatterns || []) {
    if ((antiPattern.triggers || []).some((trigger) => intentText.includes(trigger.toLowerCase()))) {
      return antiPattern;
    }
  }
  return null;
}

/**
 * recommend(profile, manifest) -> { refused, recommendations }
 * Pure — no filesystem access, no CLI concerns. `profile.intent` should
 * already have any --intent CLI value merged in by the caller.
 */
export function recommend(profile, manifest) {
  const intentText = (profile?.intent || []).join(' ').toLowerCase();
  const techniques = manifest?.techniques || [];
  const defaults = manifest?.defaults || {};

  const antiPattern = matchAntiPattern(manifest?.antiPatterns, intentText);

  // STAGE 0.5 — honest exception: some anti-patterns have a narrow, honest
  // realization that a plain-text trigger can't distinguish from the
  // dishonest one. The classic case is "3d": a static perspective 3-D chart
  // lies, but a reader-rotated ORTHOGRAPHIC cube does not. When the intent
  // carries BOTH the anti-pattern trigger AND one of the exception's honest
  // signals, we do NOT refuse — we route to the sanctioned technique and let
  // the director build from its atlas doc + scaffold, with the normal
  // shape-based ranking offered alongside as flat-form alternatives.
  if (antiPattern && antiPattern.honestException) {
    const ex = antiPattern.honestException;
    const signals = (ex.signals || []).map((s) => s.toLowerCase());
    const exceptionActive = signals.some((s) => intentText.includes(s));
    if (exceptionActive) {
      const candidateShapes = shapesFromProfile(profile);
      const primaryShape = candidateShapes[0] || null;
      const { recommendations, ineligible } = rankCandidates(
        techniques,
        candidateShapes,
        primaryShape,
        profile?.shape,
        defaults,
        profile
      );
      return {
        refused: null,
        honestException: {
          antiPattern: antiPattern.id,
          technique: ex.technique,
          grantedBecause: ex.note,
          referencePath: ex.referencePath || '',
          scaffoldPath: ex.scaffoldPath || '',
        },
        // The sanctioned technique is the pick; the shape-ranked list is
        // offered as honest flat-form alternatives the director may prefer.
        recommendations,
        ineligible,
      };
    }
  }

  if (antiPattern) {
    const altEntry = techniques.find((t) => t.slug === antiPattern.honestAlternative);

    let altRecommendations = [];
    let altIneligible = [];
    if (altEntry) {
      const altCandidateShapes = FT_ORDER.filter((s) => (altEntry.dataShapes || []).includes(s));
      const altPrimaryShape = altCandidateShapes[0] || null;
      const altResult = rankCandidates(
        techniques.filter((t) => t.slug !== antiPattern.id),
        altCandidateShapes,
        altPrimaryShape,
        profile?.shape,
        defaults,
        profile
      );
      altRecommendations = altResult.recommendations;
      altIneligible = altResult.ineligible;
    }

    return {
      refused: {
        antiPattern: antiPattern.id,
        reason: antiPattern.reason,
        honestAlternative: antiPattern.honestAlternative,
        alternativeReferencePath: altEntry?.referencePath || '',
        alternativeScaffoldPath: altEntry?.scaffoldPath || '',
      },
      recommendations: altRecommendations,
      // Additive (REC-05) — never omitted, even on the refusal path.
      ineligible: altIneligible,
    };
  }

  const candidateShapes = shapesFromProfile(profile);
  const primaryShape = candidateShapes[0] || null;
  const { recommendations, ineligible } = rankCandidates(
    techniques,
    candidateShapes,
    primaryShape,
    profile?.shape,
    defaults,
    profile
  );

  return { refused: null, recommendations, ineligible };
}

// --- CLI ---
// node scripts/recommend.mjs --profile '<json>' --intent "<keywords>" [--manifest <path>]

function parseCliArgs(argv) {
  const flags = { profile: null, intent: null, manifest: 'skill/manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile') flags.profile = argv[++i];
    else if (argv[i] === '--intent') flags.intent = argv[++i];
    else if (argv[i] === '--manifest') flags.manifest = argv[++i];
  }
  return flags;
}

async function loadManifest(manifestPath) {
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(
      `recommend: manifest not found at "${manifestPath}" — run \`node scripts/build-manifest.mjs\` first (${err.message})`
    );
  }
  return JSON.parse(raw);
}

async function main() {
  const { profile: profileJson, intent, manifest: manifestPath } = parseCliArgs(process.argv.slice(2));

  if (!profileJson) {
    console.error(
      'Usage: node scripts/recommend.mjs --profile \'<json>\' --intent "<keywords>" [--manifest <path>]'
    );
    process.exitCode = 1;
    return;
  }

  let profile;
  try {
    profile = JSON.parse(profileJson);
  } catch (err) {
    console.error(`recommend: --profile is not valid JSON (${err.message})`);
    process.exitCode = 1;
    return;
  }

  if (intent) {
    profile.intent = [...(profile.intent || []), intent];
  }

  const manifest = await loadManifest(manifestPath);
  const result = recommend(profile, manifest);

  // stdout carries ONLY the JSON result — callers (SKILL.md, tests) must be
  // able to JSON.parse(stdout) unconditionally.
  console.log(JSON.stringify(result, null, 2));
}

// Only run the CLI when this file is executed directly (not when imported
// by recommend.test.mjs) — mirrors gate.mjs/pattern-scan.mjs's guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
