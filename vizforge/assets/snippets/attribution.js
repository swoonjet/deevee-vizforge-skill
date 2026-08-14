// assets/snippets/attribution.js
//
// Source-line / footer block builder (CRAFT-03 — docs/titling-attribution.md).
// Designed to be INLINED into a piece's single HTML file, not imported at
// runtime (PIPE-01).
//
// Positioned by space, not by a decorative rule line — never add a
// border-top or a horizontal-rule element above this block (docs/craft-law.md).
// (Deliberately not spelling out the literal banned element tag in this
// comment: any piece that inlines this file's source verbatim would
// otherwise trip pattern-scan.mjs's hard-fail detector on the comment text
// itself, not on real markup.)

/**
 * Returns an HTML string for the source-line block: IBM Plex Mono,
 * --size-source, ink at reduced opacity. `source` and `methodology` are
 * required; `note` is optional (e.g. a disclosed non-zero baseline caveat).
 */
export function attributionFooter({ source, methodology, note }) {
  const parts = [`Source: ${escapeHtml(source)}`];
  if (methodology) parts.push(escapeHtml(methodology));
  if (note) parts.push(escapeHtml(note));

  return `<div class="viz-attribution" style="
    font-family: var(--font-figures);
    font-size: var(--size-source);
    line-height: var(--line-source);
    color: var(--color-ink);
    opacity: 0.6;
  ">${parts.join(' &middot; ')}</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
