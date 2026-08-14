// scripts/lib/assemble-with-data.mjs
//
// BIND-02 (Phase 7 Plan 03) -- the injection wrapper every bound-scaffold
// build path (and Phase 9's server-side render) uses. Resolves a virtual
// `__DATA__/<key>` repo-relative path to in-memory shaped JSON and delegates
// EVERYTHING else, unchanged, to `scripts/assemble-scaffold.mjs`'s `assemble()`.
//
// Because this wrapper never re-implements directive resolution -- it only
// swaps out `readFile` -- injection automatically inherits 07-01's
// `safeJsonForScript` escaping on the `@inline-data` path with zero extra
// work here. A `<!-- @inline-data __DATA__/bound.json AS BOUND_DATA -->`
// directive in a scaffold's src resolves to whatever JSON string is
// registered under `virtualFiles['bound.json']`, exactly like any other
// `@inline-data` directive resolves a real repo file.

import { assemble } from '../assemble-scaffold.mjs';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';

const VIRTUAL_PREFIX = '__DATA__/';

/**
 * assembleWithData(srcText, { repoRoot, virtualFiles }) -> Promise<string>
 *
 * @param {string} srcText - the scaffold's `.src.html` source text
 * @param {{repoRoot: string, virtualFiles: Record<string,string>}} opts
 *   `virtualFiles` maps a key (e.g. `'bound.json'`) to its in-memory string
 *   contents; a directive referencing `__DATA__/<key>` resolves to that
 *   string. Any OTHER (non-`__DATA__/`) directive path resolves against the
 *   real filesystem, joined with `repoRoot`, exactly as the CLI's
 *   `assemble-scaffold.mjs` does.
 * @returns {Promise<string>} the fully assembled HTML
 */
export async function assembleWithData(srcText, { repoRoot, virtualFiles }) {
  return assemble(srcText, {
    readFile: async (repoRelativePath) => {
      if (repoRelativePath.startsWith(VIRTUAL_PREFIX)) {
        const key = repoRelativePath.slice(VIRTUAL_PREFIX.length);
        if (!(key in virtualFiles)) {
          throw new Error(`assembleWithData: no virtual file registered for "${repoRelativePath}"`);
        }
        return virtualFiles[key];
      }
      return fsReadFile(path.join(repoRoot, repoRelativePath), 'utf8');
    },
  });
}
