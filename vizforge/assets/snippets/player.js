// assets/snippets/player.js
//
// attachPlayer(viz) — Phase 14 (LIVE-01/02/03/04): the single self-playing
// engine + play/pause control every animated piece inlines, called
// explicitly right after createViz(...) (the codebase's "never silent"
// convention — no assembler magic, no implicit wiring). Designed to be
// INLINED into a piece's single HTML file, not imported at runtime
// (PIPE-01), exactly like assets/snippets/harness.js.
//
// Frame index is derived from performance.now() deltas at the piece's
// declared fps — NEVER a self-incrementing counter, NEVER a second
// animation authority (no CSS animations, no tween lib). This is what
// makes the player provably safe under the capture flag: the ONLY thing
// that ever touches the canvas/DOM is viz.renderFrame(i), the same pure
// function capture.mjs's explicit frame-stepping calls.
//
// See docs/determinism.md's "rAF under the frozen capture clock" section
// (Phase 14 Plan 01 spike) for why the synchronous __VIZFORGE_CAPTURE__
// check below is the SOLE isolation mechanism, not defense-in-depth:
// page.clock.install({ time: 0 }) does NOT actually freeze
// performance.now()/rAF in this codebase's Playwright build.

/**
 * attachPlayer(viz)
 *
 * @param {object} viz - the live window.__viz contract object (from
 *   createViz()). Reads viz.fps, viz.totalFrames, viz.renderFrame,
 *   viz.resolve ('loop'|'hold', optional), viz.ready, viz.kind.
 */
