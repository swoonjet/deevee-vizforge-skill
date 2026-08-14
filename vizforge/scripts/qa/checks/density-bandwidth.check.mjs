// scripts/qa/checks/density-bandwidth.check.mjs
//
// Density-mark honesty check (19-04, FND-03). Hexbin/contour density
// pieces silently choose a bandwidth or bin-size that materially changes
// the apparent shape of the distribution (the histogram-binwidth-equivalent
// honesty rule from research) — undisclosed, a reader has no way to know
// how much smoothing/binning shaped what they're seeing. This check
// mechanically requires the bandwidth/bin-size be both declared in meta AND
// disclosed in the rendered methodology note.
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors geo-honesty
// .check.mjs / radial-baseline.check.mjs): real work only when
// meta.family==='density' (hexbin/contour). Absence of `family` (every one
// of the 34 existing scaffolds) returns PASS-inert.
//
// When applicable, VIOLATION unless meta.density.bandwidth (or
// meta.density.binSize) is a positive number AND meta.density.disclosure is
// a non-empty string naming it, whose non-digit fragments all appear
// verbatim in the rendered text (disclosure-fragment substring idiom, see
// baseline-honesty.check.mjs).
//
// WHICH DISCLOSURE: the piece's own live `window.__viz.density.disclosure` where
// it declares one, and `meta.density.disclosure` only when it stays silent.
//
// A wizard job's meta is deriveRenderMeta's CLONE of the demo piece's sidecar,
// so the sidecar's sentence belongs to the DEMO's render. Demanding it of a
// reader's own render is the fault that 404'd four techniques through
// baseline-honesty; it was latent here only because hexbin's `methodNote`
// default is still demo-worded. The BANDWIDTH stays on the sidecar — it is a
// number the shaper computed, not prose, and it is what a fast pre-check is for.
//
// Not a loosening: a declared sentence must still be found VERBATIM in what was
// rendered. geo-honesty.check.mjs carries the identical arrangement.

export const name = 'density-bandwidth';
export const needs = ['meta', 'viz', 'html'];

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

export async function run(ctx) {
  const meta = ctx.meta ?? {};
  const density = meta.density ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  if (meta.family !== 'density') {
    return {
      name,
      severity: 'PASS',
      evidence: 'not a density-family piece — density-bandwidth not applicable',
    };
  }

  const violations = [];

  // The piece's own sentence, where it declares one. A declared stub is
  // rejected rather than trusted, so silence is the only way to fall back.
  const live = ctx.viz && ctx.viz.density ? ctx.viz.density : null;
  const declared = live && typeof live.disclosure === 'string' ? live.disclosure : null;
  let source = 'meta.json';
  let disclosure = density.disclosure;
  if (declared !== null) {
    if (declared.trim().length < 24) {
      violations.push(
        `the piece declares density.disclosure:${JSON.stringify(declared)}, which is too short to be a `
        + 'disclosure (needs 24+ characters)'
      );
    } else {
      disclosure = declared;
      source = 'the rendered piece';
    }
  }

  const bandwidth = density.bandwidth;
  const binSize = density.binSize;
  const hasBandwidth = typeof bandwidth === 'number' && bandwidth > 0;
  const hasBinSize = typeof binSize === 'number' && binSize > 0;

  if (!hasBandwidth && !hasBinSize) {
    violations.push(
      `density piece requires bandwidth/bin-size disclosed in meta + rendered methodology — meta.density.bandwidth/binSize must be a positive number (got bandwidth:${JSON.stringify(bandwidth)}, binSize:${JSON.stringify(binSize)})`
    );
  }

  if (typeof disclosure !== 'string' || disclosure.length === 0) {
    violations.push(
      'density piece requires a non-empty density.disclosure string naming the bandwidth/bin-size'
    );
  } else {
    const fragments = disclosureStaticFragments(disclosure);
    const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
    if (missingFragments.length > 0) {
      violations.push(
        `bandwidth/bin-size disclosure text (from ${source}) not found verbatim in the rendered piece — missing fragment(s): ${missingFragments
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
    evidence: `density-family piece declares a positive bandwidth/bin-size (bandwidth:${JSON.stringify(bandwidth)}, binSize:${JSON.stringify(binSize)}) with disclosure fragments (declared by ${source}) found verbatim in rendered piece`,
  };
}
