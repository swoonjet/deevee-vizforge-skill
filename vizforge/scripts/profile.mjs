#!/usr/bin/env node
// scripts/profile.mjs
//
// INTAKE-01/03/05 — the pure, deterministic profiler. Turns arbitrary parsed
// CSV/TSV/JSON text into the EXACT `profile` JSON contract `scripts/recommend.mjs`
// already consumes (read that file before touching this one — it is the spec).
//
// recommend.mjs trusts this profiler completely:
//   - profile.fields[].type must be exactly 'quantitative'|'temporal'|'ordinal'|'nominal'
//     (case-sensitive string equality; ANY other spelling silently zeroes
//     quantitativeFieldCount with no error anywhere downstream)
//   - profile.shape.categoryCardinality / .pointCount must ALWAYS be numbers (0 default) —
//     omitting them does not fail recommend.mjs's honesty filter, it silently DISABLES it
//   - profile.shape.hasCycles must be REAL cycle detection, never a hopeful `false` default
//     (the only enforced flow precondition, 'acyclic-flow', reads this flag directly)
//   - profile.intent must NOT be set here — Phase 8 owns it entirely
//
// Two intended (NOT bug) behaviors, documented so a future maintainer doesn't "fix" them:
//   1. Multi-quantitative datasets ALSO surface a 'correlation' candidate downstream
//      (recommend.mjs's shapesFromProfile: quantitativeFieldCount>=2) alongside their
//      primary shape (e.g. CO2's time series ALSO reads as correlation-eligible). This
//      is recommend.mjs's own designed multi-candidate behavior — do not suppress it here.
//   2. 'cyclical' has no heuristic path anywhere in this file or in recommend.mjs — it is
//      manually-invocable only (radial/polar's honesty restriction). Never imply it.
//
// Conservative-with-warnings beats confident-and-wrong throughout: an ambiguous column
// (slash-dates, mixed formats) becomes nominal + a warning, never a guessed type.

import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// Constants / regexes
// (numeric heuristic + ISO-8601 regex adapted from d3-dsv's autoType.js, per
// 06-RESEARCH.md's Code Examples — a proven, conservative pattern)
// ---------------------------------------------------------------------------

const CURRENCY = /^[$£€¥]/;
const PERCENT = /%$/;
const US_THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

// Source: https://github.com/d3/d3-dsv/blob/main/src/autoType.js (verified 2026-07-11)
const ISO_8601 = /^([-+]\d{2})?\d{4}(-\d{2}(-\d{2})?)?(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[-+]\d{2}:\d{2})?)?$/;
const BARE_YEAR = /^\d{4}$/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const TEXTUAL_MONTH =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;

const NAME_HINT_YEAR = /year|yr|date|time/i;
const NAME_HINT_ID = /(^id$|_id$|id$)/i;

// Known-set ordinal matching only — never a general cardinality-based
// inference (06-RESEARCH.md: "arbitrarily ordering an unrecognized categorical
// is itself a subtle honesty risk").
const ORDINAL_SETS = [
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ],
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['q1', 'q2', 'q3', 'q4'],
];

const MAX_SAMPLE = 1000;
// Minimum distinct bare-4-digit-year values required before the name-hint
// year rule classifies a column temporal. This project's own conservative
// addition (not in 06-RESEARCH.md verbatim): guards a low-cardinality numeric
// "study year" label (e.g. Palmer Penguins' 3-value `year`, 2007-2009) from
// misclassifying as a genuine time axis, while still catching gapminder's
// 12-value and co2's 69-value `year` columns.
const MIN_YEAR_DISTINCT = 4;

// ---------------------------------------------------------------------------
// Header normalization
// ---------------------------------------------------------------------------

function normalizeHeader(raw) {
  return raw
    .replace(/ /g, ' ') // nbsp -> space
    .replace(/[‘’]/g, "'") // smart single quotes -> '
    .replace(/[“”]/g, '"') // smart double quotes -> "
    .trim()
    .normalize('NFKC');
}

// ---------------------------------------------------------------------------
// Numeric heuristic
// ---------------------------------------------------------------------------

function looksNumeric(v) {
  if (v === '') return false;
  let stripped = v.replace(CURRENCY, '').replace(PERCENT, '');
  if (US_THOUSANDS.test(stripped)) stripped = stripped.replace(/,/g, '');
  return PLAIN_NUMBER.test(stripped);
}

