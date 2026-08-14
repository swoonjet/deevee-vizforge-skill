// scripts/qa/checks/geo-honesty.check.mjs
//
// Geo-mark honesty check (19-04, FND-03). Choropleth/geospatial pieces have
// three well-known lie classes (docs/honesty-rules.md's new Geospatial row):
// (1) a non-equal-area projection (Mercator etc.) visually inflates
// high-latitude area, distorting the very comparison a choropleth invites;
// (2) encoding a RAW COUNT by color (rather than a rate/per-capita value)
// conflates population size with the phenomenon being mapped — the single
// most common geo lie; (3) Albers-USA's inset Alaska is rescaled ~0.35x by
// convention and MUST be disclosed, or a reader assumes true relative size.
// A schematic (non-geographic) hex-tilegram sidesteps (1)/(3) but must
// instead disclose it is schematic, not a true map.
//
// APPLICABILITY (FAMILY-SCOPED INERTNESS PATTERN, mirrors radial-baseline
// .check.mjs / area-encoding.check.mjs): real work only when
// meta.family==='geospatial'. Absence of `family` (every one of the 34
// existing scaffolds) returns PASS-inert.
//
// When applicable, meta.geo = { projection, value, classification?,
// disclosure?, alaskaCaveat? }:
//   (a) meta.geo.projection must be one of the allowed equal-area/schematic
//       set — 'geoMercator' and other non-equal-area projections are
//       REJECTED by name.
//   (b) for a real (non-schematic) projection: meta.geo.value must be
//       'rate', never 'count' (the raw-count lie); when 'rate', a
//       classification method name (meta.geo.classification) and a rendered
//       rate+classification disclosure (meta.geo.disclosure, disclosure-
//       fragment substring idiom — see baseline-honesty.check.mjs) are both
//       required.
//   (c) projection:'schematic-none' must instead render a disclosure whose
//       text literally contains "schematic, not geographic".
//   (d) projection:'geoAlbersUsa' additionally requires an Alaska-caveat
//       disclosure (meta.geo.alaskaCaveat, same fragment idiom) naming the
//       inset's non-true-scale rendering.
//
// WHICH DISCLOSURE, and why it is the piece's rather than the sidecar's.
//
// A wizard job's meta is deriveRenderMeta's CLONE of the DEMO piece's sidecar
// (app/routes/render.mjs), so `meta.geo.disclosure` is the sentence the DEMO
// rendered. Demanding it verbatim of a reader's own render is the fault that
// 404'd four techniques through baseline-honesty, and it was latent here for the
// same reason: choropleth's `rateDisclosure` is caller-overridable, and only its
// still-demo-worded default kept this check quiet.
//
// So the SENTENCES now come from the piece's live `window.__viz.geo` where it
// declares them, and the sidecar only when it stays silent. The STRUCTURAL facts
// — projection, value, classification — deliberately stay on the sidecar: they
// are properties of the form, they do not vary with the data, and they are what
// a fast pre-check is for. Only prose varies, so only prose moves.
//
// This is not a loosening. A declared sentence must still be found VERBATIM in
// what was rendered, so a piece cannot claim a disclosure it did not print.
// density-bandwidth.check.mjs carries the identical arrangement.

export const name = 'geo-honesty';
export const needs = ['meta', 'viz', 'html'];

const EQUAL_AREA_OR_SCHEMATIC = new Set([
  'geoIdentity-preprojected-albers',
  'geoAlbersUsa',
  'geoEqualEarth',
  'schematic-none',
]);

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

// A declared sentence has to be a sentence, not a token that appears in any
// page. Mirrors baseline-honesty's own floor.
const MIN_DECLARED = 24;

/**
 * The sentence to verify, and where it came from. Prefers the piece's own
 * declaration; a declared stub is rejected rather than silently trusted, since
 * the whole point is that the piece cannot dodge the check by declaring nothing
 * useful.
 */
