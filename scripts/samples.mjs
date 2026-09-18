// scripts/samples.mjs
//
// The bundled sample datasets — real data with real provenance, never invented
// numbers. A gallery card drawn on made-up figures teaches a form and lies
// about what it is for at the same time; a reader who likes the picture then
// asks what it says, and there is no honest answer.
//
// Each entry in samples/index.json carries a `source` line. Where a figure is
// approximate or hand-compiled, the line says so — that disclosure travels with
// the data rather than living in a README nobody opens.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES_DIR = path.resolve(HERE, '..', 'samples');

let cache = null;

/** Every bundled sample, with its text loaded. */
export async function loadSamples() {
  if (cache) return cache;
  const index = JSON.parse(await readFile(path.join(SAMPLES_DIR, 'index.json'), 'utf8'));
  cache = await Promise.all(index.map(async (s) => ({
    ...s,
    text: await readFile(path.join(SAMPLES_DIR, s.file), 'utf8'),
  })));
  return cache;
}

/** One sample by id, for `deevee fit --sample <id>` and friends. */
export async function loadSample(id) {
  const all = await loadSamples();
  const hit = all.find((s) => s.id === id);
  if (!hit) {
    throw new Error(`unknown sample "${id}" — known: ${all.map((s) => s.id).join(', ')}`);
  }
  return hit;
}