function isMonotonicIntegerSequence(values) {
  const nums = values.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || !Number.isInteger(n))) return false;
  const distinctCount = new Set(nums).size;
  if (distinctCount !== nums.length) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return max - min + 1 === nums.length;
}

// ---------------------------------------------------------------------------
// Temporal heuristic (conservative — ambiguous formats fall to nominal+warning)
// ---------------------------------------------------------------------------

function isFullDateIso(v) {
  // A bare 4-digit number ("1958") technically matches ISO_8601's optional
  // groups too — require something beyond the bare year (a dash or T) so a
  // plain magnitude column never gets promoted to "full ISO date" here.
  return ISO_8601.test(v) && !BARE_YEAR.test(v);
}

function checkTemporal(name, sampled) {
  const n = sampled.length;
  if (n === 0) return { type: 'none' };

  const isoMatches = sampled.filter((v) => isFullDateIso(v)).length;
  if (isoMatches === n) return { type: 'temporal' };

  const textualMatches = sampled.filter((v) => TEXTUAL_MONTH.test(v)).length;
  if (textualMatches === n) return { type: 'temporal' };

  if (NAME_HINT_YEAR.test(name)) {
    const allBareYear = sampled.every((v) => BARE_YEAR.test(v));
    if (allBareYear) {
      const years = sampled.map(Number);
      const inRange = years.every((y) => y >= 1500 && y <= 2100);
      const distinctYears = new Set(years).size;
      if (inRange && distinctYears >= MIN_YEAR_DISTINCT) return { type: 'temporal' };
    }
  }

  // Ambiguous slash-dates (MM/DD vs DD/MM) — never a guess, always nominal+warning.
  const slashMatches = sampled.filter((v) => SLASH_DATE.test(v)).length;
  const dateLikeMatches = sampled.filter((v) => isFullDateIso(v) || SLASH_DATE.test(v)).length;
  if (slashMatches > 0 && dateLikeMatches === n) {
    return { type: 'ambiguous', count: slashMatches };
  }

  return { type: 'none' };
}

// ---------------------------------------------------------------------------
// Ordinal heuristic (known-set match only)
// ---------------------------------------------------------------------------

function isOrdinal(sampled) {
  const lower = sampled.map((v) => v.toLowerCase());
  return ORDINAL_SETS.some((set) => lower.every((v) => set.includes(v)));
}

// ---------------------------------------------------------------------------
// inferFields
// ---------------------------------------------------------------------------