function resolveDisclosure(live, fromMeta, field, violations) {
  const declared = live && typeof live[field] === 'string' ? live[field] : null;
  if (declared === null) return { value: fromMeta, source: 'meta.json' };
  if (declared.trim().length < MIN_DECLARED) {
    violations.push(
      `the piece declares geo.${field}:${JSON.stringify(declared)}, which is too short to be a disclosure `
      + `(needs ${MIN_DECLARED}+ characters)`
    );
    return { value: fromMeta, source: 'meta.json' };
  }
  return { value: declared, source: 'the rendered piece' };
}

function checkDisclosureField(value, haystack, violations, missingLabel, driftLabel) {
  if (typeof value !== 'string' || value.length === 0) {
    violations.push(missingLabel);
    return;
  }
  const fragments = disclosureStaticFragments(value);
  const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
  if (missingFragments.length > 0) {
    violations.push(
      `${driftLabel} — missing fragment(s): ${missingFragments.map((f) => JSON.stringify(f)).join(', ')}`
    );
  }
}

export async function run(ctx) {
  const meta = ctx.meta ?? {};
  const geo = meta.geo ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  if (meta.family !== 'geospatial') {
    return {
      name,
      severity: 'PASS',
      evidence: 'not a geospatial-family piece — geo-honesty not applicable',
    };
  }

  const violations = [];
  // The piece's own sentences, where it declares them. Resolved before the
  // branches below so the "schematic, not geographic" literal is tested against
  // what was RENDERED rather than against a clone of another render.
  const live = ctx.viz && ctx.viz.geo ? ctx.viz.geo : null;
  const disc = resolveDisclosure(live, geo.disclosure, 'disclosure', violations);
  const alaska = resolveDisclosure(live, geo.alaskaCaveat, 'alaskaCaveat', violations);

  // (a) equal-area (or schematic) projection required.
  if (!EQUAL_AREA_OR_SCHEMATIC.has(geo.projection)) {
    violations.push(
      `non-equal-area projection — geospatial pieces require an equal-area projection (or schematic-none); got projection:${JSON.stringify(geo.projection)}`
    );
  }

  if (geo.projection === 'schematic-none') {
    // (c) schematic pieces must disclose they are not a true geographic map.
    if (typeof disc.value !== 'string' || !disc.value.includes('schematic, not geographic')) {
      violations.push(
        `schematic geo piece requires a rendered disclosure containing "schematic, not geographic" (got disclosure:${JSON.stringify(disc.value)} from ${disc.source})`
      );
    } else {
      checkDisclosureField(
        disc.value,
        haystack,
        violations,
        'schematic disclosure requires a non-empty geo.disclosure string',
        `schematic disclosure text (from ${disc.source}) not found verbatim in the rendered piece`
      );
    }
  } else {
    // (b) rate-not-raw-count + classification disclosure for real projections.
    if (geo.value !== 'rate') {
      violations.push(
        `geo piece encodes a raw count, not a rate — meta.geo.value must be 'rate' (got value:${JSON.stringify(geo.value)}); rate-not-raw-count + classification disclosure required`
      );
    } else {
      if (typeof geo.classification !== 'string' || geo.classification.length === 0) {
        violations.push(
          'rate-encoded geo piece requires a non-empty meta.geo.classification method name'
        );
      }
      checkDisclosureField(
        disc.value,
        haystack,
        violations,
        'rate-encoded geo piece requires a non-empty geo.disclosure string naming the rate + classification method',
        `rate/classification disclosure text (from ${disc.source}) not found verbatim in the rendered piece`
      );
    }

    // (d) Albers-USA inset-Alaska caveat.
    if (geo.projection === 'geoAlbersUsa') {
      checkDisclosureField(
        alaska.value,
        haystack,
        violations,
        'geoAlbersUsa projection requires a non-empty geo.alaskaCaveat disclosure naming the Alaska inset\'s non-true scale',
        'Alaska-inset caveat text not found verbatim in the rendered piece'
      );
    }
  }

  if (violations.length > 0) {
    return { name, severity: 'VIOLATION', evidence: violations.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `geospatial-family piece declares an equal-area/schematic projection (${geo.projection}) with required rate/classification/schematic/Alaska disclosures rendered verbatim`,
  };
}
