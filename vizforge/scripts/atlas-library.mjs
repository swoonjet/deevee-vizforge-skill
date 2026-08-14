// scripts/atlas-library.mjs
//
// THE OTHER LIBRARY — the 40-technique atlas behind the gallery, made reachable
// from the Studio.
//
// WHY A BRIDGE AND NOT 36 MORE MODULES. The Studio's own library is four
// PORTABLE MODULES: client-rendered, responsive, interactive, embeddable. The
// atlas is something else — 40 techniques as fixed 1200x750 editorial scaffolds
// with a Playwright capture, a QA gate, per-technique shapers, honesty rules and
// four milestones of work behind them. Reimplementing those as modules would
// mean rewriting the whole binding engine and losing the gate. So this reuses it
// end to end:
//
//   recommend()          ranking + the honesty statement, per technique
//   dataBinding.roles    the same role/types/required/label contract the
//                        Studio's binder already renders
//   validateBinding()    the same {channel, problem, remedy} errors the
//                        modules' own validate() returns
//   bindData()           the 40 per-technique shapers
//   assembleJobHtml()    the wizard's own assembly path, bytes for bytes
//
// WHAT THE READER GETS IS HONESTLY DIFFERENT, and the screen says so: an atlas
// piece is a STILL. No hover readout, no legend toggling, no responsive reflow —
// it is a composed editorial frame, exported as an image or as a standalone HTML
// page. A module is the thing you embed in a live dashboard. Two libraries, two
// promises, one ingest.
//
// NOTHING HERE INVENTS PROSE. Every verdict is the recommender's own honesty
// statement, an ineligibility reason from its own rules, or a binding error from
// validateBinding. Titles come from each technique's atlas document. The one
// thing this file authors is the sentence for a technique whose data SHAPE the
// Studio cannot supply at all (a hierarchy, an edge list), because the manifest
// records that as an empty role list and says nothing about it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recommend } from './recommend.mjs';
import { validateBinding, bindData } from './bind-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Data shapes the Studio's ingest can actually feed. A flat table of rows can
 * carry an edge list (source, target, value), a series and a grid of
 * coordinates — but it cannot carry a hierarchy or a graph, and the manifest
 * records that by leaving those techniques' role lists EMPTY.
 */
const BINDABLE_SHAPES = new Set(['table', 'edges', 'series', 'grid']);

const SHAPE_NEEDS = {
  tree: 'a hierarchy — parent/child rows, or nested JSON. A flat table has no nesting to read.',
  graph: 'a graph — a node list plus an edge list. A flat table of columns cannot express one.',
};

let cached = null;