function toStr(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function inferField(name, rows) {
  const total = rows.length;
  const raw = rows.map((r) => toStr(r ? r[name] : undefined));

  const nonNullValues = [];
  let missing = 0;
  for (const v of raw) {
    if (v === '') missing++;
    else nonNullValues.push(v);
  }

  // --- all-null column ---
  if (nonNullValues.length === 0) {
    return {
      name,
      type: 'nominal',
      cardinality: 0,
      missing,
      note: 'no non-empty values',
      _warnings: [
        {
          code: 'all-null-column',
          field: name,
          message: `Column "${name}" has no non-empty values.`,
          count: total,
        },
      ],
    };
  }

  const distinctSet = new Set(nonNullValues);
  const sampled = nonNullValues.slice(0, MAX_SAMPLE);

  // --- temporal (checked BEFORE numeric — a bare-year column like gapminder's
  // `year` is numeric-looking too, and must be classified temporal, not
  // quantitative, per the name-hint rule below) ---
  const temporalResult = checkTemporal(name, sampled);
  if (temporalResult.type === 'temporal') {
    return { name, type: 'temporal', cardinality: distinctSet.size, missing };
  }
  if (temporalResult.type === 'ambiguous') {
    return {
      name,
      type: 'nominal',
      cardinality: distinctSet.size,
      missing,
      note: 'ambiguous date format',
      _warnings: [
        {
          code: 'ambiguous-date-format',
          field: name,
          message: `Column "${name}" looks date-like but format is ambiguous (MM/DD vs DD/MM) — treated as nominal.`,
          count: temporalResult.count,
        },
      ],
    };
  }

  // --- quantitative (>=95% of sampled non-null values look numeric) ---
  const numericFlags = sampled.map(looksNumeric);
  const numericPassCount = numericFlags.filter(Boolean).length;
  const numericRatio = numericPassCount / sampled.length;

  if (numericRatio >= 0.95) {
    const distinctRatio = distinctSet.size / nonNullValues.length;
    const isIdByName = NAME_HINT_ID.test(name);
    const isMonotonic = isMonotonicIntegerSequence(nonNullValues);

    if (distinctRatio >= 0.98 && (isIdByName || isMonotonic)) {
      return {
        name,
        type: 'nominal',
        cardinality: distinctSet.size,
        missing,
        identifier: true,
      };
    }

    const warns = [];
    const nonNumericCount = sampled.length - numericPassCount;
    if (nonNumericCount > 0) {
      warns.push({
        code: 'non-numeric-values-treated-as-missing',
        field: name,
        message: `Column "${name}": ${nonNumericCount} non-numeric value(s) treated as missing.`,
        count: nonNumericCount,
      });
    }

    return {
      name,
      type: 'quantitative',
      cardinality: distinctSet.size,
      missing,
      _warnings: warns,
    };
  }

  // --- ordinal (known-set match only) ---
  if (isOrdinal(sampled)) {
    return { name, type: 'ordinal', cardinality: distinctSet.size, missing };
  }

  // --- nominal (categorical vs free-text) ---
  const distinctRatio = distinctSet.size / nonNullValues.length;
  if (distinctRatio > 0.9) {
    return {
      name,
      type: 'nominal',
      cardinality: distinctSet.size,
      missing,
      note: 'free text',
      _warnings: [
        {
          code: 'free-text-column',
          field: name,
          message: `Column "${name}" is high-cardinality (${distinctSet.size} distinct of ${nonNullValues.length}); treated as free text, not a grouping category.`,
          count: distinctSet.size,
        },
      ],
    };
  }

  return { name, type: 'nominal', cardinality: distinctSet.size, missing };
}

export function inferFields(rows, headers) {
  return (headers || []).map((name) => inferField(name, rows || []));
}

// ---------------------------------------------------------------------------
// deriveShape — structural, deterministic rules (06-RESEARCH.md's
// Shape-Flag Derivation table). ALWAYS returns all seven keys, with
// categoryCardinality/pointCount as numbers (0 default) — an omitted value
// doesn't fail recommend.mjs's honesty filter, it silently DISABLES it.
// ---------------------------------------------------------------------------

const MIN_DISTRIBUTION_POINTS = 20;
const MAX_PART_TO_WHOLE_CATEGORIES = 8;
const CATEGORICAL_RATIO_CEILING = 0.5;

const SOURCE_HINT = /source|origin|from/i;
const TARGET_HINT = /target|destination|to/i;

function nonNullCount(field, total) {
  return total - (field.missing || 0);
}

function isCategoricalField(field, total) {
  if (field.type !== 'nominal' && field.type !== 'ordinal') return false;
  if (field.identifier) return false;
  const nonNull = nonNullCount(field, total);
  if (nonNull <= 0) return false;
  return (field.cardinality || 0) / nonNull <= CATEGORICAL_RATIO_CEILING;
}

function rowValue(row, name) {
  return row ? row[name] : undefined;
}

function parseNumericCell(raw) {
  const v = toStr(raw);
  if (v === '') return 0;
  let stripped = v.replace(CURRENCY, '').replace(PERCENT, '');
  if (US_THOUSANDS.test(stripped)) stripped = stripped.replace(/,/g, '');
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? n : 0;
}

/**
 * detectFlow(fields, rows) -> { isFlow, kind, originField?, numericCols? }
 * ONLY two structural shapes ever set isFlow:true (06-RESEARCH.md finding #3
 * — flow-field's vector-field precondition is otherwise entirely
 * unenforced downstream; this profiler is the only real gate):
 *   (a) an explicit source/target(+value) edge-list
 *   (b) a square categorical(origin) x numeric(destination-named) matrix
 * A plain multi-quantitative dataset is NEVER flow just because it "could" be.
 */
function detectFlow(fields, rows) {
  const sourceField = fields.find((f) => SOURCE_HINT.test(f.name));
  const targetField = fields.find((f) => TARGET_HINT.test(f.name));
  if (sourceField && targetField) {
    return { isFlow: true, kind: 'edgelist', sourceField, targetField };
  }

  const categoricalCandidates = fields.filter((f) => f.type === 'nominal' || f.type === 'ordinal');
  const numericCols = fields.filter((f) => f.type === 'quantitative');
  if (categoricalCandidates.length === 0 || numericCols.length === 0) return { isFlow: false };

  const numericNames = new Set(numericCols.map((f) => f.name.trim().toLowerCase()));
  for (const originField of categoricalCandidates) {
    const values = new Set(
      rows.map((r) => String(rowValue(r, originField.name) ?? '').trim().toLowerCase()).filter((v) => v !== '')
    );
    if (values.size === 0) continue;
    if ([...values].every((v) => numericNames.has(v))) {
      return { isFlow: true, kind: 'matrix', originField, numericCols };
    }
  }
  return { isFlow: false };
}

/**
 * buildFlowMatrix(originField, numericCols, rows) -> Map<origin, Map<dest, value>>
 * Lowercased keys throughout so origin-row labels match numeric-column names
 * case-insensitively, matching detectFlow's own matching rule.
 */
function buildFlowMatrix(originField, numericCols, rows) {
  const matrix = new Map();
  for (const row of rows) {
    const origin = String(rowValue(row, originField.name) ?? '').trim().toLowerCase();
    if (origin === '') continue;
    const inner = matrix.get(origin) || new Map();
    for (const col of numericCols) {
      const key = col.name.trim().toLowerCase();
      inner.set(key, parseNumericCell(rowValue(row, col.name)));
    }
    matrix.set(origin, inner);
  }
  return matrix;
}

/**
 * hasCycle(matrix) -> boolean
 * 2-cycle check: for every unordered pair (A,B), A->B>0 AND B->A>0 is a real
 * bidirectional cycle. Sufficient and cheap at this project's scale (every
 * seriesLimits.maxCategories ceiling in the manifest is <=12 nodes).
 */
function hasCycle(matrix) {
  const origins = [...matrix.keys()];
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const a = origins[i];
      const b = origins[j];
      const ab = matrix.get(a)?.get(b) || 0;
      const ba = matrix.get(b)?.get(a) || 0;
      if (ab > 0 && ba > 0) return true;
    }
  }
  return false;
}

