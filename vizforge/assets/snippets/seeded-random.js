// assets/snippets/seeded-random.js
//
// mulberry32 — small, known-good, deterministic PRNG. Not npm-installed:
// inlined per-piece so every self-contained HTML file has zero external
// dependency (PIPE-01). Any randomness in a piece MUST be seeded through
// this generator, never Math.random() — determinism requires two
// consecutive renders of the same piece to be pixel-identical.
//
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime.

/**
 * Returns a deterministic PRNG function seeded by `seed`. Call the
 * returned function repeatedly to get a stream of floats in [0, 1).
 *
 * const rand = mulberry32(42);
 * rand(); rand(); rand(); // reproducible sequence for seed 42
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
