// scripts/shapers/editorial-poster.mjs
//
// EXPR-05 (Phase 17 Plan 02) -- editorial-poster is a DESIGNED-COMPOSITION
// treatment of the line technique, never a new encoding. The poster changes
// only COMPOSITION (asymmetric layout, dominant headline, generous negative
// space) and ANNOTATION (a narrative call-out layer citing real stats values)
// -- the underlying chart's shaping/validation logic must be byte-identical
// to scripts/shapers/line.mjs, so this file re-exports it verbatim rather
// than reimplementing or altering it in any way. `regenerateFromDemoBinding`
// (scripts/lib/regenerate-scaffold.mjs) dispatches to this file purely by
// this technique's own slug ("editorial-poster"), per
// skill/manifest/editorial-poster.json's scaffoldPath/srcPath -- the shaper
// module it loads just happens to be line's own shape()/validate() again.

export { shape, validate } from './line.mjs';