function isNonNegativeField(field, rows) {
  for (const row of rows) {
    const v = toStr(rowValue(row, field.name));
    if (v === '') continue;
    const n = parseNumericCell(v);
    if (n < 0) return false;
  }
  return true;
}

export function deriveShape(fields, rows) {
  const total = (rows || []).length;
  const safeFields = fields || [];
  const safeRows = rows || [];

  const hasTimeAxis = safeFields.some((f) => f.type === 'temporal');

  // A co-occurring categorical field alongside a temporal one (e.g.
  // gapminder's `country`/`continent` alongside `year`) is structurally
  // ambiguous: it could mean "break this time series into N lines" or it
  // could be an orthogonal grouping dimension entirely (which reading is
  // right can't be told from structure alone) -- CONTEXT.md's own explicit
  // deferral principle ("where shape can't be inferred from structure alone,
  // defer to intent, do NOT guess") applies. This matters mechanically, not
  // just philosophically: recommend.mjs's seriesLimitsExceeded() applies
  // shape.categoryCardinality FLATLY to every eligible technique regardless
  // of that technique's own dataShapes, so an honestly-reported
  // categoryCardinality from an orthogonal grouping field would incorrectly
  // exclude single-series change-over-time techniques (e.g. `line`,
  // seriesLimits.maxCategories:1) that have nothing to do with that
  // grouping. Only surface categorical structure when there's no competing
  // temporal axis to disambiguate against.
  const categoricalFields = hasTimeAxis ? [] : safeFields.filter((f) => isCategoricalField(f, total));
  const hasCategories = categoricalFields.length > 0;
  const categoricalMaxCardinality = hasCategories
    ? Math.max(...categoricalFields.map((f) => f.cardinality || 0))
    : 0;

  // Multi-quantitative -> ALSO correlation downstream is intended (see the
  // top-of-file note); this profiler makes no attempt to suppress it.
  const quantFields = safeFields.filter((f) => f.type === 'quantitative' && !f.identifier);
  const distributionCounts = quantFields
    .map((f) => nonNullCount(f, total))
    .filter((c) => c >= MIN_DISTRIBUTION_POINTS);
  const isDistribution = distributionCounts.length > 0;
  const pointCount = isDistribution ? Math.max(...distributionCounts) : 0;

  const flow = detectFlow(safeFields, safeRows);
  const isFlow = flow.isFlow;
  let hasCycles = false;
  let flowCardinality = 0;
  if (isFlow && flow.kind === 'matrix') {
    const matrix = buildFlowMatrix(flow.originField, flow.numericCols, safeRows);
    hasCycles = hasCycle(matrix);
    flowCardinality = matrix.size;
  } else if (isFlow && flow.kind === 'edgelist') {
    // REC-06: chord's real binding shape (source/target edge list) has no
    // node count at all today without this — undercounting lets an
    // over-cardinality upload silently pass chord's
    // seriesLimits.maxCategories:12 ceiling. Mirrors chord.mjs's own shaper:
    // the true node count is the UNION of distinct source and target
    // values, not either column alone (a disjoint source/target name set,
    // e.g. "region A" -> "region B" migration flows, undercounts by ~half
    // if only one column were counted).
    const nodes = new Set();
    for (const row of safeRows) {
      const s = String(rowValue(row, flow.sourceField.name) ?? '').trim().toLowerCase();
      const t = String(rowValue(row, flow.targetField.name) ?? '').trim().toLowerCase();
      if (s !== '') nodes.add(s);
      if (t !== '') nodes.add(t);
    }
    flowCardinality = nodes.size;
    // hasCycles intentionally stays false for edge-list flow: hasCycle()'s
    // 2-cycle bidirectional-pair check is matrix-only (adjacency-map
    // shaped). No atlas edge-list-shaped technique currently declares an
    // acyclic-flow precondition (only matrix-shaped chord does, and its
    // ceiling is the cardinality check above, not cycle detection) — a real
    // edge-list cycle detector (scripts/lib/graph.mjs's DFS detectCycle,
    // already used by shapers) is a separate, larger scope than this plan.
  }
  const categoryCardinality = Math.max(categoricalMaxCardinality, flowCardinality);

  // Structurally ambiguous with magnitude BY DESIGN (06-RESEARCH.md) — set in
  // ADDITION to, never instead of, hasCategories+magnitude's own trigger.
  // Stage-2 ranking + Phase 8's intent layer resolve which reading a human meant.
  const lowCardCategorical = categoricalFields.filter((f) => (f.cardinality || 0) <= MAX_PART_TO_WHOLE_CATEGORIES);
  const nonNegativeQuant = quantFields.filter((f) => isNonNegativeField(f, safeRows));
  const isPartToWhole = lowCardCategorical.length === 1 && nonNegativeQuant.length === 1;

  return {
    hasTimeAxis,
    isFlow,
    isPartToWhole,
    isDistribution,
    hasCategories,
    categoryCardinality,
    pointCount,
    hasCycles,
  };
}

