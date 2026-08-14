// scripts/lib/browser-launch-args.mjs
//
// RENDER-04 (Phase 9, Plan 01): the single canonical Chromium launch-args
// array — imported by EVERY product/QA launch site (scripts/capture.mjs,
// scripts/qa/checks/session.mjs, app/lib/live-gate.mjs,
// scripts/qa/tnum-check.mjs) so `--deep` is trustworthy from the CLI and
// (in later Phase 9 plans) from the pooled render service. No launch site
// may carry its own separate flag list — see docs/determinism.md for the
// full investigation this flag set resolves.
//
// Root cause (docs/determinism.md has the full evidence trail): the
// scaffolds' canvas-2D trajectory/point precompute is fully synchronous
// (refuted lazy-precompute hypothesis); captureFrames/openPiece's
// renderFrame(i) is driven purely by the passed frame index (refuted
// wall-clock leakage); gate.mjs's runDeterminismCheck sessions are fully
// independent (refuted shared-state hypothesis). The remaining and
// confirmed cause is Chromium's own async compositor/raster SCHEDULING —
// page.screenshot() can race threaded compositing, checker-imaging, and
// vsync-timed surface presentation under genuine host CPU contention
// (exactly what many concurrent Playwright sessions produce). The SwiftShader
// software rasterization backend was already deterministic; these flags
// close the separate async-scheduling race, not a rendering-backend choice.
export const DETERMINISM_LAUNCH_ARGS = [
  // Forces the compositor to run its FULL pipeline (commit, raster, activate)
  // to completion before every draw, instead of allowing a still-settling
  // frame to be presented/captured.
  '--run-all-compositor-stages-before-draw',
  // Disables checker-imaging (async placeholder-then-backfill decoding of
  // images under memory pressure) — a documented source of an occasionally
  // incompletely-decoded frame under host contention.
  '--disable-features=CheckerImaging',
  // Disables animated-image resync heuristics that can skip/duplicate a
  // frame under scheduling pressure.
  '--disable-image-animation-resync',
  // Forces animation ticking onto the main thread instead of the (async,
  // scheduling-order-nondeterministic-under-contention) compositor thread.
  '--disable-threaded-animation',
  // Forces scroll handling onto the main thread for the same reason —
  // removes another async-scheduling source, even though this project's
  // scaffolds do not scroll (defense-in-depth, matches the documented flag
  // set as a unit).
  '--disable-threaded-scrolling',
];
