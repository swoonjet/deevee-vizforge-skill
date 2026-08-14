// assets/modules/data-cube.js
//
// THE DATA CUBE — three measures at once, and the only honest 3-D in this
// project. Portable module.
//
// WHY 3-D IS NORMALLY REFUSED. `recommend.mjs` turns down "make it 3d" with the
// 3d-distortion anti-pattern and offers a bar instead, because a static
// perspective render lies twice: foreshortening shrinks the marks that are
// further away, so an encoded magnitude stops being true to length, and one
// frozen viewpoint hides whatever sits behind something else.
//
// WHY THIS ONE IS NOT. Both lies are removed, and neither removal is optional:
//
//   1. ORTHOGRAPHIC PROJECTION. `project()` rotates and drops the third
//      coordinate — there is no perspective divide anywhere in this file. A dot
//      at the back of the cube is drawn at exactly the same scale as one at the
//      front, so position remains true to value.
//   2. THE READER TURNS IT. Occlusion is only a lie while the viewpoint is
//      fixed. Dragging resolves it, and snapping to a face collapses the third
//      axis entirely: what remains is a true flat scatter of the other two, with
//      its own gridlines and ticks — the same chart the atlas would have drawn.
//
// DEPTH CUEING IS NOT AN ENCODING. Nearer dots are drawn slightly larger and
// more opaque, which is a depth aid and nothing else. Size normally means
// magnitude, so the piece says outright that here it does not.
//
// Deterministic: no Math.random, and every animation is driven by a start
// timestamp so a captured frame at time t is always the same frame
// (docs/determinism.md). Reduced motion collapses the tween to a single frame
// and refuses to auto-spin.

import {
  buildFrame, observeSize, resolveCategories, positionDomain,
  formatNumber, svgEl, showTip, hideTip, clamp, prefersReducedMotion,
  interactionNote, toNumber, createMotion, dataChanged,
} from './vf-core.js';

export const slug = 'data-cube';

export const roles = {
  x: { types: ['quantitative'], required: true, label: 'First measure' },
  y: { types: ['quantitative'], required: true, label: 'Second measure' },
  z: { types: ['quantitative'], required: true, label: 'Third measure' },
  label: { types: ['nominal', 'ordinal'], required: false, label: 'Point label' },
  group: { types: ['nominal', 'ordinal'], required: false, label: 'Group (one colour each)' },
};

const AXES = ['x', 'y', 'z'];

// Each face names the two measures that survive on screen and the one that
// collapses into depth. Free rotation sits at an angle where all three read.
const FACES = {
  free: { title: 'Free 3D', az: -0.62, el: 0.42 },
  xy: { title: null, az: 0, el: 0, h: 'x', v: 'y', depth: 'z' },
  zy: { title: null, az: Math.PI / 2, el: 0, h: 'z', v: 'y', depth: 'x' },
  xz: { title: null, az: 0, el: -Math.PI / 2, h: 'x', v: 'z', depth: 'y' },
};

export function shape(rows, bindings = {}) {
  const cols = { x: bindings.x, y: bindings.y, z: bindings.z };
  const labelCol = bindings.label;
  const groupCol = bindings.group;

  const points = [];
  let skipped = 0;
  for (const row of rows || []) {
    if (!row) continue;
    const v = {};
    let usable = true;
    for (const axis of AXES) {
      const n = toNumber(row[cols[axis]]);
      // A blank cell is not a zero — it would plant the point on a face it does
      // not belong to (scripts/tests/smoke/blank-is-not-zero.test.mjs).
      if (!Number.isFinite(n)) { usable = false; break; }
      v[axis] = n;
    }
    if (!usable) { skipped += 1; continue; }
    points.push({
      x: v.x,
      y: v.y,
      z: v.z,
      label: labelCol && row[labelCol] !== undefined && row[labelCol] !== null
        ? String(row[labelCol])
        : null,
      group: groupCol && row[groupCol] !== undefined && row[groupCol] !== null
        ? String(row[groupCol])
        : null,
    });
  }

  const domains = {};
  for (const axis of AXES) domains[axis] = positionDomain(points.map((p) => p[axis])).domain;

  const groups = [...new Set(points.map((p) => p.group).filter((g) => g !== null))].sort();

  // THE FINDING this form is for: a reader looking at three measures wants to
  // know whether anything manages to be high on all of them, and the answer is
  // usually a trade-off between two of them.
  const tradeoff = findTradeoff(points, domains);

  return {
    points,
    domains,
    groups,
    stats: {
      pointCount: points.length,
      sourceRowCount: (rows || []).length,
      skipped,
      groupCount: groups.length,
      axisNames: { x: cols.x, y: cols.y, z: cols.z },
      hasLabels: Boolean(labelCol),
      tradeoff,
    },
  };
}