// ---------------------------------------------------------------------------
// profile — parse wrapper
// ---------------------------------------------------------------------------

function mapPapaError(err) {
  return {
    code: err.code || err.type || 'ParseError',
    message: `Row ${err.row ?? '?'}: ${err.message}`,
  };
}

export function profile(text, opts = {}) {
  const format = opts.format || 'csv';
  const warnings = [];

  // Defensively strip a leading UTF-8 BOM regardless of Papa Parse's own
  // default behavior (06-RESEARCH.md Open Question #1 — unconfirmed either
  // way, cheap and deterministic to just always do it).
  let raw = text ?? '';
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let rows = [];
  let headers = [];

  if (format === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      warnings.push({ code: 'json-parse-error', message: `Could not parse JSON: ${err.message}` });
      return { fields: [], shape: deriveShape([], []), warnings };
    }
    if (!Array.isArray(parsed)) {
      // Nested-tree JSON support (21-02, HIER-02) -- a hierarchy dataset's
      // JSON root is a single tree node ({name, children:[...]}), never an
      // array of row objects. Additive-only: every OTHER non-array JSON
      // shape (an arbitrary object with no `children` array) keeps the
      // pre-existing 'json-not-array' warning/early-return unchanged. A
      // genuine tree root is instead wrapped as a single-element `rows`
      // array so a hierarchy shaper's `shape([treeRoot], bindings)` can pull
      // `rows[0]` straight through to `d3.hierarchy()`. dataBinding.shape:
      // 'tree' fragments declare `roles: []` so the generic per-column
      // validateBinding() (which needs `profile.fields`, meaningless for a
      // tree) is a no-op and never blocks this path.
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.children)) {
        return { fields: [], shape: deriveShape([], []), warnings, rows: [parsed] };
      }
      // Graph-shape JSON support (22-03, NET-03) -- a network dataset's JSON
      // root is {nodes:[...], links:[...]} (data/lesmiserables.json), never
      // an array of row objects. Mirrors the tree-root branch immediately
      // above: wrap the whole parsed graph as a single-element `rows` array
      // so a graph shaper's `shape([graphRoot], bindings)` can pull
      // `rows[0]` straight through to build node/link structures.
      // dataBinding.shape: 'graph' fragments declare `roles: []` (the same
      // roles-empty exception 'tree' uses) so the generic per-column
      // validateBinding() is a no-op and never blocks this path.
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && Array.isArray(parsed.links)) {
        return { fields: [], shape: deriveShape([], []), warnings, rows: [parsed] };
      }
      warnings.push({ code: 'json-not-array', message: 'Expected a JSON array of row objects.' });
      return { fields: [], shape: deriveShape([], []), warnings };
    }
    const headerSet = new Set();
    for (const row of parsed) {
      if (row && typeof row === 'object') {
        for (const k of Object.keys(row)) headerSet.add(k);
      }
    }
    headers = [...headerSet];
    rows = parsed;
  } else {
    // CSV/TSV both go through Papa Parse's own delimiter auto-detection
    // (delimitersToGuess left at its documented default: comma/tab/pipe/
    // semicolon) — INTAKE-01. `format` doesn't force a delimiter.
    let normalizedHeaderCount = 0;
    const result = Papa.parse(raw, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: 'greedy',
      comments: '#',
      transformHeader: (h) => {
        const normalized = normalizeHeader(h);
        if (normalized !== h) normalizedHeaderCount++;
        return normalized;
      },
    });

    headers = result.meta.fields || [];
    rows = result.data || [];

    for (const err of result.errors || []) {
      warnings.push(mapPapaError(err));
    }
    if (normalizedHeaderCount > 0) {
      warnings.push({
        code: 'header-normalized',
        message: `Normalized unusual characters in ${normalizedHeaderCount} column header(s).`,
        count: normalizedHeaderCount,
      });
    }

    // (06-03, app/routes/intake.mjs POST /intake, INTAKE-06 sample-load) A
    // genuinely undetectable delimiter (e.g. a space-delimited matrix with
    // quoted multi-word labels, like data/migration_region_flows.csv) makes
    // Papa collapse the whole line into ONE header field and then fail
    // every subsequent row against it — never a crash, but a silent,
    // useless single-column profile with no explanation. Surface it as one
    // clear, specific warning (never guess a delimiter fallback here) —
    // verified this never fires on any of this project's existing clean
    // fixtures (only on genuinely undetectable-delimiter input).
    if (headers.length <= 1 && (result.errors || []).length > 5) {
      warnings.push({
        code: 'unrecognized-delimiter',
        message:
          "This file's column delimiter could not be reliably detected — showing a best-effort, likely-incomplete profile.",
      });
    }
  }

  const fields = inferFields(rows, headers);
  for (const f of fields) {
    if (f._warnings) {
      warnings.push(...f._warnings);
      delete f._warnings;
    }
  }

  const shape = deriveShape(fields, rows);

  // `rows` is additive (Plan 03, app/routes/intake.mjs): the override
  // endpoint must re-run deriveShape() SERVER-SIDE against the ORIGINAL
  // parsed rows whenever a user changes a column's type — never against a
  // client-supplied re-parse. Existing consumers destructuring
  // { fields, shape, warnings } are unaffected by this extra key.
  return { fields, shape, warnings, rows };
}

