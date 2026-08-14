#!/usr/bin/env node
// scripts/assemble-scaffold.mjs
//
// Deterministic single-file scaffold assembler (Phase 3, 03-01-PLAN.md
// <interfaces>). Resolves author-written directives inside
// `scaffolds/src/<slug>.src.html` into a self-contained
// `scaffolds/<slug>.html`, per PIPE-01 (every piece/scaffold is a single
// file with zero runtime network dependencies).
//
// Directive contract (locked here — Wave 2 batch plans and Wave 3 build
// against it verbatim):
//
//   <!-- @inline-css <repo-relative-path> -->
//     Replaced by the referenced file's raw contents. Author places the
//     directive INSIDE an existing <style> block.
//
//   <!-- @inline-js <repo-relative-path> -->
//     Replaced by the referenced file's raw contents. Author places it
//     INSIDE a <script> block (used for node_modules/d3/dist/d3.min.js and
//     node_modules/d3-sankey/dist/d3-sankey.min.js).
//
//   <!-- @inline-module <repo-relative-path> -->
//     File contents with leading `export ` tokens stripped (function/const
//     declarations become plain declarations), matching how
//     pieces/co2-keeling-static.html embeds assets/snippets/*.js.
//
//   <!-- @inline-data <repo-relative-path> AS <CONST_NAME> -->
//     Emits `const <CONST_NAME> = <JSON.stringify(file contents)>;` (author
//     parses in-browser with d3.csvParse).
//
// Unknown or unresolvable directives are a thrown error — never silently
// passed through. Assembly is pure and byte-deterministic: same inputs ->
// identical output.

import { readFile as fsReadFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJsonForScript } from './lib/safe-json-for-script.mjs';

const KNOWN_KINDS = new Set(['css', 'js', 'module', 'data']);

// Matches an entire `<!-- @inline-<kind> <path> [AS <NAME>] -->` directive,
// including kinds this module doesn't recognize (so unknown directives are
// caught and thrown on, never silently passed through).
const DIRECTIVE_RE = /<!--\s*(@inline-([a-zA-Z0-9-]+)\s+(\S+)(?:\s+AS\s+(\S+))?)\s*-->/g;

/**
 * Strips leading `export ` tokens from module source text — i.e. only
 * `export ` appearing at the start of a line is removed (matching how
 * pieces/co2-keeling-static.html embeds assets/snippets/harness.js:
 * `export function createViz(...)` becomes `function createViz(...)`).
 * `export` appearing mid-line (e.g. inside a string or comment) is left
 * untouched.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripExportTokens(source) {
  return source.replace(/^export /gm, '');
}

/**
 * Pure assembler: resolves every `@inline-*` directive in `srcText` by
 * calling the injected `readFile(repoRelativePath)` for each directive's
 * path, dispatching on directive kind. Throws (with the directive's exact
 * source text in the message) on an unknown directive kind, a missing
 * `AS <NAME>` clause on @inline-data, or a readFile failure.
 *
 * @param {string} srcText
 * @param {{ readFile: (repoRelativePath: string) => Promise<string> }} opts
 * @returns {Promise<string>}
 */
export async function assemble(srcText, { readFile }) {
  const matches = [...srcText.matchAll(DIRECTIVE_RE)];
  if (matches.length === 0) return srcText;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const [fullMatch, directiveText, kind, filePath, constName] = match;

      if (!KNOWN_KINDS.has(kind)) {
        throw new Error(`assemble-scaffold: unknown directive "${directiveText}"`);
      }

      let contents;
      try {
        contents = await readFile(filePath);
      } catch (err) {
        throw new Error(`assemble-scaffold: could not resolve directive "${directiveText}": ${err.message}`);
      }

      if (kind === 'css' || kind === 'js') {
        return { fullMatch, replacement: contents };
      }

      if (kind === 'module') {
        return { fullMatch, replacement: stripExportTokens(contents) };
      }

      // kind === 'data'
      if (!constName) {
        throw new Error(`assemble-scaffold: @inline-data directive missing "AS <CONST_NAME>": "${directiveText}"`);
      }
      return { fullMatch, replacement: `const ${constName} = ${safeJsonForScript(contents)};` };
    })
  );

  let result = srcText;
  for (const { fullMatch, replacement } of replacements) {
    // Replace only the first remaining occurrence each time so repeated
    // identical directives (rare, but not forbidden) each resolve
    // independently rather than all collapsing onto the first replacement.
    result = result.replace(fullMatch, () => replacement);
  }
  return result;
}

function repoRootFromThisFile() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '..');
}

async function realReadFile(repoRoot, repoRelativePath) {
  return fsReadFile(path.join(repoRoot, repoRelativePath), 'utf8');
}

async function runCli(argv) {
  const [srcArg, outArg] = argv;
  if (!srcArg || !outArg) {
    throw new Error('usage: node scripts/assemble-scaffold.mjs <src.html> <out.html>');
  }

  const repoRoot = repoRootFromThisFile();
  const srcPath = path.resolve(srcArg);
  const outPath = path.resolve(outArg);

  const srcText = await fsReadFile(srcPath, 'utf8');
  const assembled = await assemble(srcText, {
    readFile: (repoRelativePath) => realReadFile(repoRoot, repoRelativePath),
  });

  await writeFile(outPath, assembled, 'utf8');
  return outPath;
}

// CLI guard: only run when this file is executed directly (`node
// scripts/assemble-scaffold.mjs ...`), never when imported by a test.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const outPath = await runCli(process.argv.slice(2));
    console.log(`assembled -> ${outPath}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
