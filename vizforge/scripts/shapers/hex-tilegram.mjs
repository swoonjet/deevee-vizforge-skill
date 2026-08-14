// scripts/shapers/hex-tilegram.mjs
//
// GEO-01 (Phase 20 Plan 01) -- the hex tile-grid cartogram's shaper. Mirrors
// scripts/shapers/bar.mjs's contract: shape(rows, bindings) is PURE
// (identical rows+bindings in, identical output out); validate(rows,
// bindings, {contract, profile}) runs after the generic validateBinding()
// already passed and only adds the technique-specific rule the generic
// validator can't express: every bound region must resolve to an entry in
// this file's embedded US-state hex layout table.
//
// HEX LAYOUT PROVENANCE -- read before editing HEX_LAYOUT:
// This table is a HAND-AUTHORED schematic grid built for this project (not a
// copy of any specific third-party "hex tilegram" dataset -- no upstream
// source was fetched or transcribed). It groups all 50 states + DC by the
// US Census Bureau's 9 statistical divisions (a real, citable, public
// geographic scheme: New England, Middle Atlantic, East/West North Central,
// South Atlantic, East/West South Central, Mountain, Pacific -- see
// https://www.census.gov/programs-surveys/economic-census/guidance/geographies.html),
// laid out west-to-east by column and roughly north-to-south by row within
// each division/column, with Alaska and Hawaii as inset corner hexes (the
// standard tile-grid-map convention for those two non-contiguous states).
// It is intentionally schematic -- rough relative compass position only,
// NOT true adjacency or true bearing -- which is exactly why this technique
// discloses "schematic, not geographic" rather than presenting as a map.
//
// GEOMETRY -- flat-top hexagons, "odd-q" column-offset layout (odd columns
// shifted down by half a hex height), the standard offset-coordinate scheme
// for this hex orientation (see Red Blob Games, "Hexagonal Grids",
// https://www.redblobgames.com/grids/hexagons/ -- offset coordinates,
// flat-top, odd-q). The scaffold (not this file) converts [row,col] to
// pixel centers; this file only supplies the offset coordinates themselves.

const STATE_NAME_TO_USPS = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC',
};

// [row, col] per USPS code -- see provenance comment above. 51 entries.
export const HEX_LAYOUT = {
  // Pacific + AK/HI insets (col 0-1)
  AK: [0, 0],
  WA: [1, 1],
  OR: [2, 1],
  CA: [3, 1],
  HI: [7, 0],
  // Mountain division (col 2-3)
  MT: [0, 2],
  ID: [1, 2],
  NV: [3, 2],
  AZ: [5, 2],
  WY: [1, 3],
  UT: [2, 3],
  CO: [3, 3],
  NM: [5, 3],
  // West North Central (col 4) / West South Central west half (col 4-5)
  ND: [0, 4],
  SD: [1, 4],
  NE: [2, 4],
  KS: [3, 4],
  OK: [4, 4],
  MN: [0, 5],
  IA: [1, 5],
  MO: [2, 5],
  TX: [5, 5],
  // West South Central east half (col 6)
  AR: [3, 6],
  LA: [4, 6],
  // East North Central (col 7-8)
  WI: [0, 7],
  IL: [1, 7],
  MI: [0, 8],
  IN: [1, 8],
  OH: [2, 8],
  // East South Central (col 9)
  KY: [2, 9],
  TN: [3, 9],
  MS: [4, 9],
  AL: [5, 9],
  // South Atlantic (col 10-11)
  WV: [2, 10],
  VA: [3, 10],
  NC: [4, 10],
  SC: [5, 10],
  GA: [6, 10],
  FL: [7, 10],
  DC: [1, 11],
  MD: [2, 11],
  DE: [3, 11],
  // Middle Atlantic (col 12)
  NY: [0, 12],
  PA: [1, 12],
  NJ: [2, 12],
  // New England (col 13-14)
  VT: [0, 13],
  MA: [1, 13],
  CT: [2, 13],
  RI: [3, 13],
  ME: [0, 14],
  NH: [1, 14],
};

function isCoercibleNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function resolveUsps(rawRegion) {
  if (rawRegion === undefined || rawRegion === null) return null;
  const name = String(rawRegion).trim();
  if (!name) return null;
  if (HEX_LAYOUT[name.toUpperCase()] && name.length <= 3) return name.toUpperCase();
  return STATE_NAME_TO_USPS[name] || null;
}

/**
 * shape(rows, bindings) -> {data:[{label,name,value,row,col}],
 * stats:{min,max,count,missing}}
 *
 * `bindings.region` selects the full-state-name column (joined via
 * STATE_NAME_TO_USPS); `bindings.value` selects the rate column. Rows whose
 * region does not resolve to a HEX_LAYOUT entry are collected into
 * stats.missing (name only) and excluded from `data` -- validate() is what
 * REJECTS a binding with any missing entries; shape() itself stays
 * permissive/pure so a caller can still inspect what was dropped.
 */
export function shape(rows, bindings) {
  const regionCol = bindings.region;
  const valueCol = bindings.value;

  const missing = [];
  const data = [];

  for (const row of rows || []) {
    if (!row) continue;
    const rawRegion = row[regionCol];
    const usps = resolveUsps(rawRegion);
    const num = Number(row[valueCol]);
    if (!Number.isFinite(num)) continue;
    if (!usps || !HEX_LAYOUT[usps]) {
      missing.push(String(rawRegion));
      continue;
    }
    const [r, c] = HEX_LAYOUT[usps];
    data.push({ label: usps, name: String(rawRegion).trim(), value: num, row: r, col: c });
  }

  data.sort((a, b) => (a.row - b.row) || (a.col - b.col));

  const values = data.map((d) => d.value);
  const stats = {
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    count: data.length,
    missing,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - any bound region that fails to resolve to a HEX_LAYOUT entry: rejected
 *   (an unmapped state would either be silently dropped or mis-plotted).
 * - any bound value that is not a coercible number: rejected.
 * - returns [] when clean.
 */
export function validate(rows, bindings) {
  const regionCol = bindings.region;
  const valueCol = bindings.value;
  const problems = [];

  const unresolved = new Set();
  const nonNumeric = new Set();

  for (const row of rows || []) {
    if (!row) continue;
    const rawRegion = row[regionCol];
    const usps = resolveUsps(rawRegion);
    if (!usps || !HEX_LAYOUT[usps]) {
      unresolved.add(String(rawRegion));
    }
    if (!isCoercibleNumber(row[valueCol])) {
      nonNumeric.add(String(rawRegion));
    }
  }

  if (unresolved.size > 0) {
    problems.push({
      channel: 'region',
      problem: `channel 'region': ${unresolved.size} value(s) do not resolve to a US-state hex-layout entry: ${[...unresolved].slice(0, 5).join(', ')}${unresolved.size > 5 ? ', ...' : ''}`,
      remedy: `bind 'region' to a column of full US state names (or USPS codes) matching the embedded HEX_LAYOUT table`,
    });
  }

  if (nonNumeric.size > 0) {
    problems.push({
      channel: 'value',
      problem: `channel 'value': ${nonNumeric.size} row(s) have a non-coercible-number value`,
      remedy: `bind 'value' to a column of numeric rates`,
    });
  }

  return problems;
}