// --- CLI ---
// node scripts/profile.mjs <path-to-file> [--format csv|tsv|json]
// Prints the profile JSON to stdout only (mirrors recommend.mjs's CLI
// contract) so it composes: `node scripts/profile.mjs data/x.csv | node
// scripts/recommend.mjs --profile "$(cat -)" --intent "..."`.

function parseCliArgs(argv) {
  const flags = { file: null, format: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') flags.format = argv[++i];
    else if (!flags.file) flags.file = argv[i];
  }
  return flags;
}

function formatFromFilename(file) {
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.tsv')) return 'tsv';
  return 'csv';
}

async function main() {
  const { file, format } = parseCliArgs(process.argv.slice(2));

  if (!file) {
    console.error('Usage: node scripts/profile.mjs <path-to-file> [--format csv|tsv|json]');
    process.exitCode = 1;
    return;
  }

  const text = await readFile(file, 'utf8');
  const result = profile(text, { format: format || formatFromFilename(file) });

  // stdout carries ONLY the JSON result — callers must be able to
  // JSON.parse(stdout) unconditionally (mirrors recommend.mjs's own contract).
  console.log(JSON.stringify(result, null, 2));
}

// Only run the CLI when this file is executed directly (not when imported by
// tests) — mirrors recommend.mjs/gate.mjs/pattern-scan.mjs's existing guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
