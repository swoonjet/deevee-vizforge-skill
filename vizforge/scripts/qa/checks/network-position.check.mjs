// scripts/qa/checks/network-position.check.mjs
//
// Network-mark honesty check (19-04, FND-03). Node-link/arc/matrix pieces
// invite a specific perceptual lie: treating 1D or 2D POSITION as if it
// were a quantitative channel (as though nearness/order encoded magnitude),
// when position in these layouts is really just an arrangement decision
// (force-directed settle, 1D arc ordering, or matrix seriation) with no
// intrinsic scale. This check requires (a) a rendered disclosure stating
// position is not a quantitative channel, (b) a rendered disclosure naming
// the ordering/seriation method actually used, and (c) that magnitude
// itself is declared via a real quantitative channel (node-area or
// edge-width), never position.
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors density-bandwidth
// .check.mjs / geo-honesty.check.mjs): real work only when
// meta.family==='network' (arc/matrix/node-link). Chord/sankey are
// relational-FLOW diagrams and do NOT set family:'network', so they stay
// untouched. Absence of `family` (every one of the 34 existing scaffolds)
// returns PASS-inert.
//
// When applicable, meta.network = { magnitudeChannel, positionDisclosure,
// orderingDisclosure }, VIOLATION unless ALL of:
//   (a) meta.network.magnitudeChannel is one of 'node-area'|'edge-width'
//       (never 'position' — the primary lie this check exists to catch).
//   (b) meta.network.positionDisclosure is a non-empty string whose
//       non-digit fragments all appear verbatim in the rendered text
//       (disclosure-fragment substring idiom, see baseline-honesty
//       .check.mjs), stating position is not a quantitative channel.
//   (c) meta.network.orderingDisclosure is likewise a non-empty, verbatim-
//       rendered string naming the ordering/seriation method (1D arc order
//       or matrix seriation algorithm).

export const name = 'network-position';
export const needs = ['meta', 'viz', 'html'];

const VALID_MAGNITUDE_CHANNELS = new Set(['node-area', 'edge-width']);

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

function checkDisclosureField(value, haystack, violations, missingLabel, driftLabel) {
  if (typeof value !== 'string' || value.length === 0) {
    violations.push(missingLabel);
    return;
  }
  const fragments = disclosureStaticFragments(value);
  const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
  if (missingFragments.length > 0) {
    violations.push(
      `${driftLabel} — missing fragment(s): ${missingFragments.map((f) => JSON.stringify(f)).join(', ')}`
    );
  }
}

export async function run(ctx) {
  const meta = ctx.meta ?? {};
  const network = meta.network ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  if (meta.family !== 'network') {
    return {
      name,
      severity: 'PASS',
      evidence: 'not a network-family piece — network-position not applicable',
    };
  }

  const violations = [];

  // (a) magnitude must be a real quantitative channel, never position.
  if (!VALID_MAGNITUDE_CHANNELS.has(network.magnitudeChannel)) {
    violations.push(
      `network piece treats position as a quantitative channel — magnitude must be encoded via node-area or edge-width (got magnitudeChannel:${JSON.stringify(network.magnitudeChannel)})`
    );
  }

  // (b) position-is-not-a-channel disclosure.
  checkDisclosureField(
    network.positionDisclosure,
    haystack,
    violations,
    'network piece requires a non-empty meta.network.positionDisclosure stating position is not a quantitative channel',
    'position-is-not-a-channel disclosure text not found verbatim in the rendered piece'
  );

  // (c) ordering/seriation-method disclosure.
  checkDisclosureField(
    network.orderingDisclosure,
    haystack,
    violations,
    'network piece omits ordering disclosure — requires a non-empty meta.network.orderingDisclosure naming the ordering/seriation method',
    'ordering/seriation disclosure text not found verbatim in the rendered piece'
  );

  if (violations.length > 0) {
    return { name, severity: 'VIOLATION', evidence: violations.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `network-family piece encodes magnitude via ${network.magnitudeChannel}, not position; position + ordering disclosures found verbatim in rendered piece`,
  };
}
