// scripts/shapers/choropleth.mjs
//
// GEO-02 (Phase 20 Plan 02) -- the choropleth technique's shaper. Joins a
// region+value table (one row per US state, `region` = state name, `value`
// = a RATE) to a deterministic classification (quantile bins) the scaffold
// renders as a binned, colorblind-safe fill scale -- never a raw
// continuous/rainbow ramp, which would fabricate more precision than a
// reader can actually perceive (Phase 19 geo-honesty contract).
//
// Contract (scripts/shapers/README.md, mirrors bar.mjs): shape(rows,
// bindings) is pure -- identical rows+bindings in, identical output out.
// validate(rows, bindings, {contract, profile}) runs AFTER the generic
// validateBinding() in scripts/bind-data.mjs already passed (required-ness,
// bound-column existence, declared type) -- this file only adds the
// technique-specific rules the generic validator can't express: every bound
// region value must join the geometry's known state-name set (or the
// choropleth silently drops states, which is a worse lie than an upfront
// rejection), and a bound value must never look like a raw count
// masquerading as a rate.
//
// Kept dependency-free (no d3 import) per the shaper contract -- this file
// is never inlined into a scaffold, but it stays a plain Node ES module so
// scripts/bind-data.mjs can import it directly in tests/regeneration.

// The exact 51 `properties.name` values in data/states-albers-10m.json's
// `objects.states` GeometryCollection (50 states + the District of
// Columbia) -- duplicated here in miniature (rather than importing the
// geometry file at shape-time) so this shaper stays a fully self-contained,
// dependency-free pure function per the shaper contract, mirroring bar.mjs's
// own private ORDINAL_SETS precedent.
export const KNOWN_STATE_NAMES = new Set([
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas',
  'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin',
  'Wyoming',
]);

const BIN_COUNT = 5;

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

// Linear-interpolation quantile over an ALREADY-SORTED ascending array --
// the same algorithm d3.quantile uses, hand-rolled here so the shaper stays
// dependency-free. p in [0,1].
function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const h = idx - lo;
  return sorted[lo] * (1 - h) + sorted[hi] * h;
}

/**
 * shape(rows, bindings) -> {data:[{name,value}], stats:{min,max,bins,
 * classification,rowCount}}
 *
 * `bindings.region` names the column holding the state name; `bindings.value`
 * names the column holding the RATE. `data` is sorted by name (never by
 * value) for determinism -- the render order must not encode any implicit
 * ranking a choropleth doesn't actually make.
 *
 * `stats.bins` is the array of BIN_COUNT-1 quantile thresholds (a
 * `d3.scaleThreshold`-ready domain); `stats.classification` names the
 * method ('quantile-5') the scaffold's legend and the meta.geo.classification
 * disclosure both cite verbatim.
 */
export function shape(rows, bindings) {
  const regionCol = bindings.region;
  const valueCol = bindings.value;

  const data = [];
  for (const row of rows) {
    if (!row) continue;
    const rawName = row[regionCol];
    if (rawName === undefined || rawName === null || String(rawName).trim() === '') continue;
    const name = String(rawName).trim();
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    data.push({ name, value: num });
  }

  data.sort((a, b) => a.name.localeCompare(b.name));

  const sortedValues = data.map((d) => d.value).sort((a, b) => a - b);
  const min = sortedValues.length > 0 ? sortedValues[0] : null;
  const max = sortedValues.length > 0 ? sortedValues[sortedValues.length - 1] : null;

  const thresholdPs = [];
  for (let i = 1; i < BIN_COUNT; i += 1) thresholdPs.push(i / BIN_COUNT);
  const bins = sortedValues.length > 0 ? thresholdPs.map((p) => quantile(sortedValues, p)) : [];

  const byValueDesc = [...data].sort((a, b) => b.value - a.value);
  const top = byValueDesc[0];
  const bottom = byValueDesc[byValueDesc.length - 1];

  const stats = {
    min,
    max,
    bins,
    classification: `quantile-${BIN_COUNT}`,
    rowCount: rows.length,
    topName: top ? top.name : null,
    topValue: top ? top.value : null,
    bottomName: bottom ? bottom.name : null,
    bottomValue: bottom ? bottom.value : null,
    ratio: top && bottom && bottom.value !== 0 ? top.value / bottom.value : null,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - any bound region value that will not join `KNOWN_STATE_NAMES` (typo,
 *   territory, or a non-US-state dataset bound by mistake) is rejected by
 *   name -- a silent drop would understate the map without any disclosure.
 * - any bound value that is negative is rejected -- a population-density-
 *   style rate is never negative; a negative value signals the column
 *   actually holds a raw signed count/delta bound to the wrong role.
 * - fewer than 2 distinct joined rows: rejected (a choropleth needs at
 *   least 2 regions to compare).
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const regionCol = bindings.region;
  const valueCol = bindings.value;
  const problems = [];

  const unknownNames = new Set();
  const negativeCount = { n: 0 };
  let joined = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const rawName = row[regionCol];
    if (rawName === undefined || rawName === null || String(rawName).trim() === '') continue;
    const name = String(rawName).trim();

    if (!KNOWN_STATE_NAMES.has(name)) {
      unknownNames.add(name);
      continue;
    }

    const rawValue = row[valueCol];
    if (!isCoercibleNumber(rawValue)) continue;
    const num = Number(rawValue);
    if (num < 0) negativeCount.n += 1;
    joined += 1;
  }

  if (unknownNames.size > 0) {
    problems.push({
      channel: 'region',
      problem: `channel 'region': ${unknownNames.size} value(s) in '${regionCol}' do not match a known US state/DC name (e.g. ${
        [...unknownNames].slice(0, 3).join(', ')
      }) and would silently drop from the map`,
      remedy: `bind 'region' to a column of full US state names (or DC) matching data/states-albers-10m.json's properties.name set`,
    });
  }

  if (negativeCount.n > 0) {
    problems.push({
      channel: 'value',
      problem: `channel 'value': ${negativeCount.n} negative value(s) found in '${valueCol}' -- a rate (e.g. population density) is never negative; this looks like a raw signed count/delta bound to the wrong role`,
      remedy: `bind 'value' to a non-negative rate column (per-capita, per-sq-mi, percentage, etc.)`,
    });
  }

  if (joined < 2) {
    problems.push({
      channel: 'region',
      problem: `channel 'region': only ${joined} row(s) joined a known state name -- a choropleth needs at least 2 regions to compare`,
      remedy: `bind 'region' to a column with at least 2 distinct US state names`,
    });
  }

  return problems;
}
