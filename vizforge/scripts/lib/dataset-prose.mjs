// scripts/lib/dataset-prose.mjs
//
// Detects DATASET-CLAIM PROSE hardcoded into a scaffold's copy fallbacks.
//
// Why this exists (the 2026-07-30 false-attribution audit): every scaffold
// resolves its editorial copy as `copy.X || '<literal>'`, where `copy` comes
// from the injected BOUND_COPY. The app's bind path
// (app/routes/preview.mjs) sets `source` but leaves headline/dek/
// methodology/note NULL -- so the literal renders over a user's own data.
// A seat-count line chart shipped the sentence "NASA GISTEMP v4 monthly
// global-mean anomaly relative to the 1951-1980 base period."
//
// The pre-existing scripts/tests/integration/no-false-attribution.test.mjs
// could not catch this: it only ever asserts the `source` field, on two
// techniques, and always supplies a `source` override -- so it passes green
// while dek/methodology/note leak.
//
// THE FIX THIS DETECTOR ENFORCES: dataset-specific prose belongs in the
// fragment's `demoBinding.copy` block (a mechanism regenerate-scaffold.mjs
// already reads at line ~114, and which 0 of 49 fragments used). A scaffold
// fallback may then only state TECHNIQUE truths -- things true of ANY bound
// data. Because the demo prose moves OUT of the scaffold source, a
// source-level scan becomes a valid check: a dataset token found in a
// fallback literal after the fix is a real regression, not dead demo code.
// (That is precisely the objection no-false-attribution.test.mjs documents
// against raw-text assertions, and it stops applying once the prose moves.)
//
// FOUR LEAK CLASSES, from the audit:
//   provenance -- names the demo dataset or its publisher (GISTEMP, Titanica)
//   subject    -- the demo's subject matter (characters, bureaus, generation)
//   period     -- a period/baseline belonging to the demo (1951-1980, FY2025)
//   unit       -- the demo's unit of measure welded to a computed number
//                 ("X-axis starts at " + Math.round(d[0]) + " g")

// Words that carry no dataset identity on their own.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'per', 'via', 'from', 'with', 'data', 'dataset',
  'monthly', 'annual', 'daily', 'yearly', 'global', 'world', 'total',
  'five', 'year', 'years', 'v1', 'v2', 'v3', 'v4', 'all', 'raw', 'set',
  'flows', 'flow', 'catalog', 'records', 'record', 'estimates', 'index',
  'university', 'school', 'institute', 'department', 'dept', 'office',
  'national', 'international', 'bureau', 'agency', 'center', 'centre',
  'source', 'sources', 'studies', 'study', 'science', 'sciences',
]);

// Unit-of-measure literals that must never be welded to a computed number.
// A scaffold that wants to print a unit must take it from bound copy, not
// from its own demo's dimensions.
//
// Deliberately EXCLUDED: '%' and 'pct' (a percentage is a computed FORMAT
// that holds for any bound ratio, not a dataset dimension), and the bare
// single letters m/c/f/k/s/in (far too collision-prone to be evidence of
// anything -- "in 1912" would trip 'in').
const UNIT_LITERALS = [
  'g', 'kg', 'mg', 'mm', 'cm', 'km', 'ft',
  'years', 'year', 'yrs', 'months', 'hours', 'hrs',
  '$', '€', '£', 'usd', 'eur',
  '°c', '°f',
  'twh', 'gwh', 'kwh', 'mw', 'gw', 'kw',
  'tok/s',
];

// Units a specific technique may legitimately name, because the unit is
// intrinsic to the FORM rather than borrowed from its demo dataset. Keep
// this list short and justified -- each entry is a documented exemption,
// reviewed by a human, not a convenience.
const INTRINSIC_UNITS = {
  // A calendar heatmap's x-domain IS calendar days, for any bound data.
  'calendar-heatmap': ['days', 'day'],
  'calendar-heatmap-animated': ['days', 'day'],
};

/**
 * Strips the giant injected data/copy/font constants so the scan never
 * walks megabytes of base64 or a demo data blob.
 */
function stripInjected(src) {
  return src
    .replace(/const BOUND_(?:DATA|COPY)\s*=\s*"(?:[^"\\]|\\.)*";/g, '')
    .replace(/url\(data:[^)]*\)/g, '')
    .replace(/"data:[^"]*"/g, '');
}

