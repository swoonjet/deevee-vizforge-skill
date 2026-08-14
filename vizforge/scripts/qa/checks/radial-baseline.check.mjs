// scripts/qa/checks/radial-baseline.check.mjs
//
// Radial nonzero-inner-radius baseline-disclosure check (19-03, FND-03).
// Extends the existing radial honesty rule (docs/honesty-rules.md's
// Angle/radial row: radial position exaggerates or hides differences
// depending on where zero sits) into a mechanical, gate-blocking check for
// family:'radial' pieces whose polar layout starts at a nonzero inner
// radius (rose/polar-area) — the baseline MUST be disclosed, never silent.
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors at-rest.check.mjs
// / area-encoding.check.mjs): real work only when meta.family==='radial'.
// Absence of `family` (every one of the 34 existing scaffolds, including
// radial-cyclical — which already discloses its nonzero-radius baseline via
// baseline-honesty.check.mjs's generic channel:'position' disclosure path
// and carries no `family` field) returns PASS-inert.
//
// When applicable, VIOLATION unless meta.encoding.baselineDisclosed===true
// AND the declared encoding.disclosure string's non-digit fragments all
// appear verbatim in the rendered text (reuses baseline-honesty.check.mjs's
// disclosure-fragment substring idiom: split on digit runs, each non-empty
// fragment must be a literal substring of the rendered page text — the real-
// piece disclosure sentence is built around a runtime-computed number, so it
// never sits verbatim in one place in the HTML source). This is a STRONGER
// requirement than baseline-honesty's generic rule (which only mandates
// disclosure for channel:'length', or verifies disclosure text IF
// baselineDisclosed happens to be true) — for the radial family specifically,
// disclosure is mandatory whenever the family signal is set.

export const name = 'radial-baseline';
export const needs = ['meta', 'viz', 'html'];

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

export async function run(ctx) {
  const meta = ctx.meta ?? {};
  const metaEnc = meta.encoding ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  if (meta.family !== 'radial') {
    return {
      name,
      severity: 'PASS',
      evidence: 'not a radial-family piece — radial-baseline not applicable',
    };
  }

  const violations = [];

  if (metaEnc.baselineDisclosed !== true) {
    violations.push(
      `radial piece with a nonzero inner-radius baseline requires baselineDisclosed:true + a rendered baseline disclosure (got baselineDisclosed:${JSON.stringify(metaEnc.baselineDisclosed)})`
    );
  } else {
    const disclosure = metaEnc.disclosure;
    if (typeof disclosure !== 'string' || disclosure.length === 0) {
      violations.push(
        'radial piece with baselineDisclosed:true requires a non-empty encoding.disclosure string'
      );
    } else {
      const fragments = disclosureStaticFragments(disclosure);
      const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
      if (missingFragments.length > 0) {
        violations.push(
          `baseline disclosure text not found verbatim in the rendered piece — missing fragment(s): ${missingFragments
            .map((f) => JSON.stringify(f))
            .join(', ')}`
        );
      }
    }
  }

  if (violations.length > 0) {
    return { name, severity: 'VIOLATION', evidence: violations.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: 'radial-family piece discloses its nonzero inner-radius baseline (baselineDisclosed:true); disclosure fragments found verbatim in rendered piece',
  };
}