/** Loads the manifest and each technique's human title, once per process. */
export async function loadAtlas() {
  if (cached) return cached;

  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'skill/manifest.json'), 'utf8'));

  const titles = await Promise.all((manifest.techniques || []).map(async (t) => {
    // The atlas document's own H1 is the technique's real name. Trimmed at the
    // first qualifier so a card reads "Nightingale rose" rather than
    // "Nightingale Rose / Polar-Area (Coxcomb) — Cyclical Data Only (Tier 2)".
    try {
      const doc = await readFile(path.join(repoRoot, t.referencePath), 'utf8');
      const heading = (doc.match(/^#\s+(.+)$/m) || [])[1] || '';
      // Cut only at a genuine qualifier — an em-dash aside or a parenthetical
      // tier note. A slash is part of the name ("Botanical / Organism Glyph"),
      // and cutting there produced titles like "Botanical".
      const short = heading.split(/\s+—\s+|\s+\(/)[0].trim();
      return [t.slug, short || fromSlug(t.slug)];
    } catch {
      return [t.slug, fromSlug(t.slug)];
    }
  }));

  cached = { manifest, titles: new Map(titles) };
  return cached;
}

function fromSlug(slug) {
  const words = String(slug).replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "radius-vs-area" -> "radius vs area", for showing the manifest's own tags. */
function deslug(tag) {
  return String(tag).replace(/-/g, ' ');
}

/**
 * PROPOSED BINDINGS for a scaffold's dataBinding contract — the starting point
 * the reader then edits, same as a module's.
 *
 * Assigns each role the first unused column of an accepted type, in role order.
 * A multiColumn role takes every remaining acceptable column. Reports the
 * required roles it could not fill instead of binding something of the wrong
 * type to make a chart appear.
 */
export function proposeBindings(contract, profile) {
  const roles = (contract && contract.roles) || [];
  const fields = profile.fields || [];
  const used = new Set();
  const bindings = {};
  const missing = [];

  for (const role of roles) {
    const candidates = fields.filter((f) => role.types.includes(f.type) && !used.has(f.name));
    if (role.multiColumn) {
      if (candidates.length) {
        bindings[role.role] = candidates.map((f) => f.name);
        for (const f of candidates) used.add(f.name);
      } else if (role.required) {
        missing.push(role.role);
      }
      continue;
    }
    if (candidates.length) {
      bindings[role.role] = candidates[0].name;
      used.add(candidates[0].name);
    } else if (role.required) {
      missing.push(role.role);
    }
  }

  return { bindings, missing };
}

/** The role contract in the shape the Studio's binder already renders. */
function normalizeRoles(contract) {
  const out = {};
  for (const role of (contract && contract.roles) || []) {
    out[role.role] = {
      label: role.label || fromSlug(role.role),
      types: role.types || [],
      required: Boolean(role.required),
      multiple: Boolean(role.multiColumn),
    };
  }
  return out;
}

/**
 * Unbinds any OPTIONAL channel whose column is past the form's limit, and
 * returns what it dropped.
 *
 * Without this, one over-wide optional channel took the whole technique down:
 * scatter declares maxCategories 6, a wide table proposed hue = model with 18
 * distinct values, and a form that draws x/y perfectly well was refused for a
 * channel it does not need.
 */
function dropOverLimitOptionals(technique, contract, bindings, profile) {
  const limit = (technique.seriesLimits || {}).maxCategories;
  if (!limit) return [];
  const byName = new Map((profile.fields || []).map((f) => [f.name, f]));
  const dropped = [];

  for (const role of (contract && contract.roles) || []) {
    if (role.required) continue;
    const categorical = role.types.includes('nominal') || role.types.includes('ordinal');
    if (!categorical) continue;
    for (const name of [].concat(bindings[role.role] || [])) {
      const field = byName.get(name);
      const distinct = field && (field.cardinality ?? field.distinct);
      if (distinct && distinct > limit) {
        delete bindings[role.role];
        dropped.push(`${role.label || role.role} left empty: "${name}" has ${distinct} values and this form holds ${limit}`);
        break;
      }
    }
  }
  return dropped;
}

/**
 * The form's own declared limit, checked against the column the proposal BINDS.
 *
 * seriesLimits.maxCategories / maxPoints are the manifest's numbers, and the
 * refusal quotes both sides so the reader can see how far past the limit their
 * data is rather than being told "no".
 */
function exceedsSeriesLimit(technique, contract, bindings, profile) {
  const limits = technique.seriesLimits || {};
  const byName = new Map((profile.fields || []).map((f) => [f.name, f]));
  const roles = (contract && contract.roles) || [];

  if (limits.maxCategories) {
    for (const role of roles) {
      const categorical = role.types.includes('nominal') || role.types.includes('ordinal');
      if (!categorical) continue;
      for (const name of [].concat(bindings[role.role] || [])) {
        const field = byName.get(name);
        const distinct = field && (field.cardinality ?? field.distinct);
        if (distinct && distinct > limits.maxCategories) {
          return `"${name}" has ${distinct} distinct values and this form holds ${limits.maxCategories}`;
        }
      }
    }
  }

  if (limits.maxPoints && (profile.rows || []).length > limits.maxPoints) {
    return `${(profile.rows || []).length} rows is past this form's limit of ${limits.maxPoints} points`;
  }

  return null;
}

/**
 * atlasFor(profiled) -> [entry]
 *
 * `profiled` is a scripts/profile.mjs result (fields + rows + shape) — the FULL
 * profile, not the filter's condensed summary, because recommend() reads
 * profile.shape and validateBinding reads profile.rows.
 *
 * Every technique in the atlas comes back with a verdict and a proposal, ordered
 * by the recommender's own ranking, so the ones that suit the data lead and the
 * rest stay reachable with the reason they were not chosen.
 */
export async function atlasFor(profiled) {
  const { manifest, titles } = await loadAtlas();

  const ranked = recommend({ ...profiled, intent: [], strictBinding: true }, manifest);
  const order = new Map((ranked.recommendations || []).map((r, i) => [r.slug, i]));
  const honestyBySlug = new Map((ranked.recommendations || []).map((r) => [r.slug, r.honesty]));
  const ineligible = new Map((ranked.ineligible || []).map((r) => [r.slug, r]));

  // Shaper probes run concurrently, then their verdicts are applied — a
  // technique is only OFFERED if its own shaper accepted the proposal.
  const shaperChecks = [];

  const entries = (manifest.techniques || []).map((t) => {
    const contract = t.dataBinding || {};
    const roles = normalizeRoles(contract);
    const base = {
      slug: t.slug,
      title: titles.get(t.slug) || fromSlug(t.slug),
      kind: 'atlas',
      tier: t.tier,
      family: t.family,
      register: t.register,
      // The manifest's own tags, de-slugged. Not prose anyone wrote here.
      answers: (t.intents || []).slice(0, 3).map(deslug).join(', '),
      honesty: (t.honestyRisks || []).map(deslug).join(' · '),
      // A precondition is a claim about the DATA'S MEANING that no profiler can
      // check — "genuinely cyclical data only". Surfaced for the reader to
      // confirm rather than quietly assumed.
      preconditions: (t.preconditions || []).map(deslug),
      roles,
      animated: Boolean(t.animatable),
    };

    // 0. A technique pinned to its own demo dataset. This is `unavailable`
    // rather than `refused` on purpose: refused says "your data doesn't suit
    // this form" and invites you to bring different columns, which would be a
    // lie here — no table you could upload makes this piece bind. recommend()
    // rules it out too (isEligible), so this branch is not what enforces it;
    // it is here so the card states the true reason instead of inheriting
    // whichever data-shaped refusal happened to fire first.
    if (t.demoOnly) {
      return {
        ...base,
        status: 'unavailable',
        why: t.demoOnly.reason,
        bindings: {},
        missing: [],
      };
    }

    // 1. A shape the Studio's ingest cannot express at all.
    const shape = contract.shape;
    if (!BINDABLE_SHAPES.has(shape) || !Object.keys(roles).length) {
      return {
        ...base,
        status: 'unavailable',
        why: `needs ${SHAPE_NEEDS[shape] || `a ${shape || 'different'} data shape, which a flat table cannot express`}`,
        bindings: {},
        missing: [],
      };
    }

    const { bindings, missing } = proposeBindings(contract, profiled);

    // An OPTIONAL channel that blows the form's limit is not grounds for
    // refusing the form — it is grounds for leaving that channel empty. Scatter
    // holds 6 hues and this table has 18 models: the honest answer is a scatter
    // without a hue channel, not "no scatter for you". The dropped channel is
    // reported so an empty legend is never a mystery.
    const dropped = dropOverLimitOptionals(t, contract, bindings, profiled);

    // 2. The recommender's own ineligibility ruling, where it made one.
    const ruled = ineligible.get(t.slug);
    if (ruled) {
      return {
        ...base,
        status: 'refused',
        // reason is prose and already carries the numbers; detail is a
        // structured object ({limit, have}) and stringifies to [object Object].
        why: [ruled.reason, typeof ruled.detail === 'string' ? ruled.detail : null]
          .filter(Boolean).join(' — '),
        bindings,
        missing,
      };
    }

    // 3. Does the BOUND column blow the form's own limit? recommend() checks
    // profile.shape.categoryCardinality, which is a guess at "the" category
    // column for the dataset as a whole — not the column this proposal actually
    // binds. On a wide table it passed typographic-bar with 18 models bound to a
    // form limited to 12, and the render came out as overlapping numerals.
    const limitError = exceedsSeriesLimit(t, contract, bindings, profiled);
    if (limitError) {
      return { ...base, status: 'refused', why: limitError, bindings, missing, dropped };
    }

    // 4. Can the proposal actually be bound? validateBinding checks the
    // contract; the SHAPER checks the data. Only the shaper knows that
    // choropleth needs region names it can resolve to US states, that a slope
    // needs exactly two x values, or that flow-field needs a real coordinate
    // grid — and a technique offered here that then failed to draw would be the
    // same fault as a module previewing blank.
    const errors = validateBinding(bindings, contract, profiled);
    if (missing.length || errors.length) {
      const first = errors[0];
      return {
        ...base,
        status: 'refused',
        why: missing.length
          ? `no column of the right type for ${missing.map((r) => roles[r].label).join(' and ')}`
          : `${first.problem} — ${first.remedy}`,
        bindings,
        missing,
        dropped,
      };
    }

    shaperChecks.push((async () => {
      try {
        const result = await bindData(t.slug, profiled.rows || [], bindings, { contract, profile: profiled });
        if (!result.ok) {
          const first = (result.errors || [])[0] || {};
          return { slug: t.slug, why: [first.problem, first.remedy].filter(Boolean).join(' — ') || 'the shaper refused this binding' };
        }
      } catch (err) {
        return { slug: t.slug, why: `the shaper could not read that binding (${err.message})` };
      }
      return null;
    })());

    // 5. Offered. The recommender's honesty statement is the reason it fits;
    // a technique that binds but that the recommender did not rank is offered
    // as possible, because bindable is not the same as suited.
    const rank = order.get(t.slug);
    return {
      ...base,
      status: rank === undefined ? 'possible' : rank < 6 ? 'strong' : 'possible',
      // The recommender's statement ends with its own slug-form "(watch: ...)"
      // list, and the card already shows those risks de-slugged and readable.
      // Printing both put the same sentence on screen twice, once unreadably.
      why: stripWatchList(honestyBySlug.get(t.slug))
        || `binds cleanly to your columns, though your data's shape is not what this form is for`,
      bindings,
      missing: [],
      rank,
    };
  });

  const shaperFailures = new Map(
    (await Promise.all(shaperChecks)).filter(Boolean).map((f) => [f.slug, f.why])
  );
  for (const entry of entries) {
    const why = shaperFailures.get(entry.slug);
    if (why && (entry.status === 'strong' || entry.status === 'possible')) {
      entry.status = 'refused';
      entry.why = why;
      entry.rank = undefined;
    }
  }

  // Recommended order first, then family then slug, so the list is stable
  // between identical uploads.
  const RANK_LAST = Number.MAX_SAFE_INTEGER;
  entries.sort((a, b) => {
    const ra = a.rank === undefined ? RANK_LAST : a.rank;
    const rb = b.rank === undefined ? RANK_LAST : b.rank;
    if (ra !== rb) return ra - rb;
    const statusOrder = { strong: 0, possible: 1, refused: 2, unavailable: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    if (a.family !== b.family) return a.family < b.family ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });

  return entries;
}

/**
 * Drops the recommender's trailing slug-form watch list from its honesty
 * statement. The same risks are shown de-slugged on the card, from the
 * manifest's own honestyRisks, so keeping both printed one sentence twice — the
 * second time in hyphenated slug form.
 */
function stripWatchList(statement) {
  if (!statement) return statement;
  return String(statement).replace(/\s*\(watch:[^)]*\)\s*$/, '').trim();
}

/**
 * COPY THAT CANNOT BORROW THE DEMO'S CLAIMS.
 *
 * Every scaffold renders `copy.X || <its own default>`, and 28 of the 49 have
 * NOT been retrofitted to the subject pattern — their dek fallback interleaves
 * demo nouns with computed stats. Bind a reader's rows to typographic-bar
 * without a dek and the page reads "Values in terawatt-hours across 18 world
 * electricity sources; \"Pinnacle\" produced the least at 22 TWh": the numbers
 * are the reader's, the nouns are Our World in Data's. That is false
 * attribution, the exact fault BOUND_COPY was built to end, and it survives in
 * the fallbacks.
 *
 * Note the trap: the fallback is `||`, so an EMPTY string does not suppress it.
 * Blanking the dek renders the demo's. The only way through is to always supply
 * a real sentence, so this composes one from the reader's own file — row count,
 * filename, subject if they gave one, and the columns actually bound, including
 * any aggregation the shaper will apply.
 *
 * `headline` and `note` are deliberately left to the scaffold: a headline
 * default is computed from the BOUND stats (the reader's own numbers) and the
 * note is the technique's honesty disclosure, which must not be overwritten.
 */
export function atlasCopy({ contract, bindings, source, rowCount, userCopy = {} }) {
  const roles = (contract && contract.roles) || [];
  const parts = [];

  for (const role of roles) {
    const bound = bindings[role.role];
    if (!bound || (Array.isArray(bound) && !bound.length)) continue;
    const columns = [].concat(bound).join(', ');
    // An aggregation the shaper will apply is part of what the piece MEANS, so
    // it is named rather than left for the reader to discover.
    const chosen = (userCopy.aggregation || {})[role.role];
    const aggregation = role.aggregation ? chosen || role.defaultAggregation : null;
    parts.push(`${String(role.label || role.role).toLowerCase()} = ${aggregation ? `${aggregation} of ` : ''}${columns}`);
  }

  const subject = (userCopy.subject || '').trim();
  const where = source || 'your data';
  const dek = userCopy.dek
    || `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} from ${where}${subject ? `, ${subject}` : ''}.`;
  const methodology = userCopy.methodology
    || (parts.length ? `Columns bound: ${parts.join('; ')}.` : `Bound from ${where}.`);

  return {
    headline: userCopy.headline || null,
    dek,
    source: userCopy.source || 'User-provided data',
    methodology,
    note: userCopy.note || null,
    subject: subject || null,
  };
}

/** The contract for one technique, for the routes that bind and render it. */
export async function techniqueContract(slug) {
  const { manifest } = await loadAtlas();
  const entry = (manifest.techniques || []).find((t) => t.slug === slug);
  return entry ? entry.dataBinding || {} : null;
}
