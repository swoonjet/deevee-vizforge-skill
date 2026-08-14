// scripts/qa/checks/at-rest.check.mjs
//
// Frame-0 (at-rest) legibility check (13-02, FIX-03). Root cause: the gate
// only ever inspected animated pieces' LAST frame — gate.mjs's
// base.screenshot is renderFrameShot(totalFrames-1), and loop-continuity's
// hold branch only diffs the final HOLD_WINDOW frames. Nothing ever looked
// at frame 0, which is exactly how 4 scaffolds shipped clean PASS sidecars
// while blank on open: their enter-animation deliberately drives the
// headline to opacity 0 and marks to a collapsed/invisible start state at
// frame 0 (the honest fix is Phase 14's self-playing player, 13-CONTEXT.md).
//
// MEASURED EVIDENCE (13-02 planning; scratch script — never committed, per
// the locked evidence-based-threshold protocol — opened each of the 6
// animated scaffolds via openPiece, called renderFrame(0), settled two rAFs,
// then read #headline/.viz-attribution computed opacity and frame-0 ink
// coverage against the piece's OWN most-frequent-pixel background):
//
//   slug                          | frame-0 headline op. | frame-0 ink % | attribution op.
//   beeswarm-animated    (BLANK)  | 0                     | 0.61%         | 0.6
//   bump-animated        (BLANK)  | 0                     | 0.91%         | 0.6
//   calendar-heatmap-animated     | 0                     | 1.18%         | 0.6
//     (BLANK)
//   streamgraph-animated (BLANK)  | 0                     | 0.29%         | 0.6
//   flow-field-animated  (OK)     | 1                     | 3.72%         | 0.6
//   ambient-sculpture-animated    | 1                     | 3.07% (dark   | 0.6
//     (OK)                        |                       |  ground)     |
//
// For comparison, the SAME 4 blank scaffolds' own legible hold frame
// (renderFrame(totalFrames-1)) measured: headline opacity 1, ink coverage
// 2.74%-32.10% (streamgraph's full stream fill dominates once drawn) —
// proving the frame-0 measurement genuinely differs from each piece's own
// healthy state, not an artifact of the measurement method.
//
// DISCOVERED ON THE FIRST HARDENED FULL-VERIFY RUN (13-02, same class,
// measured via the real gate at each piece's own preset): three
// PRE-EXISTING animated pieces outside scaffolds/ carry the identical
// deliberate enter-animation start (headline driven to opacity 0 at
// frame 0):
//
//   pieces/co2-keeling-animated                      | 0 | 0.66% | 0.6
//   gallery-candidates/world-electricity-mix-        | 0 | 0.29% | 0.6
//     streamgraph (in the curated gallery)
//   gallery-candidates/quakes-2025-calendar          | 0 | 1.17% | 0.6
//     (in the curated gallery)
//
// All three predate Phase 13 and are derivatives of the same techniques
// (line-reveal / streamgraph / calendar-heatmap); their honest fix is the
// SAME Phase 14 player+rest-state work — so they receive the SAME staged
// register treatment, never a weakened threshold. All three sit squarely
// inside the blank cluster (headline exactly 0, ink < 1.2%), confirming
// the thresholds were placed correctly from evidence.
//
// THRESHOLDS (placed with wide margins between the blank cluster and the
// healthy cluster, per the locked "never tuned to pass the blank four"
// decision):
//   HEADLINE_OPACITY_MIN = 0.5    — blank cluster is exactly 0, healthy is
//                                    exactly 1; the floor sits equidistant.
//   INK_COVERAGE_MIN     = 0.02   — between the blank max (1.18%) and the
//     (2%)                          healthy min (3.07%), ~2.6x margin.
//   ATTRIBUTION_OPACITY_MIN = 0.3 — well below the shared attribution
//                                    footer's own legitimate 0.6 opacity
//                                    (assets/snippets/attribution.js);
//                                    measured constant at 0.6 across every
//                                    scaffold (blank or healthy), so this
//                                    never trips on real pieces — only on a
//                                    fixture that deliberately zeroes it.
//
// STAGED ENFORCEMENT (13-CONTEXT.md locked decision, CLOSED Phase 14 Plan 04
// Task 2): the 4 blank scaffolds plus the 3 discovered same-class pieces
// above were a documented, VISIBLE expected-fail set — CAUTION with
// KNOWN-FAILING evidence, never a silent skip or a weakened threshold —
// while Phase 14's player+rest-state work migrated each one in turn. All 9
// animated pieces now carry a legible rest state; KNOWN_FAILING_AT_REST is
// EMPTY below and the special-cased CAUTION branch has been REMOVED from
// run() — every animated piece's frame-0 blankness is now unconditionally a
// VIOLATION, forever (scripts/tests/integration/at-rest-known-failing.test.mjs
// pins KNOWN_FAILING_AT_REST.size === 0 and asserts all 9 pieces PASS).