/**
 * THE TRADE-OFF THIS CUBE SHOWS — which two measures nothing manages to be high
 * on at once.
 *
 * The first version reported the emptiest CORNER of the cube, which was true and
 * useless: it landed on "high speed, low quality, high cost", a corner no reader
 * wants anything to occupy. Worse, correlated measures leave corners empty by
 * construction, so an empty corner is not by itself a finding.
 *
 * A pair is the honest unit. For each of the three pairs this counts the rows in
 * the "high on both" quadrant of NORMALISED space (so the measures count equally
 * whatever their units) and reports the emptiest, ranked by how strongly the pair
 * pulls against each other. The claim the headline then makes is a count of rows,
 * not a causal story: nothing is high on both, or only n are.
 *
 * Which direction counts as GOOD is deliberately not guessed — the data cannot
 * say whether high cost is good news, so the piece never implies it.
 */
function findTradeoff(points, domains) {
  if (points.length < 4) return null;
  const norm = (p, axis) => {
    const [lo, hi] = domains[axis];
    return hi === lo ? 0.5 : (p[axis] - lo) / (hi - lo);
  };

  const pairs = [['x', 'y'], ['x', 'z'], ['y', 'z']];
  let best = null;

  for (const [a, b] of pairs) {
    const na = points.map((p) => norm(p, a));
    const nb = points.map((p) => norm(p, b));
    const bothHigh = points.filter((p, i) => na[i] > 0.6 && nb[i] > 0.6).length;

    // Pearson r, only to RANK the pairs by how opposed they are. It is never
    // reported as a statistic and never described as causal.
    const meanA = na.reduce((s, v) => s + v, 0) / na.length;
    const meanB = nb.reduce((s, v) => s + v, 0) / nb.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < na.length; i += 1) {
      num += (na[i] - meanA) * (nb[i] - meanB);
      da += (na[i] - meanA) ** 2;
      db += (nb[i] - meanB) ** 2;
    }
    const r = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;

    const candidate = { a, b, bothHigh, r };
    if (!best || candidate.bothHigh < best.bothHigh
      || (candidate.bothHigh === best.bothHigh && candidate.r < best.r)) {
      best = candidate;
    }
  }
  return best;
}

export function validate(rows, bindings) {
  const errors = [];
  const { points } = shape(rows, bindings);
  if (points.length < 3) {
    errors.push({
      channel: 'x',
      problem: `channel 'x','y','z': only ${points.length} row(s) have all three measures, so there is no cloud to rotate`,
      remedy: 'bind three numeric columns that are populated on the same rows',
    });
  }
  return errors;
}

function defaultHeadline(stats) {
  if (!stats.pointCount) return 'No points with all three measures';
  const { tradeoff, axisNames } = stats;
  if (tradeoff) {
    const a = axisNames[tradeoff.a];
    const b = axisNames[tradeoff.b];
    if (tradeoff.bothHigh === 0) return `Nothing is high on both ${a} and ${b}`;
    if (tradeoff.bothHigh <= Math.max(1, Math.round(stats.pointCount * 0.1))) {
      return `Only ${tradeoff.bothHigh} of ${stats.pointCount} are high on both ${a} and ${b}`;
    }
  }
  return `${stats.pointCount} rows placed by ${axisNames.x}, ${axisNames.y} and ${axisNames.z}`;
}

