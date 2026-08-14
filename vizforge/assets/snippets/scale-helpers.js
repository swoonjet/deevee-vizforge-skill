// assets/snippets/scale-helpers.js
//
// Per-encoding-channel honesty helpers (CRAFT-06 / docs/honesty-rules.md).
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01).

/**
 * Length encodings (bar/area height, etc.) MUST include zero in the
 * domain — truncating a length axis silently exaggerates the visual ratio
 * between values. Returns [0, niceMax].
 */
export function lengthEncodingDomain(values) {
  const max = Math.max(...values, 0);
  if (max <= 0) return [0, 1];
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / magnitude) * magnitude;
  return [0, niceMax];
}

/**
 * Position/line encodings MAY legitimately use a non-zero baseline (e.g.
 * viewing volatility in a price series) — but that choice must be
 * disclosed in the piece's methodology note (docs/honesty-rules.md).
 * Returns a padded domain around the actual value range.
 */
export function positionEncodingDomain(values, { padRatio = 0.08 } = {}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = span * padRatio;
  return [min - pad, max + pad];
}

/**
 * Area-honest bubble radius: area must encode value, so radius = sqrt(value),
 * never radius = value directly (which doubles the perceived magnitude of
 * differences). Returns a radius scaled so the largest value maps to
 * maxRadius.
 */
export function sqrtRadius(value, maxValue, maxRadius) {
  if (maxValue <= 0) return 0;
  const ratio = Math.max(0, value) / maxValue;
  return Math.sqrt(ratio) * maxRadius;
}