export function attachPlayer(viz) {
  // LIVE-04: decided SYNCHRONOUSLY, before ANY DOM/listener/rAF work, so
  // captures stay chrome-free with zero first-frame flash and zero risk of
  // racing capture.mjs's own explicit renderFrame(i) calls.
  if (window.__VIZFORGE_CAPTURE__) return;

  // A static piece (fps 0, totalFrames 1) has nothing to play — guards
  // against a piece accidentally calling attachPlayer on a non-animated
  // __viz (msPerFrame would be Infinity otherwise).
  if (viz.kind !== 'animated') return;

  let resolveMode = viz.resolve;
  if (resolveMode === undefined) {
    // Never silent (codebase ethos) — names the piece contract gap loudly
    // instead of a quietly-wrong default, so a migration that forgot to
    // pass `resolve` to createViz() is caught immediately.
    console.warn(
      'attachPlayer: viz.resolve is not set on this piece\'s __viz contract — defaulting to "hold". ' +
        "Pass resolve: 'loop' | 'hold' to createViz()."
    );
    resolveMode = 'hold';
  }

  const msPerFrame = 1000 / viz.fps;
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let playing = false;
  let rafId = null;
  let animStartTime = 0; // performance.now() value corresponding to elapsed=0 for the CURRENT play session
  let pausedElapsed = 0; // elapsed ms accumulated across all previous play sessions, frozen while paused
  // The piece's own bootstrap has already rendered frame 0 (createViz()
  // callers call renderFrame(0) before attachPlayer runs) — starting here
  // avoids a redundant, wasted re-render of frame 0 on the very first tick.
  let lastRenderedFrame = 0;
  let holdComplete = false;

  let toggleButton = null;

  function computeFrame(elapsed) {
    const raw = Math.floor(elapsed / msPerFrame);
    if (resolveMode === 'loop') {
      return ((raw % viz.totalFrames) + viz.totalFrames) % viz.totalFrames;
    }
    // hold: clamp at the final frame — never negative, never past the end.
    return Math.min(Math.max(raw, 0), viz.totalFrames - 1);
  }

  function tick() {
    const elapsed = performance.now() - animStartTime;
    const frame = computeFrame(elapsed);
    if (frame !== lastRenderedFrame) {
      viz.renderFrame(frame);
      lastRenderedFrame = frame;
    }
    if (resolveMode === 'hold' && frame >= viz.totalFrames - 1) {
      // Halts the loop once the final frame renders — never schedules
      // another rAF past this point (battery pitfall).
      playing = false;
      holdComplete = true;
      rafId = null;
      updateControl();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    if (holdComplete) {
      // Reactivating the control after a hold piece completed replays
      // from frame 0, not from the held final frame.
      holdComplete = false;
      pausedElapsed = 0;
      lastRenderedFrame = -1;
    }
    playing = true;
    animStartTime = performance.now() - pausedElapsed;
    rafId = requestAnimationFrame(tick);
    updateControl();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    pausedElapsed = performance.now() - animStartTime;
    updateControl();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  // --- Control: one small button, house label type, text/glyph only ---
  // No pills/cards/borders/box-shadow/text-shadow/backdrop-filter (craft
  // law + pattern-scan hard-fail bans), no decorative rule lines (Jon's
  // global rule) — a plain de-emphasized text control, same opacity
  // treatment as assets/snippets/attribution.js's footer, positioned
  // fixed at a corner so it never collides with the (in-flow) attribution
  // footer regardless of a piece's own layout.
  function injectStyle() {
    if (document.getElementById('viz-player-style')) return;
    const style = document.createElement('style');
    style.id = 'viz-player-style';
    style.textContent = `
      .viz-player-toggle {
        position: fixed;
        bottom: 10px;
        right: 10px;
        z-index: 10;
        margin: 0;
        padding: 2px 6px;
        border: none;
        background: transparent;
        font-family: var(--font-label, "Inter", sans-serif);
        font-size: var(--size-annotation, 0.75rem);
        font-weight: 600;
        color: var(--color-ink, #171b22);
        opacity: 0.55;
        cursor: pointer;
      }
      .viz-player-toggle:hover,
      .viz-player-toggle:focus-visible {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function updateControl() {
    if (!toggleButton) return;
    const label = playing ? 'Pause' : 'Play';
    toggleButton.textContent = label;
    toggleButton.setAttribute('aria-label', `${label} animation`);
  }

  function buildControl() {
    injectStyle();
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'viz-player-toggle';
    toggleButton.addEventListener('click', toggle);
    // Native <button> already handles Space/Enter keyboard activation —
    // no separate keydown handler needed.
    // Appended INSIDE the piece's own `.viz` root, never document.body —
    // so the control correctly inherits any SCOPED custom-property override
    // that root carries (e.g. .tier3-ambient's dark --color-ink). Appending
    // to document.body (outside that scope) left the control rendering the
    // default LIGHT-mode ink color on the dark ambient ground -- dark ink
    // on a dark background, effectively invisible (Phase 14 Plan 03,
    // verified on ambient-sculpture-animated: computed color was
    // oklch(0.22 ...), the light-mode ink, not the ambientDark
    // oklch(0.93 ...) override). `position: fixed` still positions relative
    // to the viewport regardless of this DOM nesting (`.viz` sets no
    // transform/filter/perspective), so every other piece's control is
    // unaffected. Falls back to document.body for any fixture/piece with no
    // `.viz` root (e.g. the player-unit fixture).
    (document.querySelector('.viz') || document.body).appendChild(toggleButton);
    updateControl();
  }

  // Public surface — the introspection handle autoplay tests sample.
  window.__vizPlayer = {
    play,
    pause,
    toggle,
    get playing() {
      return playing;
    },
    get frame() {
      // Never exposes the internal "-1 forces a re-render" sentinel used
      // right after a hold-complete replay restart (see play()) — the
      // very next tick always renders frame 0 before any observer could
      // otherwise notice a stale value.
      return lastRenderedFrame < 0 ? 0 : lastRenderedFrame;
    },
  };

  viz.ready.then(() => {
    buildControl();
    if (reducedMotion) {
      // Rest state (LOCKED decision, 14-CONTEXT.md): opens PAUSED at
      // frame 0 — the piece's own bootstrap already rendered it — never
      // the final frame. The control still renders, allowing manual play.
      updateControl();
      return;
    }
    play();
  });
}
