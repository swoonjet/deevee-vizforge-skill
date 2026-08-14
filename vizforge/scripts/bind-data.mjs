#!/usr/bin/env node
// scripts/bind-data.mjs
//
// BIND-02/04 (Phase 7 Plan 03) -- the shaper framework's generic binding
// validator + convention-based shaper dispatch. Read scripts/shapers/README.md
// for the full shaper contract every `scripts/shapers/<slug>.mjs` implements.
//
// Ethos (locked, 07-03-PLAN.md): honest failure over dishonest success.
// `validateBinding()` NEVER throws for an expected validation failure -- it
// always returns `[]` (fully valid) or an array of structured
// `{ channel, problem, remedy }` errors. `bindData()` validates BEFORE it
// shapes and NEVER calls a shaper's `shape()` when the binding is invalid --
// a malformed binding fails loudly in Node before any HTML is ever generated.
//
// bindingSpec shape (this project's own convention -- see
// scripts/shapers/README.md for the full contract):
//
//   {
//     [roleName]: string | string[],
//       // A single column name, OR -- only for a role the contract flags
//       // `multiColumn: true` -- an array of column names (e.g. streamgraph's
//       // `layers` role, wave 3).
//     aggregation?: { [roleName]: string },
//       // Optional per-role aggregation choice (must be one of that role's
//       // declared `aggregation` list). Absent entirely when a role has no
//       // aggregation choice to make.
//   }
//
// `regenerateFromDemoBinding` (scripts/lib/regenerate-scaffold.mjs) passes a
// fragment's `demoBinding.bindings` directly as bindingSpec.
//
// `contract` is a fragment's `dataBinding` block (BIND-01, scripts/build-manifest.mjs):
//   { shape, roles: [{ role, types, required, label, aggregation?, defaultAggregation?, multiColumn? }], pivotTo? }
//
// `profile` is scripts/profile.mjs's output: { fields, shape, warnings, rows }.
// bindData/validateBinding consume ONLY `fields` (name -> type) and `rows` --
// they never re-parse or re-derive anything profile.mjs already computed.

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * Normalizes one role's raw bindingSpec entry into `{ columns, error }`:
 *   - `columns`: an array of column-name strings actually bound, or `null`
 *     if nothing usable was bound (either genuinely absent, or a structural
 *     arity mismatch already recorded in `error`).
 *   - `error`: set only for a STRUCTURAL mismatch (wrong arity for the role --
 *     an array bound to a single-column role, or a bare string bound to a
 *     `multiColumn` role) -- reported without any further per-column checks.
 */
function normalizeRoleBinding(raw, role) {
  const isMulti = role.multiColumn === true;

  if (raw === undefined || raw === null || raw === '') {
    return { columns: null };
  }

  if (typeof raw === 'string') {
    if (isMulti) {
      return {
        columns: null,
        error: {
          channel: role.role,
          problem: `channel '${role.role}' requires multiple columns (an array of column names), but a single value was bound`,
          remedy: `bind an array of column names to '${role.role}'`,
        },
      };
    }
    return { columns: [raw] };
  }

  if (Array.isArray(raw)) {
    if (!isMulti) {
      return {
        columns: null,
        error: {
          channel: role.role,
          problem: `channel '${role.role}' accepts a single column, but an array was bound`,
          remedy: `bind a single column name to '${role.role}'`,
        },
      };
    }
    return { columns: raw.length > 0 ? raw : null };
  }

  return {
    columns: null,
    error: {
      channel: role.role,
      problem: `channel '${role.role}': binding value must be a column name string${isMulti ? ' or an array of column names' : ''}`,
      remedy: `bind '${role.role}' to a column name${isMulti ? ' or array of column names' : ''}`,
    },
  };
}

/**
 * validateBinding(bindingSpec, contract, profile) -> Array<{channel, problem, remedy}>
 *
 * Generic, technique-agnostic validation of a bindingSpec against a
 * fragment's `dataBinding` contract and a dataset's profile. Returns `[]`
 * when every role's binding is structurally sound; otherwise an array of
 * EVERY problem found (never stops at the first). NEVER throws for an
 * expected validation failure -- a malformed contract/profile is treated
 * defensively (missing arrays default to empty), not as a crash.
 *
 * Catches, per role:
 *   - a required role with no bound column
 *   - a bound column absent from `profile.fields`
 *   - a bound column whose profiled type is not in the role's accepted `types`
 *   - an aggregation choice not in the role's declared `aggregation` list
 *   - an all-null / non-coercible bound value column for a `quantitative`-typed
 *     bound column (checked directly against `profile.rows`, independent of
 *     what `profile.fields[].type` claims -- belt-and-suspenders)
 *   - a `multiColumn` role: each column in the bound array is validated
 *     individually against the role's `types`; a non-array binding for such
 *     a role is itself a structural error (see normalizeRoleBinding)
 */
