// scripts/qa/checks/palette.check.mjs
//
// Palette conformance check (02-RESEARCH.md Pattern 2): frequency-histogram
// over the already-captured screenshot, matched to assets/ramps.json tokens
// (+ paper-blend variants, covering opacity-composited grid lines/de-emphasized
// text) by OKLCH distance, plus CVD simulation of the tokens actually used.
//
// Deliberately NOT a photographic quantizer (node-vibrant/colorthief/quantize)
// — VizForge's rendered output is flat vector/canvas fills from a small fixed
// token set, so exact-frequency + distance-to-known-tokens is the correct
// tool, per 02-RESEARCH.md's "Don't Hand-Roll" analysis.
//
// Runs on ONE representative frame only (static export or poster/final-hold
// frame for animated pieces) — never per-frame (02-RESEARCH.md Pitfall 3).

import { PNG } from 'pngjs';
import { differenceEuclidean } from 'culori';
import { simulate } from '@bjornlu/colorblind';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'palette';
export const needs = ['screenshot', 'meta'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

const deltaEOK = differenceEuclidean('oklab');

// Tuned empirically per 02-CONTEXT.md's locked tuning order: both proof
// pieces produce zero violations FIRST, then bad-off-palette must still
// fail. See 02-02-SUMMARY.md for the measured distances that set these.
const EPSILON = 0.02;
const AREA_THRESHOLD = 0.001; // 0.1% of frame area — drop AA-edge-blend buckets
const CVD_THRESHOLD = 30; // same pairwise RGB-distance rule as contrast-check.mjs

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

async function loadRamps() {
  const raw = await readFile(path.join(repoRoot, 'assets/ramps.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * Builds the approved-color set: every house token (paper/ink/emphasis/
 * categorical/sequential/diverging) PLUS, for every non-paper token T, the
 * sRGB mix(T, paper, t) for t in 0.05..0.95 step 0.05 — legitimate rendered
 * colors from opacity-composited grid lines, halos, and de-emphasized text
 * that a strict token-only match would wrongly flag.
 *
 * When `ramps.ambientDark` is present (Tier-3 "ambient-sculpture" family
 * SCOPED dark variant, 04-03-PLAN.md — NOT a general dark mode), its
 * paper/ink/diverging tokens are ALSO added, and every non-paper token
 * (light AND dark sets) is additionally blended against the DARK paper —
 * an ambient-family piece composites de-emphasized elements (e.g. the
 * shared attribution-footer's opacity:0.6) against its own dark ground,
 * which the light-paper-only blend set would otherwise flag as off-palette.
 *
 * When `ramps.expressive` is present (EXPR-01, Phase 15 — the scoped
 * `expressive` family generated from house tokens, 15-01-PLAN.md), its
 * `multiply` composite hex is ALSO added — the one genuinely-new color the
 * riso two-ink-overlap texture primitive (assets/snippets/textures.js's
 * risoInkLayers()) can render. Exported (not just used internally) so
 * scripts/tests/smoke/expressive-palette.test.mjs can assert the family is
 * recognized directly, without a full screenshot round-trip.
 */
export function buildApprovedTokens(ramps) {
  const base = [];
  const add = (hex, label, family) => base.push({ hex, label, family, baseHex: hex });

  add(ramps.paper, 'paper', 'paper');
  add(ramps.ink, 'ink', 'ink');
  add(ramps.emphasis, 'emphasis', 'emphasis');
  (ramps.categorical || []).forEach((hex, i) =>
    add(hex, `categorical:${ramps.categoricalNames?.[i] ?? i}`, 'categorical')
  );
  (ramps.sequential || []).forEach((hex, i) => add(hex, `sequential:${i}`, 'sequential'));
  (ramps.diverging || []).forEach((hex, i) => add(hex, `diverging:${i}`, 'diverging'));

  if (ramps.ambientDark) {
    add(ramps.ambientDark.paper, 'paper-dark', 'paper-dark');
    add(ramps.ambientDark.ink, 'ink-dark', 'ink-dark');
    (ramps.ambientDark.diverging || []).forEach((hex, i) => add(hex, `diverging-dark:${i}`, 'diverging-dark'));
  }

  if (ramps.expressive) {
    add(ramps.expressive.multiply, 'expressive:multiply', 'expressive');
  }

  const paperBases = [{ hex: ramps.paper, label: 'paper' }];
  if (ramps.ambientDark) paperBases.push({ hex: ramps.ambientDark.paper, label: 'paper-dark' });

  const blended = [];
  for (const token of base) {
    if (token.family === 'paper' || token.family === 'paper-dark') continue;
    const rgb = hexToRgb(token.hex);
    for (const paperBase of paperBases) {
      const paperRgb = hexToRgb(paperBase.hex);
      for (let step = 1; step <= 19; step++) {
        const t = step * 0.05;
        const mixed = {
          r: rgb.r * (1 - t) + paperRgb.r * t,
          g: rgb.g * (1 - t) + paperRgb.g * t,
          b: rgb.b * (1 - t) + paperRgb.b * t,
        };
        blended.push({
          hex: rgbToHex(mixed),
          label: `${token.label}@${paperBase.label}-blend-${Math.round(t * 100)}%`,
          family: token.family,
          baseHex: token.hex,
        });
      }
    }
  }

  return [...base, ...blended];
}

function nearestToken(hex, tokens) {
  let best = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const d = deltaEOK(hex, token.hex);
    if (d < bestDist) {
      bestDist = d;
      best = token;
    }
  }
  return { token: best, distance: bestDist };
}

function histogram(png) {
  const { width, height, data } = png;
  const freq = new Map();
  const total = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.round(data[i] / 4) * 4;
    const g = Math.round(data[i + 1] / 4) * 4;
    const b = Math.round(data[i + 2] / 4) * 4;
    const key = `${r},${g},${b}`;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return { freq, total };
}

export async function run(ctx) {
  const ramps = await loadRamps();
  const approvedTokens = buildApprovedTokens(ramps);

  const png = PNG.sync.read(ctx.screenshot);
  const { freq, total } = histogram(png);

  const matched = [];
  const caution = [];
  const violation = [];

  for (const [key, count] of freq) {
    const share = count / total;
    if (share < AREA_THRESHOLD) continue; // AA-edge-blend noise

    const [r, g, b] = key.split(',').map(Number);
    const hex = rgbToHex({ r, g, b });
    const { token, distance } = nearestToken(hex, approvedTokens);

    if (distance <= EPSILON) {
      matched.push({ hex, share, token, distance });
    } else if (distance <= EPSILON * 2) {
      caution.push({ hex, share, token, distance });
    } else {
      violation.push({ hex, share, token, distance });
    }
  }

  // CVD: distinct HOUSE (non-blended) categorical/emphasis tokens actually
  // matched, on their true base hex (not a paper-blended variant).
  const usedHouseTokens = new Map();
  for (const m of matched) {
    if (m.token.family === 'categorical' || m.token.family === 'emphasis') {
      usedHouseTokens.set(m.token.label.split('@')[0], m.token.baseHex);
    }
  }

  const cvdFindings = [];
  if (usedHouseTokens.size >= 2) {
    const names = [...usedHouseTokens.keys()];
    for (const deficiency of ['protanopia', 'deuteranopia', 'tritanopia']) {
      const simulated = new Map(
        names.map((n) => [n, simulate(hexToRgb(usedHouseTokens.get(n)), deficiency)])
      );
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const dist = rgbDistance(simulated.get(names[i]), simulated.get(names[j]));
          if (dist < CVD_THRESHOLD) {
            cvdFindings.push(
              `CVD violation: "${names[i]}" and "${names[j]}" indistinguishable under ${deficiency} (simulated RGB distance ${dist.toFixed(1)} < ${CVD_THRESHOLD})`
            );
          }
        }
      }
    }
  }

  // Cautions must always be listed alongside a violation, never silently
  // dropped (locked two-tier severity model, docs/qa-schemas.md) — build
  // both message sets up front and combine them under whichever severity wins.
  const violationMsgs = violation.map(
    (v) =>
      `off-palette color ${v.hex} covers ${(v.share * 100).toFixed(2)}% of frame (nearest token ${v.token.label} at distance ${v.distance.toFixed(3)}, threshold ${(EPSILON * 2).toFixed(3)})`
  );
  const cautionMsgs = caution.map(
    (c) =>
      `near-token drift ${c.hex} covers ${(c.share * 100).toFixed(2)}% of frame (nearest token ${c.token.label} at distance ${c.distance.toFixed(3)}, matched threshold ${EPSILON.toFixed(3)})`
  );

  if (violation.length > 0 || cvdFindings.length > 0) {
    return {
      name,
      severity: 'VIOLATION',
      evidence: [...violationMsgs, ...cvdFindings, ...cautionMsgs].join(' | '),
    };
  }

  if (caution.length > 0) {
    return { name, severity: 'CAUTION', evidence: cautionMsgs.join(' | ') };
  }

  const matchedSummary = matched
    .sort((a, b) => b.share - a.share)
    .map((m) => `${m.token.label} (${(m.share * 100).toFixed(1)}%)`)
    .join(', ');

  return {
    name,
    severity: 'PASS',
    evidence: `matched tokens: ${matchedSummary || 'none surviving area threshold'}${
      usedHouseTokens.size >= 2 ? ` — CVD clear across ${usedHouseTokens.size} categorical/emphasis tokens` : ''
    }`,
  };
}
