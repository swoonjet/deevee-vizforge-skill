// scripts/qa/contrast-check.mjs
//
// CRAFT-02 spot-check: verifies the color tokens in scripts/design/tokens.mjs
// pass WCAG 2.1 + APCA contrast and CVD-distinguishability before they ship.
// Imports the SAME values it validates (no drift between this check and the
// generated tokens.css/ramps.json — both come from the one tokens.mjs
// source of truth).
//
// Run: node scripts/qa/contrast-check.mjs
// Exits nonzero with named failures if any check fails.

import Color from 'colorjs.io';
import { simulate } from '@bjornlu/colorblind';
import {
  color,
  categoricalOrder,
  sequentialRamp,
  divergingRamp,
  toOklch,
  ambientDarkColor,
  ambientDarkDivergingRamp,
} from '../design/tokens.mjs';

const failures = [];

function check(label, condition, detail) {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`${status}: ${label}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures.push(label);
}

function hexToRgb255(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function wcag21(hexA, hexB) {
  return new Color(hexA).contrastWCAG21(new Color(hexB));
}

function apca(hexA, hexB) {
  return new Color(hexA).contrastAPCA(new Color(hexB));
}

console.log('--- Contrast + CVD checks (scripts/design/tokens.mjs) ---\n');

// 1. ink vs paper: WCAG21 >= 7.0 (AAA body text), |APCA| >= 75
{
  const wcag = wcag21(color.ink.hex, color.paper.hex);
  const apcaVal = apca(color.ink.hex, color.paper.hex);
  check('ink vs paper WCAG 2.1 >= 7.0', wcag >= 7.0, `${wcag.toFixed(2)}`);
  check('ink vs paper |APCA| >= 75', Math.abs(apcaVal) >= 75, `${apcaVal.toFixed(1)}`);
}

// 2. emphasis vs paper: WCAG21 >= 4.5
{
  const wcag = wcag21(color.emphasis.hex, color.paper.hex);
  check('emphasis vs paper WCAG 2.1 >= 4.5', wcag >= 4.5, `${wcag.toFixed(2)}`);
}

// 3. every categorical color vs paper: WCAG21 >= 3.0
for (const name of categoricalOrder) {
  const hex = color.categorical[name].hex;
  const wcag = wcag21(hex, color.paper.hex);
  check(`categorical "${name}" vs paper WCAG 2.1 >= 3.0`, wcag >= 3.0, `${wcag.toFixed(2)} (${hex})`);
}

// 4. CVD distinguishability: for each deficiency, every categorical pair's
// simulated RGB Euclidean distance must be >= 30 (of 441 max).
const CVD_THRESHOLD = 30;
for (const deficiency of ['protanopia', 'deuteranopia', 'tritanopia']) {
  const simulated = {};
  for (const name of categoricalOrder) {
    simulated[name] = simulate(hexToRgb255(color.categorical[name].hex), deficiency);
  }

  let minDist = Infinity;
  let minPair = null;
  for (let i = 0; i < categoricalOrder.length; i++) {
    for (let j = i + 1; j < categoricalOrder.length; j++) {
      const nameA = categoricalOrder[i];
      const nameB = categoricalOrder[j];
      const dist = rgbDistance(simulated[nameA], simulated[nameB]);
      if (dist < minDist) {
        minDist = dist;
        minPair = [nameA, nameB];
      }
    }
  }

  check(
    `CVD distinguishability under ${deficiency} (min pair >= ${CVD_THRESHOLD})`,
    minDist >= CVD_THRESHOLD,
    `min ${minDist.toFixed(1)} between ${minPair?.join('/')}`
  );
}

// 5. Sequential ramp: OKLCH lightness strictly monotonic (light -> dark).
{
  const Ls = sequentialRamp.map((hex) => toOklch(hex).l);
  let strictlyDecreasing = true;
  for (let i = 1; i < Ls.length; i++) {
    if (Ls[i] >= Ls[i - 1]) strictlyDecreasing = false;
  }
  check(
    'sequential ramp lightness strictly monotonic',
    strictlyDecreasing,
    Ls.map((l) => l.toFixed(3)).join(' > ')
  );
}

// 6. Diverging ramp: near-paper midpoint + symmetric-ish lightness trend.
{
  const n = divergingRamp.length;
  const midIndex = Math.floor(n / 2);
  const midOklch = toOklch(divergingRamp[midIndex]);
  const paperOklch = toOklch(color.paper.hex);
  const deltaL = Math.abs(midOklch.l - paperOklch.l);
  const deltaC = Math.abs(midOklch.c - paperOklch.c);

  check(
    'diverging ramp midpoint is near-paper',
    deltaL < 0.05 && deltaC < 0.03,
    `deltaL=${deltaL.toFixed(3)} deltaC=${deltaC.toFixed(3)}`
  );

  const Ls = divergingRamp.map((hex) => toOklch(hex).l);
  const firstHalf = Ls.slice(0, midIndex + 1);
  const secondHalf = Ls.slice(midIndex);

  const isMonotonicIncreasing = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1]);
  const isMonotonicDecreasing = (arr) => arr.every((v, i) => i === 0 || v <= arr[i - 1]);

  const firstHalfOk = isMonotonicIncreasing(firstHalf);
  const secondHalfOk = isMonotonicDecreasing(secondHalf);

  check(
    'diverging ramp is symmetric-ish (lightness rises to midpoint, falls after)',
    firstHalfOk && secondHalfOk,
    Ls.map((l) => l.toFixed(3)).join(' ')
  );
}

// 7. Ambient-dark scoped variant (Tier-3 "ambient-sculpture" family ONLY —
// 04-03-PLAN.md, NOT a general dark mode). Same standards as the light set.
{
  const wcag = wcag21(ambientDarkColor.ink.hex, ambientDarkColor.paper.hex);
  const apcaVal = apca(ambientDarkColor.ink.hex, ambientDarkColor.paper.hex);
  check('ambientDark ink vs paper WCAG 2.1 >= 7.0', wcag >= 7.0, `${wcag.toFixed(2)}`);
  check('ambientDark ink vs paper |APCA| >= 75', Math.abs(apcaVal) >= 75, `${apcaVal.toFixed(1)}`);
}

// 8. Ambient-dark diverging ramp poles (index 0 = southward/warm, last =
// northward/cool — the two colors actually used as marks) vs. the dark
// paper: WCAG21 >= 3.0, matching the light categorical-vs-paper floor.
{
  const firstHex = ambientDarkDivergingRamp[0];
  const lastHex = ambientDarkDivergingRamp[ambientDarkDivergingRamp.length - 1];
  const wcagFirst = wcag21(firstHex, ambientDarkColor.paper.hex);
  const wcagLast = wcag21(lastHex, ambientDarkColor.paper.hex);
  check('ambientDark diverging warm pole vs paper WCAG 2.1 >= 3.0', wcagFirst >= 3.0, `${wcagFirst.toFixed(2)} (${firstHex})`);
  check('ambientDark diverging cool pole vs paper WCAG 2.1 >= 3.0', wcagLast >= 3.0, `${wcagLast.toFixed(2)} (${lastHex})`);
}

// 9. Ambient-dark diverging ramp midpoint is near its own dark paper (same
// symmetric-construction sanity as the light diverging ramp's check 6).
{
  const n = ambientDarkDivergingRamp.length;
  const midIndex = Math.floor(n / 2);
  const midOklch = toOklch(ambientDarkDivergingRamp[midIndex]);
  const paperOklch = toOklch(ambientDarkColor.paper.hex);
  const deltaL = Math.abs(midOklch.l - paperOklch.l);
  const deltaC = Math.abs(midOklch.c - paperOklch.c);
  check(
    'ambientDark diverging ramp midpoint is near its own dark paper',
    deltaL < 0.05 && deltaC < 0.03,
    `deltaL=${deltaL.toFixed(3)} deltaC=${deltaC.toFixed(3)}`
  );
}

console.log('');

if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('All contrast + CVD checks passed.');
