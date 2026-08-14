// scripts/shapers/flow-field.mjs
//
// BIND-01/02/04/05 (Phase 7 Plan 13) -- flow-field is the atlas' hardest,
// most honestly data-availability-gated technique: it requires a genuine
// spatial GRID (a regular lat/lon lattice), not just "any dataset". Most
// arbitrary user CSVs will never have this shape -- `validate()` below is
// the real gate: a dataset that isn't a spatial grid fails with a clear
// structured error ("your lat/lon values do not form a regular lattice"),
// never a best-effort render (07-RESEARCH.md, ARCHITECTURE.md §2.6).
//
// The role-GROUP requirement -- both `u`,`v` OR both `speed`,`direction`
// must be bound -- can't be expressed by the generic per-role `required`
// flag in bind-data.mjs's validateBinding() (that only knows "this ONE role
// is required", not "one of these two role PAIRS"). Per 07-RESEARCH.md's
// Open Question #2, this one special case lives here, in the shaper's own
// validate(), rather than growing the manifest schema for a single
// technique.
//
// The demo binds scripts/tests/fixtures/binding/wind_gfs_pnw_hour19_lattice.csv
// (see that file's own header comment): data/wind_gfs_pnw_20260115.json's
// raw per-point objects, flattened to one row per lattice point at
// HOUR_INDEX=19, lat/lon ROUNDED to the nearest whole degree (the raw
// Open-Meteo grid-snapped floats do not form an exact regular lattice at
// full precision -- rounding does, bijectively, 6x8=48).

