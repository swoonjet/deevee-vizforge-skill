// scripts/lib/demo-only.mjs
//
// WHICH TECHNIQUES ARE PINNED TO THEIR OWN DEMO DATASET, asked in one place.
//
// A demo-pinned technique cannot render a foreign table: its scaffold names the
// demo's columns, or its shaper computes a finding that only means something for
// that domain. The `dataBinding` contract cannot express this — it describes the
// roles a piece WOULD accept, and both of these pieces have a perfectly generic
// role list. That mismatch is how they came to be recommended for data they can
// never draw.
//
// The fact now lives in the fragment as `demoOnly.reason`, and everything that
// needs it reads it from there: recommend()'s eligibility, the Studio's atlas
// bridge, and three test files that each used to carry their own hardcoded copy
// of the same two slugs. One edit pins a piece; deleting the field un-pins it
// everywhere at once, and the tests that assert the pin is WARRANTED then fail
// until the piece really does render a stranger's data.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

/**
 * demoOnlyFrom(manifest) -> Map<slug, reason>
 * Pure. Takes an already-loaded manifest so callers that have one don't re-read
 * it from disk.
 */
export function demoOnlyFrom(manifest) {
  const pinned = new Map();
  for (const t of (manifest && manifest.techniques) || []) {
    if (t.demoOnly) pinned.set(t.slug, t.demoOnly.reason);
  }
  return pinned;
}

/** loadDemoOnly() -> Map<slug, reason>, read from the assembled atlas. */
export async function loadDemoOnly() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'skill/manifest.json'), 'utf8'));
  return demoOnlyFrom(manifest);
}