export function validateBinding(bindingSpec, contract, profile) {
  const errors = [];
  const spec = bindingSpec || {};
  const roles = contract && Array.isArray(contract.roles) ? contract.roles : [];
  const fieldsByName = new Map((profile?.fields || []).map((f) => [f.name, f]));
  const rows = profile?.rows || [];
  const aggregationSpec = spec.aggregation && typeof spec.aggregation === 'object' ? spec.aggregation : {};

  for (const role of roles) {
    const raw = spec[role.role];
    const { columns, error } = normalizeRoleBinding(raw, role);

    if (error) {
      errors.push(error);
      continue;
    }

    if (!columns || columns.length === 0) {
      if (role.required) {
        errors.push({
          channel: role.role,
          problem: `required channel '${role.role}' has no column bound`,
          remedy: `bind a column of type ${(role.types || []).join(' or ')} to '${role.role}'`,
        });
      }
      continue;
    }

    const chosenAggregation = aggregationSpec[role.role];
    if (chosenAggregation !== undefined) {
      const allowed = role.aggregation || [];
      if (!allowed.includes(chosenAggregation)) {
        errors.push({
          channel: role.role,
          problem: `channel '${role.role}': aggregation '${chosenAggregation}' is not one of [${allowed.join(', ')}]`,
          remedy: `choose one of the declared aggregations for '${role.role}'${allowed.length ? `: ${allowed.join(', ')}` : ' (none declared)'}`,
        });
      }
    }

    for (const columnName of columns) {
      const field = fieldsByName.get(columnName);

      if (!field) {
        errors.push({
          channel: role.role,
          problem: `channel '${role.role}': bound column '${columnName}' is not present in the profiled dataset`,
          remedy: `bind '${role.role}' to one of the dataset's actual columns`,
        });
        continue;
      }

      const acceptedTypes = role.types || [];
      if (!acceptedTypes.includes(field.type)) {
        errors.push({
          channel: role.role,
          problem: `channel '${role.role}': column '${columnName}' is ${field.type} but this channel requires ${acceptedTypes.join(' or ')}`,
          remedy: `bind '${role.role}' to a column typed ${acceptedTypes.join(' or ')}`,
        });
        continue;
      }

      // Belt-and-suspenders all-null/non-coercible check: independent of
      // profile.fields[].type (profile.mjs itself would already classify a
      // truly all-null column as nominal, not quantitative -- this guards
      // any profile, hand-built or otherwise, that claims quantitative for a
      // column whose actual bound values can't compute an aggregation).
      if (field.type === 'quantitative') {
        const anyCoercible = rows.some((r) => isCoercibleNumber(r ? r[columnName] : undefined));
        if (!anyCoercible) {
          errors.push({
            channel: role.role,
            problem: `channel '${role.role}': column '${columnName}' has no coercible numeric values (all-null or non-coercible) -- cannot compute an aggregation`,
            remedy: `bind '${role.role}' to a column with at least one real numeric value`,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * bindData(slug, rows, bindingSpec, { contract, profile, shapersDir? }) ->
 *   Promise<{ ok: true, data } | { ok: false, errors }>
 *
 * Runs `validateBinding()` FIRST. If it returns any errors, resolves to
 * `{ ok:false, errors }` WITHOUT ever importing or calling the technique's
 * shaper -- a malformed binding fails loudly before any HTML is generated.
 *
 * Otherwise dynamically imports `scripts/shapers/<slug>.mjs` BY CONVENTION
 * (never a shared registry file -- adding a technique's shaper is a NEW
 * file, never an edit to shared code, mirroring the per-fragment manifest
 * split), runs its technique-specific `validate()`, and only then calls its
 * `shape()`.
 *
 * @param {string} slug
 * @param {object[]} rows
 * @param {object} bindingSpec
 * @param {{contract: object, profile: object, shapersDir?: string|URL}} opts
 *   `shapersDir` is an optional override (a `file://` base URL, or a string
 *   passed to `new URL()`) used ONLY by this project's own tests to point at
 *   a fixtures directory instead of the real `scripts/shapers/` -- real
 *   callers never pass it, so production dispatch always resolves
 *   `scripts/shapers/<slug>.mjs` relative to this file.
 */
export async function bindData(slug, rows, bindingSpec, { contract, profile, shapersDir } = {}) {
  const genericErrors = validateBinding(bindingSpec, contract, profile);
  if (genericErrors.length > 0) {
    return { ok: false, errors: genericErrors };
  }

  const base = shapersDir
    ? shapersDir instanceof URL
      ? shapersDir
      : new URL(shapersDir)
    : new URL('./shapers/', import.meta.url);

  let shaperModule;
  try {
    shaperModule = await import(new URL(`${slug}.mjs`, base));
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          channel: '*',
          problem: `no shaper registered for "${slug}" (${err.message})`,
          remedy: `create scripts/shapers/${slug}.mjs exporting shape(rows, bindings) and validate(rows, bindings, {contract, profile})`,
        },
      ],
    };
  }

  if (typeof shaperModule.validate === 'function') {
    const shaperErrors = shaperModule.validate(rows, bindingSpec, { contract, profile }) || [];
    if (shaperErrors.length > 0) {
      return { ok: false, errors: shaperErrors };
    }
  }

  const data = shaperModule.shape(rows, bindingSpec);
  return { ok: true, data };
}
