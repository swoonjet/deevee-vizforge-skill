// scripts/qa/checks/negative-geometry.check.mjs
//
// General negative-geometry guard (13-02, FIX-02). Root cause: Phase 13
// found radial-cyclical shipping a real `<circle r="-9.41">` because no
// check ever scanned rendered DOM geometry for negative values — this check
// closes that gap for EVERY piece (static + animated), not just radial
// techniques, so the same bug class can never ship again on any future
// polar/radial/canvas work.
//
// Applies to every piece (NOT animated-only): scans the current DOM state
// for negative r/rx/ry/width/height attributes, rescans at frame 0 for
// animated pieces (frame-dependent geometry can differ from whatever frame
// the shared session screenshot happened to leave the DOM at), and scans
// ctx.consoleErrors for Chromium's negative-attribute parse-error class
// (session.mjs's consoleErrors, captured from load time).
//
// Two independent signals, either one alone is sufficient evidence:
//   1. DOM scan: a negative-value attribute is still readable from the live
//      DOM even when Chromium refuses to paint it (verified empirically:
//      `<circle r="-12">` keeps the literal "-12" in getAttribute('r')).
//   2. Console error: Chromium logs `Error: <tag> attribute X: A negative
//      value is not valid. ("-N")` at parse time for r/rx/ry/width/height.

const GEOMETRY_ATTRS = ['r', 'rx', 'ry', 'width', 'height'];
const CONSOLE_NEGATIVE_RE = /attribute (r|rx|ry|width|height): A negative value is not valid/;
const MAX_LISTED = 5;

export const name = 'negative-geometry';
export const needs = ['page', 'consoleErrors'];

async function scanDom(page) {
  return page.evaluate((attrs) => {
    const hits = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      for (const attr of attrs) {
        if (!el.hasAttribute(attr)) continue;
        const raw = el.getAttribute(attr);
        const value = parseFloat(raw);
        if (Number.isFinite(value) && value < 0) {
          hits.push({ tag: el.tagName.toLowerCase(), attr, value: raw });
        }
      }
    }
    return hits;
  }, GEOMETRY_ATTRS);
}

export async function run(ctx) {
  const { page, consoleErrors } = ctx;

  const domHitsCurrent = await scanDom(page);

  let domHitsFrame0 = [];
  const kind = await page.evaluate(() => window.__viz?.kind);
  if (kind === 'animated') {
    await page.evaluate(() => window.__viz.renderFrame(0));
    domHitsFrame0 = await scanDom(page);
  }

  // De-dupe by tag+attr+value (current-state and frame-0 scans commonly
  // overlap on non-frame-dependent geometry, e.g. static chrome elements).
  const seen = new Set();
  const domHits = [];
  for (const hit of [...domHitsCurrent, ...domHitsFrame0]) {
    const key = `${hit.tag}.${hit.attr}=${hit.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    domHits.push(hit);
  }

  const consoleHits = (consoleErrors ?? []).filter((text) => CONSOLE_NEGATIVE_RE.test(text));

  if (domHits.length === 0 && consoleHits.length === 0) {
    return {
      name,
      severity: 'PASS',
      evidence: 'no negative geometry attributes; no negative-value console errors',
    };
  }

  const parts = [];
  if (domHits.length > 0) {
    const listed = domHits
      .slice(0, MAX_LISTED)
      .map((h) => `<${h.tag}> ${h.attr}="${h.value}"`)
      .join(', ');
    parts.push(`${domHits.length} negative geometry attribute(s) in DOM: ${listed}${domHits.length > MAX_LISTED ? ` (+${domHits.length - MAX_LISTED} more)` : ''}`);
  }
  if (consoleHits.length > 0) {
    const listed = consoleHits.slice(0, MAX_LISTED).join(' | ');
    parts.push(`${consoleHits.length} negative-value console error(s): ${listed}`);
  }

  return { name, severity: 'VIOLATION', evidence: parts.join('; ') };
}