import { PNG } from 'pngjs';

export const name = 'at-rest';
// 'meta' dropped from needs (Phase 14 Plan 04): the removed CAUTION branch
// was this check's only reader of ctx.meta (meta?.slug against the now-
// permanently-empty KNOWN_FAILING_AT_REST) — every remaining check here
// reads only the live page/frame-0 pixels.
export const needs = ['page'];

const HEADLINE_OPACITY_MIN = 0.5;
const ATTRIBUTION_OPACITY_MIN = 0.3;
const INK_COVERAGE_MIN = 0.02; // 2%
const BG_SAMPLE_DELTA = 12; // per-channel

// The 4 scaffolds (13-CONTEXT.md's enumerated set) plus the 3 pre-existing
// same-class pieces discovered on this check's first full-verify run (see
// the measured table above) whose frame-0 blankness was a deliberate
// enter-animation start; their honest fix IS Phase 14's self-playing player
// (13-CONTEXT.md). NEVER add entries to quiet a failure on new work: every
// historical entry below predated the at-rest check itself, and this set
// must stay EMPTY going forward — a blank-at-rest piece is now always a
// VIOLATION (see run()'s removed CAUTION branch, header note above).
//
// 'beeswarm-animated' REMOVED (Phase 14 Plan 02): rest-state redesign
// (frame 0 is now a truthful dot-strip, each dot at its own true x(d.value),
// lanes collapsed to their center line) + player wiring landed; gate --deep
// confirms at-rest PASS (headline opacity 1.00, ink coverage 2.33%), no
// KNOWN-FAILING caution.
//
// 'bump-animated' and 'calendar-heatmap-animated' REMOVED (Phase 14 Plan 03
// Task 1): rest-state redesign (frame 0 is now an honest partial reveal --
// 50%/30% of the real chronological range already drawn, REST_FLOOR in each
// src) + player wiring landed; gate --deep confirms at-rest PASS on both
// (headline opacity 1.00, ink coverage 2.28% each -- bump-animated's own
// thin-line chart naturally tops out near ~2.7-2.8% ink even fully revealed,
// so 2.28% is a comfortable margin above the 2% floor for this piece).
//
// 'streamgraph-animated' REMOVED (Phase 14 Plan 03 Task 2): same recipe
// (REST_FLOOR 0.3 partial reveal + player wiring); gate --deep confirms
// at-rest PASS (headline opacity 1.00, ink coverage 7.40% -- area fill gives
// far more margin than the two line-based scaffolds above). Register was 3
// -- only the 3 non-scaffold pieces (co2-keeling-animated,
// world-electricity-mix-streamgraph, quakes-2025-calendar) awaited Plan
// 14-04's migration sweep. All 6 animated scaffolds are migrated.
//
// 'co2-keeling-animated' REMOVED (Phase 14 Plan 04 Task 1): this v1.0 proof
// piece has NO src (hand-authored, predates the scaffold system) -- edited
// the built HTML directly. Rest-state redesign: headline/dek enter-fade
// removed entirely (legible at frame 0 by construction, CSS only); the
// Keeling-curve reveal floored via REST_FLOOR=0.65 (t = REST_FLOOR +
// (1-REST_FLOOR)*rampProgress, reaching exactly 1 at the same frame as
// before -- zero effect on the hold window). REST_FLOOR alone tops out at
// only ~2.12% ink even fully revealed (this is the sparsest animated piece
// in the atlas -- a single thin line + generous margins, unlike bump's
// ~10-line or streamgraph's filled-area charts), so the data-line's
// stroke-width was also bumped 2->3 (a modest, honest legibility increase)
// to clear the 2% floor with real margin. Player wired (attachPlayer,
// resolve:'hold'). gate --deep confirms at-rest PASS (headline opacity
// 1.00, ink coverage 2.10%). Register was 2 -- only the 2 curated gallery
// candidates (world-electricity-mix-streamgraph, quakes-2025-calendar)
// remained.
//
// 'world-electricity-mix-streamgraph' and 'quakes-2025-calendar' REMOVED
// (Phase 14 Plan 04 Task 2, the register-emptying task): both regenerated
// via regenerateFromDemoBinding from their now-migrated scaffold srcs
// (scaffolds/src/{streamgraph,calendar-heatmap}-animated.src.html -- same
// demo data, so the rebuilt HTML inherits 14-03's REST_FLOOR rest states +
// player wiring automatically, zero piece-specific redesign needed). gate
// --deep confirms at-rest PASS on both (headline opacity 1.00; ink coverage
// 7.40%/2.28%, matching their source scaffolds exactly). REGISTER NOW
// EMPTY (FIX-04 satisfied) -- the CAUTION branch below has been removed
// from run(); every animated piece's blank-at-rest is unconditionally a
// VIOLATION from this point on.
export const KNOWN_FAILING_AT_REST = new Set([]);

