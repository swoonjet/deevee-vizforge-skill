// scripts/qa/checks/legend-required.check.mjs
//
// Legend-required honesty check (24-01, EXP-01/EXP-02). Expressive-register
// glyph pieces (Fragapane botanical glyphs, Stefaner petal small-multiples)
// invite a specific lie: decorative ornament that LOOKS like it encodes data
// but has no declared, legend-keyed channel behind it — chartjunk dressed up
// as a "designed" data-art mark. This check makes the phase's core honesty
// rule mechanical: for a family:'expressive' piece, every data-bearing
// declared visual channel (tier-3 meta.mapping[] entry) MUST have a
// rendered, non-empty legend entry, and every rendered legend entry must
// correspond to a declared mapping entry. Ornament is a subset of the
// legend, which is a subset of the mapping — enforced by machine, not by
// documentation (docs/expressive-vocabulary.md's "forbid un-mapped
// ornament" rule).
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors network-position
// .check.mjs / geo-honesty.check.mjs / density-bandwidth.check.mjs):
// real work only when meta.family==='expressive'. Absence of `family` (all
// pre-existing scaffolds, and any expressive piece not built against this
// check) returns PASS-inert.
//
// 'none'-PREFIX EXEMPTION: a tier-3 mapping[] entry whose dataField starts
// with the literal 'none' (the established idiom for seeded aesthetic
// layers with no data behind them, e.g. hand-drawn's wobble seed) is
// data-BLIND and exempt from requiring a legend entry — only DATA-BEARING
// mapping entries (dataField NOT starting with 'none') are checked.
//
// LIVE-DOM READ (mirrors negative-geometry.check.mjs's needs=['page',...]
// pattern): the rendered legend is read via a live page.evaluate() query for
// `[data-legend-key]` elements, never a static-HTML string scan — this is a
// bijection between the RENDERED DOM and the declared meta.mapping[], not a
// source-text pattern match.

export const name = 'legend-required';
export const needs = ['meta', 'page'];

export async function run(ctx) {
  const meta = ctx.meta ?? {};

  if (meta.family !== 'expressive') {
    return {
      name,
      severity: 'PASS',
      evidence: 'not an expressive-family piece — legend-required not applicable',
    };
  }

  const mapping = Array.isArray(meta.mapping) ? meta.mapping : [];
  if (mapping.length === 0) {
    return {
      name,
      severity: 'VIOLATION',
      evidence: 'expressive-family piece has no meta.mapping — tier-3 mapping is required to declare every visual channel',
    };
  }

  const dataBearing = mapping.filter((m) => !String(m?.dataField).startsWith('none'));

  const rendered = await ctx.page.evaluate(() =>
    [...document.querySelectorAll('[data-legend-key]')].map((el) => ({
      key: el.getAttribute('data-legend-key'),
      text: (el.textContent || '').trim(),
    }))
  );

  const problems = [];

  if (dataBearing.length > 0 && rendered.length === 0) {
    problems.push(
      `0 rendered legend entries vs ${dataBearing.length} data-bearing mapping entries`
    );
  }

  const dataFieldSet = new Set(dataBearing.map((m) => String(m.dataField)));
  const renderedByKey = new Map();
  for (const entry of rendered) {
    renderedByKey.set(entry.key, entry);
  }
  const renderedKeySet = new Set(rendered.map((entry) => entry.key));

  // (a) every data-bearing mapping dataField must have a rendered legend entry.
  for (const dataField of dataFieldSet) {
    if (!renderedKeySet.has(dataField)) {
      problems.push(`data channel '${dataField}' has no rendered legend entry`);
    }
  }

  // (b) every rendered legend key must match a declared mapping dataField
  // (un-mapped ornament).
  for (const key of renderedKeySet) {
    if (!dataFieldSet.has(key)) {
      problems.push(`rendered legend key '${key}' matches no declared mapping dataField (un-mapped ornament)`);
    }
  }

  // (c) matched legend entries must render visible (non-empty) text.
  for (const dataField of dataFieldSet) {
    const entry = renderedByKey.get(dataField);
    if (entry && entry.text.length === 0) {
      problems.push(`legend entry '${dataField}' renders no visible text`);
    }
  }

  if (problems.length > 0) {
    return { name, severity: 'VIOLATION', evidence: problems.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `${dataBearing.length} data-bearing mapping entries, ${rendered.length} rendered legend entries, keys match exactly`,
  };
}
