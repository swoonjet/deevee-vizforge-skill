// assets/snippets/hexbin.js
//
// Hand-inlined d3-hexbin-equivalent binning helper (FND-01). Reimplements
// the chainable hexbin() factory the 2D-density family phases need, with
// NO imports and NO runtime dependency on the d3-hexbin package
// (19-CONTEXT.md: zero new runtime deps, hand-inline preferred). Designed
// to be INLINED via @inline-module into a piece's single HTML file
// (PIPE-01), mirroring assets/snippets/scale-helpers.js's export style.
//
// Hex lattice geometry (pointy-top hexagons, matches d3-hexbin's default
// orientation): for radius r, adjacent hex-center columns are
// dx = 2*sin(PI/3)*r apart, adjacent rows are dy = 1.5*r apart, and every
// other row is offset by dx/2. Binning a point picks the NEARER of two
// candidate centers -- this row's nearest column vs. the
// vertically-adjacent row's nearest column -- the standard two-candidate
// nearest-hex-center test, exact for a true hex lattice and fully
// deterministic (no Math.random anywhere in this module).

function defaultX(d) {
  return d[0];
}

function defaultY(d) {
  return d[1];
}

function candidateCenter(px, dx, dy, row) {
  const offset = row & 1 ? dx / 2 : 0;
  const col = Math.round((px - offset) / dx);
  return { row, col, cx: col * dx + offset, cy: row * dy };
}

function nearestCenter(px, py, dx, dy) {
  const row1 = Math.round(py / dy);
  const c1 = candidateCenter(px, dx, dy, row1);
  const row2 = row1 + (py < c1.cy ? -1 : 1);
  const c2 = candidateCenter(px, dx, dy, row2);
  const d1 = (px - c1.cx) ** 2 + (py - c1.cy) ** 2;
  const d2 = (px - c2.cx) ** 2 + (py - c2.cy) ** 2;
  return d2 < d1 ? c2 : c1;
}

/**
 * SVG path string for one pointy-top regular hexagon of the given radius,
 * centered at the origin (position it with a <g transform="translate(...)">).
 */
export function hexagonPath(radius) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return `M${points.map((p) => p.join(',')).join('L')}Z`;
}

/**
 * Chainable hexbin factory (mirrors d3-hexbin's API surface). Call the
 * returned function on a point array to get back an array of bins, each
 * an Array of the member points carrying extra `.x`/`.y` properties set
 * to the bin's hex-lattice CENTER (never a member point itself), so
 * `bin.length` is the point count for free.
 */
export function hexbin() {
  let x = defaultX;
  let y = defaultY;
  let radius = 1;
  let extent = [
    [0, 0],
    [1, 1],
  ];

  function hexbinInstance(points) {
    const dx = radius * 2 * Math.sin(Math.PI / 3);
    const dy = radius * 1.5;
    const binsByKey = new Map();
    const bins = [];

    points.forEach((d, i) => {
      const px = +x(d, i, points);
      const py = +y(d, i, points);
      if (Number.isNaN(px) || Number.isNaN(py)) return;

      const center = nearestCenter(px, py, dx, dy);
      const key = `${center.row}-${center.col}`;
      let bin = binsByKey.get(key);
      if (!bin) {
        bin = [];
        bin.x = center.cx;
        bin.y = center.cy;
        bins.push(bin);
        binsByKey.set(key, bin);
      }
      bin.push(d);
    });

    return bins;
  }

  hexbinInstance.x = function (fn) {
    if (!arguments.length) return x;
    x = fn;
    return hexbinInstance;
  };

  hexbinInstance.y = function (fn) {
    if (!arguments.length) return y;
    y = fn;
    return hexbinInstance;
  };

  hexbinInstance.radius = function (r) {
    if (!arguments.length) return radius;
    radius = +r;
    return hexbinInstance;
  };

  hexbinInstance.extent = function (e) {
    if (!arguments.length) return extent;
    extent = e;
    return hexbinInstance;
  };

  hexbinInstance.hexagon = function (r) {
    return hexagonPath(r === undefined ? radius : r);
  };

  return hexbinInstance;
}
