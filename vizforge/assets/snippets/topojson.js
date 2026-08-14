// assets/snippets/topojson.js
//
// Hand-inlined TopoJSON -> GeoJSON decoder (FND-01). Reimplements the two
// entry points family phases need from topojson-client -- feature() and
// mesh() -- as pure functions over a plain topology object, with NO
// imports and NO runtime dependency on the topojson-client package
// (19-CONTEXT.md: zero new runtime deps, hand-inline preferred). Designed
// to be INLINED via @inline-module into a piece's single HTML file
// (PIPE-01), mirroring assets/snippets/scale-helpers.js's export style.
//
// TopoJSON arc encoding (spec): each arc is an array of [x,y] pairs. When
// topology.transform is present, arcs are quantized + delta-encoded -- the
// FIRST point of an arc is itself a delta from [0,0], and every subsequent
// point is a delta from the previous point; both are then
// scaled/translated by transform.{scale,translate}. When transform is
// absent, arc points are already absolute (no decoding needed). A negative
// arc index `~i` (bitwise NOT) inside an object's arc list means "walk
// arcs[i] in reverse" -- TopoJSON's shared-border convention, so two
// adjacent polygons can each reference the same physical arc once,
// forwards from one side and backwards from the other.

/**
 * Decodes one arc (by index, honoring TopoJSON's `~i` reversal
 * convention) into an array of absolute [x, y] points.
 */
export function decodeArc(topology, index) {
  const i = index < 0 ? ~index : index;
  const raw = topology.arcs[i];
  const transform = topology.transform;
  let points;

  if (transform) {
    const [kx, ky] = transform.scale;
    const [dx, dy] = transform.translate;
    let x = 0;
    let y = 0;
    points = raw.map(([px, py]) => {
      x += px;
      y += py;
      return [x * kx + dx, y * ky + dy];
    });
  } else {
    points = raw.map((p) => p.slice());
  }

  return index < 0 ? points.reverse() : points;
}

// Stitches a list of arc indexes into one continuous line, decoding each
// arc and deduping the shared endpoint between consecutive arcs (the last
// point of one arc is always the first point of the next).
function stitchLine(topology, arcIndexes) {
  const points = [];
  for (const idx of arcIndexes) {
    const arcPoints = decodeArc(topology, idx);
    if (points.length > 0) points.pop();
    points.push(...arcPoints);
  }
  return points;
}

// A ring is a stitched line, closed (repeated first point) if the source
// arcs did not already close it, and padded to the minimum 4 positions a
// valid GeoJSON linear ring requires.
function ring(topology, arcIndexes) {
  const points = stitchLine(topology, arcIndexes);
  while (points.length < 4) points.push(points[0].slice());
  return points;
}

function geometryToCoordinates(topology, o) {
  switch (o.type) {
    case 'LineString':
      return stitchLine(topology, o.arcs);
    case 'MultiLineString':
      return o.arcs.map((arcIndexes) => stitchLine(topology, arcIndexes));
    case 'Polygon':
      return o.arcs.map((arcIndexes) => ring(topology, arcIndexes));
    case 'MultiPolygon':
      return o.arcs.map((polygonArcs) => polygonArcs.map((arcIndexes) => ring(topology, arcIndexes)));
    default:
      throw new Error(`topojson decoder: unsupported geometry type "${o.type}"`);
  }
}

function decodeGeometry(topology, o) {
  if (o.type === 'GeometryCollection') {
    return { type: 'GeometryCollection', geometries: o.geometries.map((g) => decodeGeometry(topology, g)) };
  }
  return { type: o.type, coordinates: geometryToCoordinates(topology, o) };
}

/**
 * topojson-client's `feature()` semantics: decode a topology object into a
 * GeoJSON Feature (or FeatureCollection, when `object` is a
 * GeometryCollection).
 */
export function feature(topology, object) {
  if (object.type === 'GeometryCollection') {
    return {
      type: 'FeatureCollection',
      features: object.geometries.map((g) => feature(topology, g)),
    };
  }
  return {
    type: 'Feature',
    properties: object.properties || {},
    geometry: decodeGeometry(topology, object),
  };
}

/**
 * topojson-client's `mesh()` semantics: decode every arc referenced by
 * `object` (LineString/MultiLineString/Polygon/MultiPolygon/
 * GeometryCollection) into a single GeoJSON MultiLineString, deduplicated
 * by absolute arc index -- two neighboring polygons sharing one border arc
 * (one referencing it forward, the other reversed) contribute exactly one
 * line, not two.
 */
export function mesh(topology, object) {
  const seen = new Set();
  const order = [];

  function collectLine(arcIndexes) {
    for (const idx of arcIndexes) {
      const abs = idx < 0 ? ~idx : idx;
      if (!seen.has(abs)) {
        seen.add(abs);
        order.push(abs);
      }
    }
  }

  function collect(o) {
    if (o.type === 'GeometryCollection') o.geometries.forEach(collect);
    else if (o.type === 'LineString') collectLine(o.arcs);
    else if (o.type === 'MultiLineString') o.arcs.forEach(collectLine);
    else if (o.type === 'Polygon') o.arcs.forEach(collectLine);
    else if (o.type === 'MultiPolygon') o.arcs.forEach((polygonArcs) => polygonArcs.forEach(collectLine));
  }

  collect(object);

  return {
    type: 'MultiLineString',
    coordinates: order.map((abs) => decodeArc(topology, abs)),
  };
}
