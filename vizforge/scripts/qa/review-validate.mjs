// scripts/qa/review-validate.mjs
//
// QA-02 mechanical review validator. The reviewing agent's own self-declared
// verdict is advisory only — this module is the source of truth, per
// docs/qa-schemas.md contract #3 (locked rules):
//
//   - answerable:false  -> automatic CAUTION
//   - contradicted:true -> automatic VIOLATION
//
// Contradiction can be self-declared by the reviewing agent, or forced by a
// field's crossCheck against a .gate.json sidecar's evidence (extractive
// verification against the mechanical gate's own findings — the anti-
// rubber-stamp mitigation for same-model self-preference bias,
// docs/review-protocol.md / 02-RESEARCH.md).
//
// CLI usage:
//   node scripts/qa/review-validate.mjs <review.json> [--gate <gate.json>]
//
// Library usage (what the smoke test drives directly):
//   import { validateReview, validateRubric } from './review-validate.mjs';

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rubricsDir = path.join(__dirname, 'rubrics');

const EVIDENCE_TYPES = new Set(['int', 'string', 'quote', 'hexList', 'boolean']);
const CROSS_CHECK_RELATIONS = new Set(['subsetOf', 'equals', 'includedIn']);

/**
 * Structural check of a rubric family file — every field has id/prompt/
 * evidenceType (one of the fixed five, never a holistic 1-10 score)/required.
 * Returns an array of error strings (empty = valid).
 */
export function validateRubric(rubric) {
  const errors = [];

  if (!rubric || typeof rubric !== 'object') {
    return ['rubric must be an object'];
  }
  if (typeof rubric.family !== 'string' || rubric.family.length === 0) {
    errors.push('rubric.family must be a non-empty string');
  }
  if (!Array.isArray(rubric.fields) || rubric.fields.length === 0) {
    errors.push('rubric.fields must be a non-empty array');
    return errors;
  }

  const seenIds = new Set();
  for (const field of rubric.fields) {
    const id = field?.id;
    if (!id || typeof id !== 'string') {
      errors.push('field missing a non-empty string id');
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`duplicate field id "${id}"`);
    }
    seenIds.add(id);

    if (!field.prompt || typeof field.prompt !== 'string') {
      errors.push(`field "${id}": missing prompt`);
    }
    if (!EVIDENCE_TYPES.has(field.evidenceType)) {
      errors.push(
        `field "${id}": evidenceType "${field.evidenceType}" not in {${[...EVIDENCE_TYPES].join(', ')}} — no holistic scores allowed`
      );
    }
    if (typeof field.required !== 'boolean') {
      errors.push(`field "${id}": required flag must be a boolean`);
    }
    if (field.crossCheck) {
      if (!CROSS_CHECK_RELATIONS.has(field.crossCheck.relation)) {
        errors.push(
          `field "${id}": crossCheck.relation "${field.crossCheck.relation}" not in {${[...CROSS_CHECK_RELATIONS].join(', ')}}`
        );
      }
      if (!field.crossCheck.check || !field.crossCheck.path) {
        errors.push(`field "${id}": crossCheck missing "check" or "path"`);
      }
    }
  }

  return errors;
}

function getPath(obj, dotPath) {
  if (obj === undefined || obj === null) return undefined;
  return dotPath
    .split('.')
    .reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) return value.map(normalizeForCompare).sort();
  if (typeof value === 'string') return value.toLowerCase().trim();
  return value;
}

function relationHolds(relation, cited, evidenceValue) {
  switch (relation) {
    case 'subsetOf': {
      const citedArr = Array.isArray(cited) ? cited : [cited];
      const evidenceArr = Array.isArray(evidenceValue) ? evidenceValue : [evidenceValue];
      const evidenceSet = new Set(evidenceArr.map(normalizeForCompare));
      return citedArr.every((v) => evidenceSet.has(normalizeForCompare(v)));
    }
    case 'equals':
      return JSON.stringify(normalizeForCompare(cited)) === JSON.stringify(normalizeForCompare(evidenceValue));
    case 'includedIn': {
      const citedStr = typeof cited === 'string' ? cited : JSON.stringify(cited);
      const evidenceStr = typeof evidenceValue === 'string' ? evidenceValue : JSON.stringify(evidenceValue);
      return evidenceStr.includes(citedStr);
    }
    default:
      return true;
  }
}

/**
 * Evaluates one field's crossCheck definition against a parsed .gate.json
 * sidecar. Returns { evaluated, holds, reason }. `evaluated: false` means the
 * gate sidecar didn't contain a matching check/path to compare against — this
 * does NOT force a contradiction (we can't verify, so we don't punish).
 */
export function evaluateCrossCheckField(cited, crossCheck, gate) {
  const check = gate?.checks?.find((c) => c.name === crossCheck.check);
  if (!check) {
    return {
      evaluated: false,
      holds: true,
      reason: `gate has no check named "${crossCheck.check}"`,
    };
  }
  const evidenceValue = getPath(check.evidence, crossCheck.path);
  if (evidenceValue === undefined) {
    return {
      evaluated: false,
      holds: true,
      reason: `gate check "${crossCheck.check}" evidence has no path "${crossCheck.path}"`,
    };
  }
  const holds = relationHolds(crossCheck.relation, cited, evidenceValue);
  return {
    evaluated: true,
    holds,
    reason: holds
      ? null
      : `crossCheck ${crossCheck.relation} against ${crossCheck.check}.${crossCheck.path} failed (cited ${JSON.stringify(cited)}, gate evidence ${JSON.stringify(evidenceValue)})`,
  };
}

