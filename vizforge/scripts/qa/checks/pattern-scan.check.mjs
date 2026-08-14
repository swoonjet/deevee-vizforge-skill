// scripts/qa/checks/pattern-scan.check.mjs
//
// Wraps scripts/qa/pattern-scan.mjs's scanHtml() as a gate check module —
// absorbed, not duplicated (docs/qa-schemas.md contract #4, 02-CONTEXT.md's
// "Phase 1's contrast-check/tnum-check/pattern-scan get absorbed/wrapped, not
// duplicated" locked decision).

import { scanHtml, loadApprovedHexColors } from '../pattern-scan.mjs';

export const name = 'pattern-scan';
export const needs = ['html'];

export async function run(ctx) {
  const approvedHexColors = await loadApprovedHexColors();
  const { fails, warns } = scanHtml(ctx.html, approvedHexColors);

  if (fails.length > 0) {
    return { name, severity: 'VIOLATION', evidence: fails.join('; ') };
  }
  if (warns.length > 0) {
    return { name, severity: 'CAUTION', evidence: warns.join('; ') };
  }
  return { name, severity: 'PASS', evidence: 'no banned patterns; required <h1> and Source: elements present' };
}