function defaultDek(stats, copy, config) {
  const { axisNames } = stats;
  const clauses = [
    `each dot is one row, placed by ${axisNames.x}, ${axisNames.y} and ${axisNames.z}`,
  ];
  if (stats.groupCount > 1) clauses.push(`${stats.groupCount} groups by colour`);
  const subject = (copy || {}).subject;
  return `${clauses.join(', ')}${subject ? ` — ${subject}` : ''}.`
    + interactionNote(config, ' Drag to rotate; snap to a face to read any two as a true flat scatter.');
}

export function mount(el, config = {}) {
  let state = normalize(config);
  const reduced = prefersReducedMotion();

  function frameOpts() {
    return {
      legend: state.groups.length > 1,
      ariaLabel: `Rotatable orthographic data cube, ${state.stats.pointCount} points across three measures`,
      defaultHeadline: defaultHeadline(state.stats),
      defaultDek: defaultDek(state.stats, state.config.copy, state.config),
      note: state.note,
    };
  }

  let frame = buildFrame(el, state.config, frameOpts());
  let controls = buildControls();
  let colors = resolveCategories(el, Math.max(1, state.groups.length));
  const hiddenGroups = new Set();

  let az = FACES.free.az;
  let el_ = FACES.free.el;
  let face = 'free';
  let mix = 0;            // 0 = 3-D affordances, 1 = flat-face gridlines
  let tween = null;
  let spinning = false;
  let hover = -1;
  let dragging = false;
  let lastPointer = null;
  let moved = false;
  let raf = null;
  let currentSize = null;
  let teardown = null;

  // --- controls -------------------------------------------------------------

  function buildControls() {
    const style = document.createElement('style');
    style.textContent = `
.${frame.rootClass} .vf-cube-controls{ display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; margin:0 0 0.6rem 0; }
.${frame.rootClass} .vf-cube-controls button{
  font-family: var(--_fl); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em;
  color: var(--_muted); background: transparent; cursor: pointer;
  border: 1px solid var(--_hair); border-radius: 0.4rem; padding: 0.3rem 0.55rem;
}
.${frame.rootClass} .vf-cube-controls button[aria-pressed="true"]{ color: var(--_ink); border-color: var(--_ink); }`;
    el.insertBefore(style, frame.plot);

    const row = document.createElement('div');
    row.className = 'vf-cube-controls';

    const faceButtons = [];
    const faceKeys = ['free', 'xy', 'zy', 'xz'];
    for (const key of faceKeys) {
      const spec = FACES[key];
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-cube-face', key);
      button.setAttribute('aria-pressed', String(key === 'free'));
      button.textContent = spec.title
        || `${state.stats.axisNames[spec.h]} · ${state.stats.axisNames[spec.v]}`;
      button.addEventListener('click', () => goToFace(key));
      row.appendChild(button);
      faceButtons.push(button);
    }

    const spin = document.createElement('button');
    spin.type = 'button';
    spin.setAttribute('data-cube-spin', '');
    spin.setAttribute('aria-pressed', 'false');
    spin.textContent = 'Spin';
    spin.addEventListener('click', () => {
      if (face !== 'free') goToFace('free');
      spinning = !spinning;
      spin.setAttribute('aria-pressed', String(spinning));
      if (spinning) startLoop();
    });
    row.appendChild(spin);

    el.insertBefore(row, frame.plot);
    return { row, faceButtons, spin, style };
  }

  function markFace(key) {
    for (const button of controls.faceButtons) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-cube-face') === key));
    }
  }

  function goToFace(key) {
    const spec = FACES[key];
    // Shortest way round, so a snap never takes the long path.
    let dAz = spec.az - az;
    dAz = ((dAz + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    tween = {
      fromAz: az, dAz, fromEl: el_, dEl: spec.el - el_,
      toAz: spec.az, toEl: spec.el,
      fromMix: mix, toMix: key === 'free' ? 0 : 1,
      start: performance.now(), duration: reduced ? 1 : 900,
      face: key,
    };
    if (key !== 'free') {
      spinning = false;
      controls.spin.setAttribute('aria-pressed', 'false');
    }
    markFace(key);
    startLoop();
  }

  // --- projection -----------------------------------------------------------

  /**
   * Orthographic: rotate by azimuth then elevation, then drop depth. `d` is
   * returned for SORTING and depth cueing only — it never scales x or y, which
   * is precisely what keeps position true to value.
   */
  function project(x, y, z, cx, cy, scale) {
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    const ce = Math.cos(el_);
    const se = Math.sin(el_);
    const y2 = y * ce - z1 * se;
    const z2 = y * se + z1 * ce;
    return { x: cx + x1 * scale, y: cy - y2 * scale, d: z2 };
  }

  function unit(point, axis) {
    const [lo, hi] = state.domains[axis];
    if (hi === lo) return 0;
    return ((point[axis] - lo) / (hi - lo)) * 2 - 1;
  }

  function valueAt(axis, u) {
    const [lo, hi] = state.domains[axis];
    return lo + ((u + 1) / 2) * (hi - lo);
  }

  // --- drawing --------------------------------------------------------------

  const CORNERS = [];
  for (let i = 0; i < 8; i += 1) CORNERS.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  const EDGES = [];
  for (let i = 0; i < 8; i += 1) {
    for (let j = i + 1; j < 8; j += 1) {
      let differing = 0;
      for (let k = 0; k < 3; k += 1) if (CORNERS[i][k] !== CORNERS[j][k]) differing += 1;
      if (differing === 1) EDGES.push([i, j]);
    }
  }

  function draw(width, height) {
    const svg = frame.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const visible = state.points.filter((p) => !(p.group && hiddenGroups.has(p.group)));
    if (!visible.length) return;

    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.32;
    const flat = mix > 0.02 && face !== 'free';
    const spec = FACES[face];

    const projected = CORNERS.map((c) => project(c[0], c[1], c[2], cx, cy, scale));

    // 1. Wireframe, far edges first and fainter — a depth aid, drawn in hairline
    //    ink so it never competes with the marks.
    const wire = svgEl('g');
    EDGES
      .map(([a, b]) => ({ a, b, d: (projected[a].d + projected[b].d) / 2 }))
      .sort((u, v) => u.d - v.d)
      .forEach((edge) => {
        const near = clamp((edge.d + 1.6) / 3.2, 0, 1);
        wire.appendChild(svgEl('line', {
          x1: projected[edge.a].x, y1: projected[edge.a].y,
          x2: projected[edge.b].x, y2: projected[edge.b].y,
          stroke: 'var(--_ink)',
          'stroke-opacity': (0.05 + 0.1 * near) * (1 - mix * 0.7),
          'stroke-width': 0.8 + 0.5 * near,
        }));
      });
    svg.appendChild(wire);

    // 2a. Free rotation: name the three axes along their own edges.
    if (mix < 0.98) {
      const axesGroup = svgEl('g');
      const origin = project(-1, -1, -1, cx, cy, scale);
      const ends = {
        x: project(1, -1, -1, cx, cy, scale),
        y: project(-1, 1, -1, cx, cy, scale),
        z: project(-1, -1, 1, cx, cy, scale),
      };
      for (const axis of AXES) {
        const end = ends[axis];
        axesGroup.appendChild(svgEl('line', {
          x1: origin.x, y1: origin.y, x2: end.x, y2: end.y,
          stroke: 'var(--_ink)', 'stroke-opacity': 0.34 * (1 - mix), 'stroke-width': 1.1,
        }));
        const label = svgEl('text', {
          x: end.x + (end.x - cx) * 0.07,
          y: end.y + (end.y - cy) * 0.07,
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          fill: 'var(--_ink)', 'fill-opacity': 0.82 * (1 - mix),
          'font-family': 'var(--_fl)', 'font-size': 10.5, 'font-weight': 600,
        });
        label.textContent = state.stats.axisNames[axis];
        axesGroup.appendChild(label);
      }
      svg.appendChild(axesGroup);
    }

    // 2b. Snapped to a face: a real flat scatter — gridlines, ticks, axis names.
    if (flat) {
      const grid = svgEl('g');
      const onFace = (h, v) => {
        const coords = { x: 0, y: 0, z: 0 };
        coords[spec.h] = h;
        coords[spec.v] = v;
        coords[spec.depth] = -1;
        return project(coords.x, coords.y, coords.z, cx, cy, scale);
      };
      const steps = [-1, -0.5, 0, 0.5, 1];
      for (const t of steps) {
        const a = onFace(t, -1);
        const b = onFace(t, 1);
        const c = onFace(-1, t);
        const d = onFace(1, t);
        grid.appendChild(svgEl('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          stroke: 'var(--_ink)', 'stroke-opacity': 0.08 * mix, 'stroke-width': 1,
        }));
        grid.appendChild(svgEl('line', {
          x1: c.x, y1: c.y, x2: d.x, y2: d.y,
          stroke: 'var(--_ink)', 'stroke-opacity': 0.08 * mix, 'stroke-width': 1,
        }));
      }
      const bottom = onFace(0, -1).y;
      const leftEdge = onFace(-1, 0).x;
      for (const t of steps) {
        const hTick = svgEl('text', {
          x: onFace(t, -1).x, y: bottom + 16, 'text-anchor': 'middle',
          fill: 'var(--_ink)', 'fill-opacity': 0.6 * mix,
          'font-family': 'var(--_ff)', 'font-size': 10, 'font-variant-numeric': 'tabular-nums',
        });
        hTick.textContent = formatNumber(valueAt(spec.h, t));
        grid.appendChild(hTick);

        const vTick = svgEl('text', {
          x: leftEdge - 8, y: onFace(-1, t).y, 'text-anchor': 'end', 'dominant-baseline': 'middle',
          fill: 'var(--_ink)', 'fill-opacity': 0.6 * mix,
          'font-family': 'var(--_ff)', 'font-size': 10, 'font-variant-numeric': 'tabular-nums',
        });
        vTick.textContent = formatNumber(valueAt(spec.v, t));
        grid.appendChild(vTick);
      }
      for (const [axis, x, y, anchor] of [
        [spec.h, cx, bottom + 32, 'middle'],
        [spec.v, leftEdge - 8, onFace(-1, 1).y - 12, 'start'],
      ]) {
        const name = svgEl('text', {
          x, y, 'text-anchor': anchor,
          fill: 'var(--_ink)', 'fill-opacity': 0.82 * mix,
          'font-family': 'var(--_fl)', 'font-size': 10.5, 'font-weight': 600,
        });
        name.textContent = state.stats.axisNames[axis];
        grid.appendChild(name);
      }
      svg.appendChild(grid);
    }

    // 3. The marks, far to near so nearer dots land on top.
    const marks = svgEl('g');
    visible
      .map((p, i) => ({ p, i, at: project(unit(p, 'x'), unit(p, 'y'), unit(p, 'z'), cx, cy, scale) }))
      .sort((a, b) => a.at.d - b.at.d)
      .forEach((entry) => {
        const near = clamp((entry.at.d + 1.6) / 3.2, 0, 1);
        // Depth cue, faded out as the cube flattens: on a face there is no depth
        // left to cue, and a size difference there would be a lie about value.
        const cue = 0.74 + 0.34 * near;
        const radius = 5 * (cue * (1 - mix) + mix);
        const fill = entry.p.group && state.groups.length > 1
          ? colors[state.groups.indexOf(entry.p.group) % colors.length]
          : 'var(--_mark)';
        const dot = svgEl('circle', {
          cx: entry.at.x, cy: entry.at.y, r: radius,
          fill,
          'fill-opacity': (0.5 + 0.45 * near) * (1 - mix) + 0.88 * mix,
          style: 'cursor:default',
        });
        if (entry.i === hover) {
          marks.appendChild(svgEl('circle', {
            cx: entry.at.x, cy: entry.at.y, r: radius + 4.5,
            fill: 'none', stroke: fill, 'stroke-width': 1.7, 'stroke-opacity': 0.9,
          }));
        }
        const onEnter = () => {
          if (dragging) return;
          hover = entry.i;
          const box = frame.svg.getBoundingClientRect();
          const rowsText = AXES
            .map((axis) => `${escapeHtml(state.stats.axisNames[axis])} <b>${formatNumber(entry.p[axis])}</b>`)
            .join(' · ');
          showTip(
            frame.tip,
            `${entry.p.label ? `<div><b>${escapeHtml(entry.p.label)}</b></div>` : ''}`
            + `${entry.p.group ? `<div>${escapeHtml(entry.p.group)}</div>` : ''}`
            + `<div>${rowsText}</div>`,
            (entry.at.x / width) * box.width,
            (entry.at.y / height) * box.height
          );
        };
        dot.addEventListener('pointerenter', onEnter);
        dot.addEventListener('pointerleave', () => { hover = -1; hideTip(frame.tip); });
        marks.appendChild(dot);
      });
    svg.appendChild(marks);
  }

  function redraw() { if (currentSize) draw(currentSize[0], currentSize[1]); }

  // --- animation ------------------------------------------------------------

  function step() {
    raf = null;
    let again = false;

    if (tween) {
      const t = clamp((performance.now() - tween.start) / tween.duration, 0, 1);
      // Sine ease-in-out, long and soft — the house easing
      // ([[feedback_animation_easing]], assets/snippets/easing.js).
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
      az = tween.fromAz + tween.dAz * eased;
      el_ = tween.fromEl + tween.dEl * eased;
      mix = tween.fromMix + (tween.toMix - tween.fromMix) * eased;
      if (t >= 1) {
        az = tween.toAz;
        el_ = tween.toEl;
        mix = tween.toMix;
        face = tween.face;
        tween = null;
      } else {
        again = true;
      }
    }

    if (spinning && !tween && !dragging && face === 'free' && !reduced) {
      az += 0.006;
      again = true;
    }

    redraw();
    if (again) startLoop();
  }

  function startLoop() {
    if (raf === null) raf = requestAnimationFrame(step);
  }

  // --- rotation by drag -----------------------------------------------------

  function attachDrag() {
    const surface = frame.svg;
    surface.style.touchAction = 'none';

    surface.addEventListener('pointerdown', (event) => {
      dragging = true;
      moved = false;
      lastPointer = { x: event.clientX, y: event.clientY };
      hideTip(frame.tip);
      hover = -1;
      if (surface.setPointerCapture) surface.setPointerCapture(event.pointerId);
    });

    surface.addEventListener('pointermove', (event) => {
      if (!dragging || !lastPointer) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      az += dx * 0.01;
      // Elevation is clamped short of the poles: past vertical the cube flips
      // and the axis labels read upside down.
      el_ = clamp(el_ - dy * 0.01, -1.45, 1.45);
      lastPointer = { x: event.clientX, y: event.clientY };
      // Turning it by hand leaves the snapped face — the reader is back in 3-D
      // and the controls must say so.
      if (face !== 'free' && moved) {
        face = 'free';
        mix = 0;
        tween = null;
        markFace('free');
      }
      redraw();
    });

    const release = () => { dragging = false; lastPointer = null; };
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('pointerleave', () => { if (!dragging) { hover = -1; hideTip(frame.tip); } });
  }

  attachDrag();

  // --- group legend ---------------------------------------------------------

  function buildLegend() {
    if (!frame.legend) return;
    frame.legend.textContent = '';
    state.groups.forEach((group, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!hiddenGroups.has(group)));
      const swatch = document.createElement('span');
      swatch.className = 'vf-swatch';
      swatch.style.background = colors[i % colors.length];
      button.appendChild(swatch);
      button.appendChild(document.createTextNode(group));
      button.addEventListener('click', () => {
        // Never let the reader hide everything — an empty cube is not a view.
        if (!hiddenGroups.has(group) && hiddenGroups.size === state.groups.length - 1) return;
        if (hiddenGroups.has(group)) hiddenGroups.delete(group); else hiddenGroups.add(group);
        button.setAttribute('aria-pressed', String(!hiddenGroups.has(group)));
        redraw();
      });
      item.appendChild(button);
      frame.legend.appendChild(item);
    });
  }

  buildLegend();

  // BUILD ONLY, AND NO REST. The frame is drawn, then the points arrive back
  // to front — an entrance that says "this is a volume" before anything is read
  // out of it. There is deliberately no rest state: an idle auto-rotation would
  // move the marks, and on a position encoding a mark that moves is a value
  // that appears to have changed. Idle motion here would also contradict the
  // one thing that makes 3-D honest at all, which is that the READER controls
  // the viewpoint — the Spin button is theirs to press.
  //
  // Attached from the size callback rather than from draw(), because draw()
  // runs on every frame of a rotation and would otherwise re-prep the piece
  // sixty times a second.
  const motion = createMotion(el, config);
  const cubeBuild = () => motion.attach(frame.svg, { build: 'emerge', dur: 3600 });

  function observe() {
    return observeSize(el, frame.plot, (w, h) => {
      currentSize = [w, h];
      draw(w, h);
      if (!tween && !spinning && !dragging) cubeBuild();
    }, {
      aspect: state.aspect,
      fit: state.fit,
      minHeight: 280,
    });
  }

  teardown = observe();

  return {
    destroy() {
      if (teardown) teardown();
      motion.destroy();
      if (raf !== null) cancelAnimationFrame(raf);
      el.textContent = '';
      el.classList.remove('vf-module', frame.rootClass);
    },
    update(next) {
      if (teardown) teardown();
      if (dataChanged(state.config, next)) motion.replay();
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      state = normalize(next);
      hiddenGroups.clear();
      az = FACES.free.az;
      el_ = FACES.free.el;
      face = 'free';
      mix = 0;
      tween = null;
      spinning = false;
      frame = buildFrame(el, state.config, frameOpts());
      controls = buildControls();
      colors = resolveCategories(el, Math.max(1, state.groups.length));
      buildLegend();
      attachDrag();
      teardown = observe();
    },
    get stats() { return state.stats; },
    redraw,
  };
}

function normalize(config) {
  const { points, domains, groups, stats } = shape(
    config.data || config.rows || [],
    config.bindings || {}
  );

  const notes = [
    // The whole justification for drawing 3-D at all, stated on the piece.
    'orthographic projection, so a dot at the back is drawn at the same scale as one at the front',
    'nearer dots are drawn slightly larger only as a depth cue — size carries no value here',
  ];
  if (stats.skipped) {
    notes.push(`${stats.skipped} of ${stats.sourceRowCount} rows lacked all three measures and were left out`);
  }

  return {
    config,
    points,
    domains,
    groups,
    stats,
    note: notes.join('; '),
    aspect: config.aspect || 0.7,
    fit: config.fit || 'aspect',
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
