// scripts/shapers/typographic-bar.mjs
//
// typographic-bar (EXPR-04, Phase 17 Plan 01) -- re-exports bar.mjs's
// shaper verbatim. typographic-bar is a category+value magnitude/ranking
// technique -- the SAME grouping/aggregation/ordering bar.mjs already
// implements correctly (BIND-01/02/04, Phase 7) is exactly right here too.
// This technique differs from bar ONLY in RENDERING (a type-as-data poster
// scaffold where each category's HEIGHT-scaled numeral IS the mark, instead
// of a rectangle bar) -- never in how rows are grouped/aggregated/ordered
// into {data, stats}. No new shaping logic belongs in this file; if
// typographic-bar's data needs ever diverge from bar's own contract, that's
// a signal this re-export should become a real fork, not a reason to add
// dead branches here.

export { shape, validate } from './bar.mjs';