/**
 * Extracts every JS string literal inside `text`, handling escapes.
 */
function stringLiterals(text) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    if (raw && raw.trim()) out.push(raw);
  }
  return out;
}

/**
 * Builds the set of dataset-identifying tokens for one scaffold, from its
 * OWN meta.json sidecar. Tokens that also occur in the scaffold's slug are
 * dropped -- "matrix" identifies abel-region-migration-matrix but is also
 * the adjacency-matrix technique's own name.
 */
export function forbiddenTokens(dataset = {}, slug = '') {
  const slugLower = String(slug).toLowerCase();
  const tokens = new Set();

  const add = (word) => {
    const w = String(word).toLowerCase().replace(/[^a-z0-9°/$€£%]/g, '');
    if (w.length < 3) return;
    if (STOPWORDS.has(w)) return;
    if (slugLower.includes(w)) return;
    tokens.add(w);
  };

  for (const part of String(dataset.id || '').split(/[-_]/)) add(part);

  // Proper nouns + acronyms in the publisher string.
  for (const word of String(dataset.source || '').split(/[\s,()]+/)) {
    if (/^[A-Z][A-Za-z']{2,}$/.test(word) || /^[A-Z]{3,}$/.test(word)) add(word);
  }

  const base = String(dataset.snapshotFile || '').split('/').pop() || '';
  for (const part of base.replace(/\.[a-z]+$/i, '').split(/[-_]/)) {
    if (part.length >= 4) add(part);
  }

  return tokens;
}

/**
 * Finds the fallback region for each copy field. Returns
 * {field -> [literal, ...]}. `headline` is included because the same
 * `copy.headline || '<literal>'` shape applies.
 */
export function copyFallbackLiterals(src, { window = 500 } = {}) {
  const clean = stripInjected(src);
  const markers = {
    headline: /copy\.headline\s*\|\|/g,
    dek: /copy\.dek\s*\|\|/g,
    methodology: /copy\.methodology\s*\|\|/g,
    note: /\bnote:\s*(?!copy\.note)/g,
  };

  const out = {};
  for (const [field, re] of Object.entries(markers)) {
    const literals = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(clean)) !== null) {
      const region = clean.slice(m.index, m.index + window);
      // Stop at the statement end so we do not bleed into the next field.
      const cut = field === 'note' ? region.split(/\}\s*\)/)[0] : region.split(';')[0];
      literals.push(...stringLiterals(cut));
    }
    if (literals.length) out[field] = literals;
  }
  return out;
}

/**
 * Detects a unit literal welded to a computed number: a literal that is
 * (or begins with) a unit token and sits in a concatenation.
 */
function unitLeak(literal, slug) {
  const trimmed = literal.trim().toLowerCase().replace(/^[,;:.\s]+/, '');
  if (!trimmed) return null;
  const head = trimmed.split(/[\s,.;)]/)[0];
  const exempt = INTRINSIC_UNITS[slug] || [];
  if (exempt.includes(head)) return null;
  return UNIT_LITERALS.includes(head) ? head : null;
}

/**
 * Whole-word containment. Substring matching produced false positives that
 * looked like real leaks: the 3-letter token "our" (from "Our World in
 * Data") matched inside the word "source".
 */
function containsWord(haystack, token) {
  // Tokens may contain regex-significant currency/degree characters.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Main entry. Returns an array of findings; empty means clean.
 *
 * @param {string} src         the scaffold's HTML source
 * @param {object} meta        parsed <slug>.meta.json
 * @param {string} slug        technique slug
 * @param {object} [opts]
 * @param {boolean} [opts.checkUnits=true]
 */
export function datasetProseFindings(src, meta, slug, { checkUnits = true } = {}) {
  const dataset = (meta && meta.dataset) || {};
  const tokens = forbiddenTokens(dataset, slug);
  const byField = copyFallbackLiterals(src);
  const findings = [];

  for (const [field, literals] of Object.entries(byField)) {
    for (const literal of literals) {
      const hit = [...tokens].filter((t) => containsWord(literal, t));
      if (hit.length) {
        findings.push({
          slug, field, literal, leak: 'provenance/subject/period', tokens: hit.sort(),
        });
        continue;
      }
      if (checkUnits) {
        const unit = unitLeak(literal, slug);
        if (unit) findings.push({ slug, field, literal, leak: 'unit', tokens: [unit] });
      }
    }
  }

  return findings;
}
