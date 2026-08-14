// scripts/qa/checks/baseline-honesty.check.mjs
//
// Baseline-honesty cross-check (docs/honesty-rules.md, 02-RESEARCH.md
// Pitfall 1). Three named assertions, all blocking per the locked two-tier
// severity model (undisclosed non-zero baseline is a VIOLATION, not a
// CAUTION):
//
//   (a) meta.json's encoding (minus `disclosure`) deep-equals the piece's
//       LIVE window.__viz.encoding — meta.json is a fast pre-check, never an
//       unverified duplicate. Mismatch prints BOTH declared values.
//   (b) channel "length" requires baselineZero:true OR baselineDisclosed:true
//       — length encodings may never truncate silently (docs/honesty-rules.md).
//   (c) baselineDisclosed:true requires a non-empty disclosure string that
//       appears verbatim in the piece's rendered text. Real pieces build the
//       sentence via string concatenation around a runtime-computed number
//       (`'Y-axis starts at ' + Math.round(x) + ' ppm, not zero...'`), so the
//       fully-resolved sentence never sits adjacent in the HTML source — split
//       on digit runs and check each non-digit fragment as a literal substring
//       instead (same technique scripts/tests/smoke/meta-schema-fields.test.mjs
//       already uses).
//
//       WHICH disclosure: the LIVE `window.__viz.encoding.disclosure` when the
//       piece declares one, and only otherwise the sidecar's.
//
//       This used to read the sidecar unconditionally, and that was a real
//       product bug, not a style point. A wizard job's meta is
//       deriveRenderMeta's CLONE of the demo piece's sidecar
//       (app/routes/render.mjs), so the sentence being demanded belonged to a
//       DIFFERENT RENDER — the demo's. Any piece whose disclosure is
//       caller-overridable (`copy.note || <neutral default>`) therefore failed
//       the gate the moment a reader bound their own data and typed no note:
//       the page honestly disclosed "Y-axis does not start at zero (position
//       encoding, disclosed)" while the gate hunted for the GISTEMP demo's
//       "centered on the 1951-1980 baseline period". A FAIL here 404s the
//       artifact, so `line`, `hand-drawn-line`, `ridgeline` and
//       `editorial-poster` rendered nothing at all on that path.
//
//       Reading the piece's own declaration is not a loosening. The declared
//       sentence must still be FOUND, verbatim, in what was rendered — a piece
//       cannot claim a disclosure it did not print. What changes is only that
//       the claim being verified is the one this render actually made. The
//       sidecar remains the authority when the piece stays silent, so no
//       existing piece gains a free pass, and a piece that declares a stub to
//       dodge the check is rejected by the substance floor below.

// A declared disclosure has to be a sentence, not a token that trivially
// appears in any page. Short enough to admit every real disclosure in the
// atlas (the shortest is 54 characters), long enough that "." or "the" cannot
// satisfy the check. Only applied to the piece's own declaration — the sidecar
// path is unchanged, and sidecars are authored and reviewed at demo time.
const MIN_DECLARED_DISCLOSURE = 24;

export const name = 'baseline-honesty';
export const needs = ['meta', 'viz', 'html'];

const ENCODING_KEYS = ['channel', 'baselineZero', 'baselineDisclosed'];

function disclosureStaticFragments(disclosure) {
  return disclosure.split(/\d+/).filter((fragment) => fragment.length > 0);
}

export async function run(ctx) {
  const metaEnc = ctx.meta?.encoding ?? {};
  const vizEnc = ctx.viz?.encoding ?? {};
  const haystack = ctx.bodyText ?? ctx.html ?? '';

  const violations = [];

  // (a) meta vs. live-runtime encoding drift.
  const driftMsgs = [];
  for (const key of ENCODING_KEYS) {
    if (metaEnc[key] !== vizEnc[key]) {
      driftMsgs.push(
        `meta.json declares ${key}:${JSON.stringify(metaEnc[key])} but rendered piece reports ${key}:${JSON.stringify(vizEnc[key])}`
      );
    }
  }
  if (driftMsgs.length > 0) {
    violations.push(`encoding declaration drift — ${driftMsgs.join('; ')}`);
  }

  // (b) length encoding must never have a silent, undisclosed truncated baseline.
  if (metaEnc.channel === 'length') {
    if (metaEnc.baselineZero !== true && metaEnc.baselineDisclosed !== true) {
      violations.push(
        `channel "length" requires baselineZero:true OR baselineDisclosed:true (got baselineZero:${JSON.stringify(metaEnc.baselineZero)}, baselineDisclosed:${JSON.stringify(metaEnc.baselineDisclosed)})`
      );
    }
  }

  // (c) disclosed baseline must have a real, rendered disclosure string.
  const declared = typeof vizEnc.disclosure === 'string' ? vizEnc.disclosure : null;
  const disclosureSource = declared === null ? 'meta.json' : 'the rendered piece';
  const disclosure = declared === null ? metaEnc.disclosure : declared;

  if (metaEnc.baselineDisclosed === true) {
    if (typeof disclosure !== 'string' || disclosure.length === 0) {
      violations.push('baselineDisclosed:true requires a non-empty encoding.disclosure string in meta.json');
    } else if (declared !== null && declared.trim().length < MIN_DECLARED_DISCLOSURE) {
      // A piece that declares its own disclosure has to say something. Without
      // this floor, `disclosure: '.'` would pass (c) trivially while the page
      // disclosed nothing.
      violations.push(
        `the piece declares encoding.disclosure:${JSON.stringify(declared)}, which is too short to be a disclosure `
        + `(needs ${MIN_DECLARED_DISCLOSURE}+ characters)`
      );
    } else {
      const fragments = disclosureStaticFragments(disclosure);
      const missingFragments = fragments.filter((fragment) => !haystack.includes(fragment));
      if (missingFragments.length > 0) {
        violations.push(
          `disclosure text (from ${disclosureSource}) not found verbatim in the rendered piece — missing fragment(s): ${missingFragments
            .map((f) => JSON.stringify(f))
            .join(', ')}`
        );
      }
    }
  } else if (declared !== null) {
    // The inverse bookkeeping error: a piece states a baseline disclosure while
    // its own encoding says nothing is disclosed. One of the two is wrong, and
    // silently trusting either is how a disclosure stops being checked.
    violations.push(
      'the piece declares encoding.disclosure but baselineDisclosed is not true — a disclosure nothing marks as disclosed is not verified by anything'
    );
  }

  if (violations.length > 0) {
    return { name, severity: 'VIOLATION', evidence: violations.join(' | ') };
  }

  return {
    name,
    severity: 'PASS',
    evidence: `meta.encoding mirrors runtime (channel=${metaEnc.channel}, baselineZero=${metaEnc.baselineZero}, baselineDisclosed=${metaEnc.baselineDisclosed})${
      metaEnc.baselineDisclosed
        ? `; disclosure fragments found verbatim in rendered piece (declared by ${disclosureSource})`
        : ''
    }`,
  };
}
