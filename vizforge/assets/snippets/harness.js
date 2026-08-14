// assets/snippets/harness.js
//
// window.__viz harness contract boilerplate (PIPE-02/03, MOTION-01/02).
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01).
//
// Contract (verbatim — every piece exposes exactly this shape):
//
//   __viz = {
//     kind: 'static' | 'animated',
//     fps,
//     totalFrames,
//     ready: Promise,                 // resolves after fonts + first paint
//     renderFrame(i) /* pure, deterministic, idempotent per i */,
//     scales(): { x: [min, max], y: [min, max] },
//     encoding: {
//       channel: 'position' | 'length' | 'area' | 'angle' | 'color',
//       baselineZero: boolean,
//       baselineDisclosed: boolean,
//     },
//     resolve?: 'loop' | 'hold',       // Phase 14 (LIVE-01/02): how
//                                      // assets/snippets/player.js's
//                                      // attachPlayer resolves the final
//                                      // frame boundary. Purely additive —
//                                      // static pieces and animated pieces
//                                      // not yet migrated to the player omit
//                                      // it entirely (undefined, never a
//                                      // placeholder value). 'loop' wraps
//                                      // seamlessly (i mod totalFrames);
//                                      // 'hold' plays once and rests on the
//                                      // final frame. Mirrored by
//                                      // scripts/qa/checks/animation-meta.check.mjs's
//                                      // staged meta.resolve === live.resolve
//                                      // assertion (when live.resolve is
//                                      // present).
//   }
//
// `ready` awaits document.fonts.ready plus an explicit document.fonts.load(...)
// for each entry in fontsToLoad — this covers the Canvas-specific footgun
// where document.fonts.ready alone does NOT guarantee a <canvas>
// fillText/strokeText call will use the custom font (Canvas silently falls
// back to a system font with zero error if drawing happens too early).

/**
 * Builds and assigns window.__viz per the harness contract.
 *
 * @param {object} opts
 * @param {'static'|'animated'} opts.kind
 * @param {number} [opts.fps=0]
 * @param {number} [opts.totalFrames=1]
 * @param {(i: number) => void} [opts.renderFrame]
 * @param {() => { x: [number, number], y: [number, number] }} opts.scales
 * @param {{ channel: string, baselineZero: boolean, baselineDisclosed: boolean }} opts.encoding
 * @param {string[]} [opts.fontsToLoad] - CSS font shorthand strings, e.g. '600 40px "Space Grotesk"'
 * @param {'loop'|'hold'} [opts.resolve] - Phase 14 (LIVE-01/02): how
 *   attachPlayer resolves the final frame boundary. Omit entirely for
 *   static pieces and not-yet-migrated animated pieces — never pass a
 *   placeholder value.
 */
export function createViz({
  kind,
  fps = 0,
  totalFrames = 1,
  renderFrame = () => {},
  scales,
  encoding,
  fontsToLoad = [],
  resolve,
  geo,
  density,
}) {
  const ready = (async () => {
    await document.fonts.ready;
    // Canvas-specific footgun — only matters if this piece draws text on
    // <canvas>, but is harmless (a no-op) for SVG/DOM-only pieces.
    if (fontsToLoad.length > 0) {
      await Promise.all(fontsToLoad.map((f) => document.fonts.load(f)));
    }
    // One rAF tick so the first paint has actually happened before capture
    // reads state.
    // (Named `resolveReady`, not `resolve` — this createViz() now also
    // accepts an opts.resolve param ('loop'|'hold'); shadowing it here
    // would be needlessly confusing even though this closure never reads
    // the outer value.)
    await new Promise((resolveReady) => requestAnimationFrame(() => resolveReady(true)));
    return true;
  })();

  window.__viz = {
    kind,
    fps,
    totalFrames,
    ready,
    renderFrame,
    scales,
    encoding,
  };

  // Purely additive: only assigned when actually passed, so unmigrated
  // animated pieces and every static piece keep window.__viz.resolve as
  // undefined (never a placeholder like 'hold') — animation-meta.check.mjs's
  // mirror assertion is staged specifically on this distinction.
  if (resolve !== undefined) {
    window.__viz.resolve = resolve;
  }

  // THE DISCLOSURE SENTENCES THIS RENDER ACTUALLY PRINTED, same additive
  // convention as `resolve` above: absent unless the piece passes them, so a
  // piece that says nothing leaves geo-honesty and density-bandwidth reading the
  // sidecar exactly as before.
  //
  // They exist because a wizard job's meta sidecar is a CLONE of the demo
  // piece's, so the sentence in it belongs to a different render — the fault that
  // 404'd four techniques through baseline-honesty's own version of this. Only
  // PROSE travels here; projection, classification and bandwidth stay in the
  // sidecar because they are properties of the form and do not vary with the data.
  if (geo !== undefined) {
    window.__viz.geo = geo;
  }
  if (density !== undefined) {
    window.__viz.density = density;
  }

  return window.__viz;
}
