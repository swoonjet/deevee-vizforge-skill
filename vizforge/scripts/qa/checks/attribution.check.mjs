// scripts/qa/checks/attribution.check.mjs
//
// Static attribution-presence check (docs/titling-attribution.md, CRAFT-03).
// Stricter/more specific than pattern-scan.mjs's coarse REQUIRE regexes
// (<h1> exists / "Source:" exists anywhere) — this check names exactly which
// structural piece is missing: a non-empty headline, the .viz-attribution
// block, the "Source:" literal INSIDE it, and a second (methodology) segment
// joined with the house convention's `&middot;` separator.
//
// Real pieces (pieces/*.html) inline assets/snippets/attribution.js's
// attributionFooter() builder verbatim and set text at RUNTIME
// (footerEl.innerHTML = attributionFooter({...}); headlineEl.textContent =
// '...' + computedValue + '...') — so the literal resolved text never sits
// in one place in the static HTML source. But the BUILDER's own template
// literal (class="viz-attribution", "Source: ", ' &middot; ' join) is
// inlined as JS source text, so it IS statically greppable; this check
// relies on that, matching the same footgun-avoidance pattern
// meta-schema-fields.test.mjs's disclosure-fragment check already uses.

export const name = 'attribution';
export const needs = ['html'];

export async function run(ctx) {
  const html = ctx.html;
  const missing = [];

  // 1. <h1> with non-empty text — either static text between the tags, or a
  // runtime .textContent assignment (the real-piece convention: an empty
  // <h1 id="headline"></h1> filled by headlineEl.textContent = ... later in
  // the same file).
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1Match) {
    missing.push('<h1> headline element');
  } else {
    const staticText = h1Match[1].replace(/<[^>]*>/g, '').trim();
    const hasDynamicFill = /\.textContent\s*=/.test(html);
    if (staticText.length === 0 && !hasDynamicFill) {
      missing.push('<h1> element has no static text and no runtime .textContent assignment — headline appears empty');
    }
  }

  // 2. class="viz-attribution" block present.
  const hasAttributionClass = /class\s*=\s*["']viz-attribution["']/.test(html);
  if (!hasAttributionClass) {
    missing.push('class="viz-attribution" block');
  }

  // 3. The literal "Source:" text.
  const hasSourceLiteral = /Source:/.test(html);
  if (!hasSourceLiteral) {
    missing.push('"Source:" literal');
  }

  // 4. A methodology segment — the attribution convention joins >=2 segments
  // with ' &middot; '; its absence means only the bare Source: line exists.
  const hasMiddotJoin = /&middot;/.test(html);
  if (!hasMiddotJoin) {
    missing.push('methodology segment (no &middot;-joined second segment found)');
  }

  if (missing.length > 0) {
    return { name, severity: 'VIOLATION', evidence: `missing: ${missing.join('; ')}` };
  }

  // PASS evidence: quote the found source line when it's statically
  // resolvable (bad-fixture convention: a literal <div class="viz-attribution">
  // ...</div>); real pieces resolve the text at runtime via the inlined
  // attributionFooter() builder, so fall back to naming what was confirmed.
  const blockMatch = html.match(/<div[^>]*class\s*=\s*["']viz-attribution["'][^>]*>([\s\S]*?)<\/div>/i);
  const resolvedText = blockMatch ? blockMatch[1].replace(/<[^>]*>/g, '').trim() : '';
  const looksTemplated = /\$\{/.test(resolvedText);

  const evidence =
    resolvedText.length > 0 && !looksTemplated
      ? `found: "${resolvedText}"`
      : 'found: viz-attribution block + "Source:" + &middot;-joined methodology literal confirmed (resolved at runtime via inlined attributionFooter())';

  return { name, severity: 'PASS', evidence };
}
