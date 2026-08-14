// assets/brand/lockup.mjs
//
// Reads the vendored canonical Intercept lockup and returns inline-ready SVG.
//
// WHY THIS EXISTS RATHER THAN A PASTED STRING. An earlier build of the Studio
// carried a HAND-TYPED wordmark path and rendered "intece" instead of
// "Intercept". The real wordmark path is ~5,000 characters, and Fritz forbids
// recreating it at all (KNOWLEDGE §12.6, §12.8). Reading the file removes the
// possibility of transcription rather than fixing one instance of it.
//
// The lockup is inlined as <symbol> + <use>, never <img src="…svg">: Chrome's
// file:// policy breaks sibling image loads and the kit bans the pattern.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.join(__dirname, 'intercept-lockup-centered.svg');

/** Wordmark fill in the shipped file — it is authored for a dark field. */
const WORDMARK_DARK_FIELD_FILL = '#FFFFFF';
/** Carbon/500 — the wordmark fill for a light (Halo) field. */
const WORDMARK_LIGHT_FIELD_FILL = '#0A0A0F';

let cached = null;

/**
 * @param {'light'|'dark'} field  which background the lockup sits on
 * @returns {Promise<{viewBox:string, inner:string}>}
 */
export async function lockup(field = 'light') {
  if (!cached) {
    const raw = await readFile(SVG_PATH, 'utf8');

    const viewBox = (raw.match(/viewBox="([^"]+)"/) || [])[1];
    if (!viewBox) throw new Error('lockup.mjs: no viewBox in the vendored lockup SVG');

    // Strip the outer <svg> wrapper; keep every child path untouched.
    const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();

    const paths = (inner.match(/<path/g) || []).length;
    if (paths !== 9) {
      // 8 mark paths + 1 wordmark. A different count means the vendored file
      // changed shape and the recolour below can no longer be trusted.
      throw new Error(`lockup.mjs: expected 9 paths in the lockup, found ${paths}`);
    }
    if (!inner.includes(WORDMARK_DARK_FIELD_FILL)) {
      throw new Error('lockup.mjs: wordmark fill not found — cannot safely recolour for a light field');
    }

    cached = { viewBox, inner };
  }

  const inner = field === 'dark'
    ? cached.inner
    // Only the wordmark carries #FFFFFF, so this swap cannot touch a mark
    // accent. Every accent hex is left exactly as authored.
    : cached.inner.replaceAll(WORDMARK_DARK_FIELD_FILL, WORDMARK_LIGHT_FIELD_FILL);

  return { viewBox: cached.viewBox, inner };
}