function typeCheckValue(evidenceType, value) {
  switch (evidenceType) {
    case 'int':
      return typeof value === 'number' && Number.isInteger(value);
    case 'string':
    case 'quote':
      return typeof value === 'string' && value.trim().length > 0;
    case 'hexList':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => typeof v === 'string' && /#[0-9a-f]{6}/i.test(v))
      );
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/**
 * The mechanical core. Validates `review` against `rubric` (and optionally
 * cross-checks against a parsed `gate` sidecar), and returns either:
 *   { ok: false, schemaErrors: string[] }   — structurally/typing invalid
 *   { ok: true, review: <recomputed review object> }
 *
 * The returned review's fields/verdict/cautions/violations are RECOMPUTED —
 * the input review's self-declared verdict/cautions/violations are ignored
 * on output (this module is the source of truth), though a field's own
 * self-declared `contradicted: true` is still honored as a VIOLATION input.
 */
export function validateReview(review, rubric, gate = null) {
  const rubricErrors = validateRubric(rubric);
  if (rubricErrors.length > 0) {
    return { ok: false, schemaErrors: rubricErrors };
  }

  if (!review || typeof review !== 'object') {
    return { ok: false, schemaErrors: ['review must be an object'] };
  }
  if (review.family !== rubric.family) {
    return {
      ok: false,
      schemaErrors: [`review.family "${review.family}" does not match rubric.family "${rubric.family}"`],
    };
  }

  const schemaErrors = [];
  const fieldsOut = {};
  const cautions = [];
  const violations = [];

  for (const fieldDef of rubric.fields) {
    const entry = review.fields?.[fieldDef.id];

    if (!entry) {
      if (fieldDef.required) {
        schemaErrors.push(`missing required field "${fieldDef.id}"`);
      }
      continue;
    }

    const answerable = entry.answerable !== false; // default true when unspecified

    if (!answerable) {
      const selfContradicted = entry.contradicted === true;
      fieldsOut[fieldDef.id] = { cited: entry.cited ?? null, answerable: false, contradicted: selfContradicted };
      cautions.push(`${fieldDef.id}: unanswerable`);
      if (selfContradicted) {
        violations.push(`${fieldDef.id}: contradicted (self-declared)`);
      }
      continue;
    }

    if (!typeCheckValue(fieldDef.evidenceType, entry.cited)) {
      schemaErrors.push(
        `field "${fieldDef.id}": cited value fails type check for evidenceType "${fieldDef.evidenceType}" (got ${JSON.stringify(entry.cited)})`
      );
      continue;
    }

    let contradicted = entry.contradicted === true;
    let crossCheckReason = null;

    if (gate && fieldDef.crossCheck) {
      const result = evaluateCrossCheckField(entry.cited, fieldDef.crossCheck, gate);
      if (result.evaluated && !result.holds) {
        contradicted = true;
        crossCheckReason = result.reason;
      }
    }

    fieldsOut[fieldDef.id] = { cited: entry.cited, answerable: true, contradicted };

    if (contradicted) {
      violations.push(`${fieldDef.id}: contradicted${crossCheckReason ? ' — ' + crossCheckReason : ' (self-declared)'}`);
    }
  }

  if (schemaErrors.length > 0) {
    return { ok: false, schemaErrors };
  }

  const verdict = violations.length > 0 ? 'FAIL' : 'PASS';

  return {
    ok: true,
    review: {
      ...review,
      fields: fieldsOut,
      verdict,
      cautions,
      violations,
    },
  };
}

function printReport(reviewPath, updatedReview) {
  console.log(`Review: ${reviewPath} (family: ${updatedReview.family})`);
  for (const [id, entry] of Object.entries(updatedReview.fields)) {
    const flag = entry.contradicted ? 'VIOLATION' : entry.answerable === false ? 'CAUTION' : 'ok';
    console.log(`  ${id}: ${flag} — cited=${JSON.stringify(entry.cited)}`);
  }
  console.log(`Cautions: ${updatedReview.cautions.length}`);
  for (const c of updatedReview.cautions) console.log(`  - ${c}`);
  console.log(`Violations: ${updatedReview.violations.length}`);
  for (const v of updatedReview.violations) console.log(`  - ${v}`);
  console.log(`Verdict: ${updatedReview.verdict}`);
}

async function main() {
  const args = process.argv.slice(2);
  const gateIdx = args.indexOf('--gate');
  const gatePathArg = gateIdx !== -1 ? args[gateIdx + 1] : null;
  const reviewPathArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--gate');

  if (!reviewPathArg) {
    console.error('Usage: node scripts/qa/review-validate.mjs <review.json> [--gate <gate.json>]');
    process.exit(2);
  }

  let review;
  try {
    review = JSON.parse(await readFile(reviewPathArg, 'utf8'));
  } catch (err) {
    console.error(`Cannot read/parse review file "${reviewPathArg}": ${err.message}`);
    process.exit(2);
  }

  const rubricPath = path.join(rubricsDir, `${review.family}.json`);
  let rubric;
  try {
    rubric = JSON.parse(await readFile(rubricPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot load rubric for family "${review.family}" at ${rubricPath}: ${err.message}`);
    process.exit(2);
  }

  let gate = null;
  if (gatePathArg) {
    try {
      gate = JSON.parse(await readFile(gatePathArg, 'utf8'));
    } catch (err) {
      console.error(`Cannot read/parse gate file "${gatePathArg}": ${err.message}`);
      process.exit(2);
    }
  }

  const result = validateReview(review, rubric, gate);

  if (!result.ok) {
    console.error(`SCHEMA INVALID: ${reviewPathArg}`);
    for (const e of result.schemaErrors) console.error(`  - ${e}`);
    process.exit(2);
  }

  printReport(reviewPathArg, result.review);

  await writeFile(reviewPathArg, JSON.stringify(result.review, null, 2) + '\n', 'utf8');

  process.exit(result.review.verdict === 'FAIL' ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
