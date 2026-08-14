// scripts/qa/checks/self-contained.check.mjs
//
// Self-containment check (PIPE-01): every piece must fire zero non-file://
// network requests. Reuses session.mjs's request log (populated the same
// way capture.mjs's page.on('request') guard works) — never re-renders.

export const name = 'self-contained';
export const needs = ['requests'];

export async function run(ctx) {
  const requests = ctx.requests ?? [];

  if (requests.length > 0) {
    return {
      name,
      severity: 'VIOLATION',
      evidence: `${requests.length} non-file:// request(s) fired: ${requests.join(', ')}`,
    };
  }

  return { name, severity: 'PASS', evidence: 'zero external requests' };
}
