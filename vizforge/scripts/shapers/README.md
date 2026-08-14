# scripts/shapers/ -- the shaper contract

This directory holds ONE file per technique: `scripts/shapers/<slug>.mjs`,
where `<slug>` is exactly the technique's manifest slug (`bar`, `line`,
`sankey-alluvial`, ...). `scripts/bind-data.mjs`'s `bindData()` resolves a
shaper by CONVENTION -- a dynamic `import()` of `./shapers/<slug>.mjs` -- so
adding a technique's shaper is always a NEW file, never an edit to a shared
registry. This is exactly what let Phase 3's per-fragment manifest waves run
in parallel with disjoint file ownership, and it's why this framework plan
never lands a real technique shaper: only this README does.

## The contract

Every `scripts/shapers/<slug>.mjs` exports exactly two functions:

```js
// scripts/shapers/<slug>.mjs
export function shape(rows, bindings) {
  // Pure: user rows + the resolved {role: columnName} bindings ->
  // the EXACT data structure the technique's scaffold consumes
  // ({data|nodes|links|matrix|lattice, stats}). No I/O, no randomness beyond
  // this project's existing seeded-RNG conventions where a technique needs one.
}

export function validate(rows, bindings, { contract, profile }) {
  // Technique-SPECIFIC rules the generic validateBinding() in bind-data.mjs
  // can't express (row-count floors, cycle detection, lattice-regularity
  // checks, etc.) -> [] when fine, else an array of
  // { channel, problem, remedy } errors (same shape validateBinding returns).
  // Called AFTER validateBinding() already passed; shape() is never called if
  // this returns any errors.
}
```

`shape` must be a pure function: identical `rows`+`bindings` in, identical
output out. Any technique-specific randomness (e.g. a d3-force settle) must
follow this project's existing seeded-RNG pattern (mulberry32/xorshift),
never `Math.random()`.

## Dispatch: `bindData(slug, rows, bindingSpec, { contract, profile })`

1. Runs `validateBinding(bindingSpec, contract, profile)` (the generic,
   technique-agnostic checks -- see `scripts/bind-data.mjs`'s own doc
   comment). If it returns any errors, `bindData` returns
   `{ ok:false, errors }` immediately -- your shaper's `shape()` and
   `validate()` are NEVER called.
2. Dynamically imports `./shapers/<slug>.mjs`. A missing file (no shaper yet
   for that slug) is caught and returned as a graceful
   `{ ok:false, errors:[{channel:'*', problem:'no shaper registered for "<slug>" ...'}] }`
   -- never an unhandled throw.
3. Runs the shaper's own `validate(rows, bindings, {contract, profile})`. Any
   errors it returns short-circuit the same way -- `shape()` is never called.
4. Only if both validation passes runs `shape(rows, bindings)` and returns
   `{ ok:true, data }`.

## bindingSpec shape

The `bindings` object passed to both `shape()`/`validate()` and to
`bindData()`/`validateBinding()` maps role name -> column name(s):

```js
{
  [roleName]: string | string[],
    // A single column name, OR -- ONLY for a role the contract flags
    // `multiColumn: true` (e.g. streamgraph's `layers` role, wave 3) -- an
    // array of column names. A non-array value bound to a multiColumn role,
    // or an array bound to a single-column role, is a structural error.
  aggregation?: { [roleName]: string },
    // Optional per-role aggregation choice. Must be one of that role's
    // declared dataBinding.roles[].aggregation list when present.
}
```

## Ethos (locked)

Honest failure over dishonest success. A binding that can't honestly support
a technique returns structured `{channel, problem, remedy}` errors -- no HTML
is ever generated from bad input. Never throw for an EXPECTED validation
failure (missing/wrong-typed columns, non-coercible values, structural
arity mismatches); reserve real exceptions for genuinely unexpected states
(a corrupt manifest fragment, a missing dataset file).

## What does NOT belong here

No real technique shaper lands in this directory as part of Phase 7 Plan 03
(the framework plan) -- those are Wave 2/3's job, one PR per technique, each
adding exactly one new `<slug>.mjs` file here. Tests for the generic
framework (`scripts/tests/smoke/bind-data-validation.test.mjs` and
`scripts/tests/smoke/assemble-with-data.test.mjs`) use throwaway stub shapers
under `scripts/tests/fixtures/shapers/`, never a real file in this directory.
