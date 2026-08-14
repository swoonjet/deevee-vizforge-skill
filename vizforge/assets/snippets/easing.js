// assets/snippets/easing.js
//
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01 — every piece is one self-contained file). Copy this
// module's contents directly into a piece's <script type="module"> block.
//
// Motion grammar: sine ease-in-out only (MOTION-01 / docs/motion-grammar.md).

/**
 * Sine ease-in-out, t in [0, 1] -> eased value in [0, 1].
 * The house easing curve — never linear, never bounce/elastic/back.
 */
export function sineInOut(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * Maps a frame index into a clamped 0..1 progress value for the segment
 * [startFrame, endFrame). Use this inside renderFrame(i) to drive any
 * enter/update/exit transition as a pure function of the frame index —
 * never as a CSS transition (see docs/motion-grammar.md, Pitfall 3).
 */
export function segmentProgress(frame, startFrame, endFrame) {
  if (endFrame <= startFrame) return frame >= startFrame ? 1 : 0;
  const raw = (frame - startFrame) / (endFrame - startFrame);
  return Math.max(0, Math.min(1, raw));
}
