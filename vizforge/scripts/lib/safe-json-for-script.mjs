// scripts/lib/safe-json-for-script.mjs
//
// The single shared templating primitive for injecting arbitrary data into
// an inline <script> block inside a self-contained single-file HTML piece
// (BIND-03, Phase 7 Plan 01). Both `assemble-scaffold.mjs`'s `@inline-data`
// directive AND Phase 9's `assembleWithData` route through this helper —
// the escaping decision is made ONCE here, never re-derived per call site.
//
// WHY this is required (and why bare `JSON.stringify` is unsafe):
//
// 1. The HTML tokenizer runs BEFORE the JavaScript parser. A raw `<`
//    character inside a <script> block's text content is scanned by the
//    HTML parser first. If the data being JSON.stringify'd (a column name or
//    cell value, in this project's case) contains the literal sequence
//    `</script`, the HTML tokenizer closes the enclosing <script> tag right
//    there — regardless of the fact that it appears "inside a JS string" at
//    the JS-parser level, because the JS parser never gets to see it. Any
//    markup that follows (e.g. `<img src=x onerror=...>`) is then parsed as
//    real, executable HTML — a stored/reflected XSS breakout. `<!--` has an
//    analogous HTML-comment-open hazard.
//
// 2. U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid
//    inside JSON strings and inside `JSON.stringify` output, but historically
//    were NOT valid inside JS string literals in some engines/spec versions
//    (they are treated as line terminators by the lexical grammar even
//    inside a string), producing a raw JS SyntaxError at parse time when
//    such a "valid JSON, invalid JS" string round-trips through
//    `JSON.stringify` straight into a <script> block. Escaping them to their
//    `\u2028` / `\u2029` sequences sidesteps that engine ambiguity entirely.
//
// This function is deliberately the ONLY place this decision is made. It
// JSON.stringifies `value` (identical semantics to `JSON.stringify`, so
// `JSON.parse` on the resulting string content losslessly round-trips to the
// original `value`) and then escapes the 5 characters above to their
// `\uXXXX` unicode-escape form, which is valid inside both a JSON string
// (per JSON.parse) and a JS string literal (per the JS parser), and can
// never itself form `<`, `>`, `&`, or a line terminator once emitted as
// literal source text inside a <script> block.
//
// For data containing NONE of these 5 characters (true of every curated
// dataset in data/*.csv and data/*.json as of this writing — see
// 07-RESEARCH.md), this function's output is byte-identical to
// `JSON.stringify(value)`, making its adoption a provable no-op for all 25
// shipped scaffolds.
//
// @param {*} value - Any JSON-serializable value.
// @returns {string} A JSON-text string safe to emit verbatim inside an
//   inline <script> block; `JSON.parse` on it losslessly recovers `value`.
export function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