async function renderFrameZeroSettled(page) {
  await page.evaluate(() => window.__viz.renderFrame(0));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.screenshot();
}

// Per-piece background reference (most-frequent sampled pixel) — MUST be
// per-piece, never the house paper token: tier-3 ambient pieces render on a
// dark ambientDark ground (scripts/design/tokens.mjs).
function backgroundReference(png) {
  const { data } = png;
  const freq = new Map();
  for (let i = 0; i < data.length; i += 4 * 7) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [key, count] of freq) {
    if (count > bestCount) {
      bestCount = count;
      best = key.split(',').map(Number);
    }
  }
  return best ?? [0, 0, 0];
}

function inkCoverageFraction(png) {
  const { width, height, data } = png;
  const [bgR, bgG, bgB] = backgroundReference(png);
  let diffCount = 0;
  const totalPixels = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (
      Math.abs(r - bgR) > BG_SAMPLE_DELTA ||
      Math.abs(g - bgG) > BG_SAMPLE_DELTA ||
      Math.abs(b - bgB) > BG_SAMPLE_DELTA
    ) {
      diffCount++;
    }
  }
  return diffCount / totalPixels;
}

export async function run(ctx) {
  const { page } = ctx;

  // Mirrors loop-continuity:62-64 — needed for --check runs, which never
  // consult isApplicable()/ANIMATED_ONLY.
  const kind = await page.evaluate(() => window.__viz?.kind);
  if (kind !== 'animated') {
    return { name, severity: 'PASS', evidence: 'static piece — at-rest not applicable' };
  }

  const shot = await renderFrameZeroSettled(page);

  const domState = await page.evaluate(() => {
    const read = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { opacity: Number(s.opacity), visibility: s.visibility, display: s.display };
    };
    return {
      headline: read(document.getElementById('headline')),
      attribution: read(document.querySelector('.viz-attribution')),
    };
  });

  const problems = [];

  if (!domState.headline) {
    problems.push('#headline element missing at frame 0');
  } else {
    const { opacity, visibility, display } = domState.headline;
    if (visibility === 'hidden' || display === 'none') {
      problems.push(`#headline not rendered at frame 0 (visibility=${visibility}, display=${display})`);
    } else if (!(opacity >= HEADLINE_OPACITY_MIN)) {
      problems.push(`#headline opacity ${opacity.toFixed(2)} < ${HEADLINE_OPACITY_MIN} at frame 0`);
    }
  }

  if (!domState.attribution) {
    problems.push('.viz-attribution element missing at frame 0');
  } else {
    const { opacity, visibility, display } = domState.attribution;
    if (visibility === 'hidden' || display === 'none') {
      problems.push(`.viz-attribution not rendered at frame 0 (visibility=${visibility}, display=${display})`);
    } else if (!(opacity >= ATTRIBUTION_OPACITY_MIN)) {
      problems.push(`.viz-attribution opacity ${opacity.toFixed(2)} < ${ATTRIBUTION_OPACITY_MIN} at frame 0`);
    }
  }

  const png = PNG.sync.read(shot);
  const inkCoverage = inkCoverageFraction(png);
  if (!(inkCoverage >= INK_COVERAGE_MIN)) {
    problems.push(`ink coverage ${(inkCoverage * 100).toFixed(2)}% < ${(INK_COVERAGE_MIN * 100).toFixed(0)}% at frame 0`);
  }

  const headlineOpacityStr = domState.headline ? domState.headline.opacity.toFixed(2) : 'n/a';
  const measured = `headline opacity=${headlineOpacityStr}, ink coverage=${(inkCoverage * 100).toFixed(2)}%`;

  if (problems.length === 0) {
    return { name, severity: 'PASS', evidence: `frame 0 legible (${measured})` };
  }

  const evidence = `${problems.join(' | ')} (${measured})`;

  // Full enforcement (Phase 14 Plan 04, FIX-04): the staged CAUTION branch
  // that used to consult KNOWN_FAILING_AT_REST here has been removed —
  // the register is permanently empty (see the const above) and every
  // animated piece's frame-0 blankness is unconditionally a VIOLATION.
  return { name, severity: 'VIOLATION', evidence };
}
