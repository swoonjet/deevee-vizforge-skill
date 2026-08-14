// scripts/qa/checks/area-encoding.check.mjs
//
// Area-mark honesty check (19-03, FND-03). Radius-based area marks (bubble,
// treemap, circle-pack, rose, cartogram) must encode area=value — i.e.
// radius = sqrt(value) — never radius=value, which doubles the perceived
// magnitude of differences (docs/honesty-rules.md's Area rule;
// assets/snippets/scale-helpers.js's sqrtRadius() is the honest helper).
// This check is the mechanical, gate-blocking version of that rule.
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors at-rest.check.mjs):
// real work only when meta.encoding.channel==='area' AND a NEW
// meta.encoding.areaMark==='radius' sub-field is also set. Deliberately NOT
// keyed off plain channel:'area' alone — 8 existing scaffolds (streamgraph/
// horizon/area/sankey/chord/waffle/waffle-glyph) legitimately use
// channel:'area' for BAND area (stacked-area fills, not a radius-based
// mark) and must stay untouched by this check. `areaMark` is the new signal
// only radius-based marks declare; its absence (or any value other than
// 'radius') returns PASS-inert.
//
// When applicable, three independent assertions — ALL must hold, mirroring
// baseline-honesty.check.mjs's three-part structure:
//   (a) meta.encoding.areaScaling === 'sqrt' — the declared formula. This is
//       the one the check exists to catch: areaScaling:'linear' (or
//       missing) is the radius=value lie.
//   (b) window.__viz.encoding.areaScaling === 'sqrt' — the LIVE runtime
//       mirrors the declaration (drift check, never an unverified duplicate
//       of the static meta.json).
//   (c) a rendered disclosure states the area=value relationship —
//       meta.encoding.areaDisclosure, checked via the disclosure-fragment
//       substring idiom (baseline-honesty.check.mjs (c): split on digit
//       runs, every non-empty fragment must appear verbatim in the rendered
//       text — a distinct field from the baseline `disclosure` string so
//       the two concerns never collide on a piece that needs both).

export const name = 'area-encoding';
export const needs = ['meta', 'viz', 'html'];

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

export async function run(ctx) {
  const metaEnc = ctx.meta?.encoding ?? {};
  const vizEnc = ctx.viz?.encoding ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  if (!(metaEnc.channel === 'area' && metaEnc.areaMark === 'radius')) {
    return {
      name,
      severity: 'PASS',
      evidence: 'not a radius-based area mark — area-encoding not applicable',
    };
  }

  const violations = [];

  // (a) declared formula.
  if (metaEnc.areaScaling !== 'sqrt') {
    violations.push(
      `radius=value area encoding — radius-based area marks require area=value (encoding.areaScaling:'sqrt'); got areaScaling:${JSON.stringify(metaEnc.areaScaling)}`
    );
  }

  // (b) live-runtime drift.
  if (vizEnc.areaScaling !== 'sqrt') {
    violations.push(
      `areaScaling declaration drift — meta.json declares areaScaling:${JSON.stringify(metaEnc.areaScaling)} but rendered piece reports areaScaling:${JSON.stringify(vizEnc.areaScaling)}`
    );
  }

  // (c) rendered disclosure.
  const disclosure = metaEnc.areaDisclosure;
  if (typeof disclosure !== 'string' || disclosure.length === 0) {
    violations.push(
      "radius-based area mark requires a non-empty encoding.areaDisclosure string stating area=value / radius=√value"
    );
  } else {
    const fragments = disclosureStaticFragments(disclosure);
    const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
    if (missingFragments.length > 0) {
      violations.push(
        `area=value disclosure text not found verbatim in the rendered piece — missing fragment(s): ${missingFragments
          .map((f) => JSON.stringify(f))
          .join(', ')}`
      );
    }
  }

  if (violations.length > 0) {
    return { name, severity: 'VIOLATION', evidence: violations.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: "radius-based area mark declares + renders area=value (areaScaling:'sqrt'); disclosure fragments found verbatim in rendered piece",
  };
}
