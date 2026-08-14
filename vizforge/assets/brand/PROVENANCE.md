# Vendored Intercept brand assets

`intercept-lockup-centered.svg` — the CANONICAL centred Intercept lockup
(CD direction, 2026-07-08; baseline alignment is retired).

**Copied verbatim** from the brand kit:
`~/Creative-Projects/intercept-brand-kit/.fritz/assets/logo/intercept-lockup-centered.svg`

Vendored rather than read across repos so this repo's artifacts stay
reproducible without the kit checked out beside it.

## Do not hand-edit, and never retype the paths

The wordmark path alone is ~5,000 characters. Fritz rules forbid recreating
it (KNOWLEDGE §12.6 "the wordmark is supplied as a file; don't recreate it"
and §12.8 "no hand-drawn or CSS-recreated marks").

This file exists because that rule was broken once: an earlier build of
`app/views/studio.mjs` carried a hand-typed wordmark path and rendered
"intece" instead of "Intercept". `assets/brand/lockup.mjs` now reads THIS
file, so the paths can never be transcribed again.

## Recolouring

- Light (Halo) field: wordmark fill `#FFFFFF` → `#0A0A0F`. `lockup.mjs` does this.
- Channel recolour: swap the base fill `#FF00E5` only. Keep every accent hex
  (`#8846C9 #1DABC1 #5154C4 #FF44F9 #FFA9F8 #FF52F9`) — the accent palette is
  never recoloured and the mark is never flattened to a solid.

Refresh by re-copying from the kit; do not edit in place.