function isFiniteNumberString(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function coerceNum(raw) {
  if (!isFiniteNumberString(raw)) return NaN;
  return Number(String(raw).trim());
}

/**
 * extractPoints(rows, bindings) -> Array<{lat,lon,u?,v?,speed?,direction?}>
 * Only rows with BOTH a coercible lat and lon are kept -- a row missing
 * either coordinate can't be placed on the lattice at all.
 */
function extractPoints(rows, bindings) {
  const latCol = bindings.lat;
  const lonCol = bindings.lon;
  const uCol = bindings.u;
  const vCol = bindings.v;
  const speedCol = bindings.speed;
  const dirCol = bindings.direction;

  const points = [];
  for (const row of rows || []) {
    if (!row) continue;
    const lat = coerceNum(row[latCol]);
    const lon = coerceNum(row[lonCol]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const point = { lat, lon };
    if (uCol) point.u = coerceNum(row[uCol]);
    if (vCol) point.v = coerceNum(row[vCol]);
    if (speedCol) point.speed = coerceNum(row[speedCol]);
    if (dirCol) point.direction = coerceNum(row[dirCol]);
    points.push(point);
  }
  return points;
}

// A small ABSOLUTE tolerance on axis spacing -- generous enough to absorb
// ordinary floating-point noise in a genuinely regular grid, strict enough
// to reject a real irregular point set (07-RESEARCH.md: "checked, not
// assumed").
const SPACING_TOLERANCE = 1e-6;

function evenlySpaced(sortedValues) {
  if (sortedValues.length < 2) return false;
  const step = sortedValues[1] - sortedValues[0];
  for (let i = 2; i < sortedValues.length; i++) {
    if (Math.abs(sortedValues[i] - sortedValues[i - 1] - step) > SPACING_TOLERANCE) return false;
  }
  return true;
}

/**
 * isRegularLattice(points) -> boolean
 * A REGULAR lattice requires ALL of:
 *   - at least 2 distinct latitudes AND 2 distinct longitudes
 *   - distinct(lat) * distinct(lon) === points.length (right cell count)
 *   - every (lat,lon) pair is UNIQUE (a true bijection onto the grid cells,
 *     not just a coincidentally-matching count)
 *   - both axes are evenly spaced (within SPACING_TOLERANCE)
 */
function isRegularLattice(points) {
  const distinctLat = Array.from(new Set(points.map((p) => p.lat))).sort((a, b) => a - b);
  const distinctLon = Array.from(new Set(points.map((p) => p.lon))).sort((a, b) => a - b);

  if (distinctLat.length < 2 || distinctLon.length < 2) return false;
  if (distinctLat.length * distinctLon.length !== points.length) return false;

  const pairKeys = new Set(points.map((p) => `${p.lat}|${p.lon}`));
  if (pairKeys.size !== points.length) return false;

  return evenlySpaced(distinctLat) && evenlySpaced(distinctLon);
}

/**
 * shape(rows, bindings) -> { lattice: { latsN, lonsN, gridU, gridV,
 * gridSpeed }, stats: { minSpeed, maxSpeed } }
 *
 * Grid axes are the bound lat/lon values sorted ASCENDING -- row index 0 is
 * the SOUTHERNMOST bound latitude, column index 0 the WESTERNMOST bound
 * longitude (matches this project's own demo dataset's natural point order,
 * data/DATA.md's documented `lats=[40,42,...]`/`lons=-135..-121` construction).
 * u/v are used directly when bound; otherwise derived from speed+direction
 * via the meteorological "from"-bearing transform (skill/manifest/
 * flow-field.json's mapping[0].transform, data/DATA.md's own documented
 * conversion): `u = -speed*sin(dir*PI/180)`, `v = -speed*cos(dir*PI/180)`.
 * `speed` is used directly when bound; otherwise derived as `sqrt(u^2+v^2)`.
 */
export function shape(rows, bindings) {
  const points = extractPoints(rows, bindings);

  const distinctLat = Array.from(new Set(points.map((p) => p.lat))).sort((a, b) => a - b);
  const distinctLon = Array.from(new Set(points.map((p) => p.lon))).sort((a, b) => a - b);
  const latsN = distinctLat.length;
  const lonsN = distinctLon.length;

  const latIndex = new Map(distinctLat.map((v, i) => [v, i]));
  const lonIndex = new Map(distinctLon.map((v, i) => [v, i]));

  const gridU = Array.from({ length: latsN }, () => new Array(lonsN).fill(0));
  const gridV = Array.from({ length: latsN }, () => new Array(lonsN).fill(0));
  const gridSpeed = Array.from({ length: latsN }, () => new Array(lonsN).fill(0));

  for (const p of points) {
    const i = latIndex.get(p.lat);
    const j = lonIndex.get(p.lon);

    let u;
    let v;
    if (Number.isFinite(p.u) && Number.isFinite(p.v)) {
      u = p.u;
      v = p.v;
    } else if (Number.isFinite(p.speed) && Number.isFinite(p.direction)) {
      const rad = (p.direction * Math.PI) / 180;
      u = -p.speed * Math.sin(rad);
      v = -p.speed * Math.cos(rad);
    } else {
      u = 0;
      v = 0;
    }
    const speed = Number.isFinite(p.speed) ? p.speed : Math.sqrt(u * u + v * v);

    gridU[i][j] = u;
    gridV[i][j] = v;
    gridSpeed[i][j] = speed;
  }

  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  for (let i = 0; i < latsN; i++) {
    for (let j = 0; j < lonsN; j++) {
      if (gridSpeed[i][j] < minSpeed) minSpeed = gridSpeed[i][j];
      if (gridSpeed[i][j] > maxSpeed) maxSpeed = gridSpeed[i][j];
    }
  }

  return {
    lattice: { latsN, lonsN, gridU, gridV, gridSpeed },
    stats: { minSpeed, maxSpeed },
  };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - role-GROUP: neither (u AND v) nor (speed AND direction) fully bound ->
 *   a named error (the special case bind-data.mjs's generic validator can't
 *   express).
 * - no rows with both a valid lat and lon -> a named error (nothing to grid).
 * - the bound lat/lon values do not form a REGULAR lattice (see
 *   isRegularLattice) -> the honest "your data isn't a spatial grid" error,
 *   this technique's core data-availability gate.
 */
export function validate(rows, bindings) {
  const errors = [];

  const hasUV = Boolean(bindings.u) && Boolean(bindings.v);
  const hasSpeedDir = Boolean(bindings.speed) && Boolean(bindings.direction);
  if (!hasUV && !hasSpeedDir) {
    errors.push({
      channel: 'u/v|speed/direction',
      problem:
        "flow-field requires either both 'u' and 'v' bound, OR both 'speed' and 'direction' bound -- neither role-group is fully bound",
      remedy:
        "bind both 'u' and 'v' to eastward/northward vector-component columns, OR bind both 'speed' and 'direction' to wind speed + bearing columns",
    });
  }

  const points = extractPoints(rows, bindings);
  if (points.length === 0) {
    errors.push({
      channel: 'lat/lon',
      problem: "channel 'lat/lon': no rows have both a coercible lat and lon value",
      remedy: "bind 'lat'/'lon' to numeric coordinate columns with real values",
    });
    return errors;
  }

  if (!isRegularLattice(points)) {
    errors.push({
      channel: 'lat/lon',
      problem:
        "flow-field requires a genuine spatial grid -- your lat/lon values do not form a regular lattice (irregular spacing, a non-rectangular point set, or duplicated coordinates detected)",
      remedy:
        'bind lat/lon to a dataset whose coordinates form an evenly-spaced rectangular grid (distinct lat count x distinct lon count == row count, one row per cell)',
    });
  }

  return errors;
}
