// scripts/qa/checks/contrast.check.mjs
//
// Per-piece hybrid text-contrast check (02-RESEARCH.md Pattern 1). Reuses
// contrast-check.mjs's SAME colorjs.io math — never a second contrast-ratio
// implementation (docs/qa-schemas.md, "Don't Hand-Roll").
//
// Two paths:
//   Path A (fast, computed-style): text NOT geometrically over a filled SVG
//   shape/canvas — contrast vs. the nearest non-transparent ancestor
//   background, alpha-composited by the element's cumulative opacity.
//   Path B (slow, pixel-sampled): text that DOES overlap a data mark — a
//   computed-style-only checker would see the flat ancestor background and
//   wrongly PASS it (exactly what axe-core's color-contrast rule silently
//   skips, per 02-RESEARCH.md). Samples the already-captured screenshot
//   buffer (never re-renders) in a thin margin band around the glyph box.
//
// Thresholds: WCAG 2.1 AA is the hard rule (normal text >= 4.5, large text
// >= 3.0); APCA is advisory only (|Lc| < 60 on body-size text => CAUTION,
// never VIOLATION) — locked per 02-CONTEXT.md Claude's Discretion.
//
// Attribution-footer policy (discretion, documented here per plan): the
// .viz-attribution line is deliberately de-emphasized (opacity 0.6) small
// text. Its composited ratio is measured the same way as any other text,
// but its severity bands are looser than the strict AA rule: < 3.0 =>
// VIOLATION, 3.0-4.5 => CAUTION (a consciously-accepted de-emphasis,
// surfaced per the two-tier severity model), >= 4.5 => no issue.

import Color from 'colorjs.io';
import { PNG } from 'pngjs';

export const name = 'contrast';
export const needs = ['page', 'screenshot'];

const NORMAL_MIN = 4.5;
const LARGE_MIN = 3.0;
const APCA_CAUTION_ABS = 60;
const FOOTER_VIOLATION_MIN = 3.0;
const FOOTER_CAUTION_MIN = 4.5;
const MARGIN_CSS_PX = 4;

// getComputedStyle can return oklch()/lab()/color() strings, not just
// rgb() — this project's CSS custom properties are declared in OKLCH
// (scripts/design/tokens.mjs), and Chromium preserves that color space in
// computed style rather than always down-converting to rgb(). Parse via
// colorjs.io (already the project's one contrast-math library) so every CSS
// Color 4 syntax resolves correctly, not just legacy rgb()/rgba().
function parseCssColor(str) {
  if (!str) return null;
  try {
    const c = new Color(str);
    const [r, g, b] = c.to('srgb').coords.map((v) => v * 255);
    return { r, g, b, a: c.alpha ?? 1 };
  } catch {
    return null;
  }
}

function toHex({ r, g, b }) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function compositeOver(fg, bg, alpha) {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

function wcag21(hexA, hexB) {
  return new Color(hexA).contrastWCAG21(new Color(hexB));
}

function apca(hexA, hexB) {
  return new Color(hexA).contrastAPCA(new Color(hexB));
}

/**
 * Averages the pixels in a thin margin BAND around (not inside) a CSS-space
 * rect, scaled to device pixels. Used for the pixel-sampled slow path — the
 * band avoids sampling the glyph's own anti-aliased pixels, sampling only
 * what surrounds it (the mark it's drawn over).
 */
function sampleMarginBand(png, cssRect, deviceScaleFactor, marginCssPx = MARGIN_CSS_PX) {
  const scale = deviceScaleFactor;
  const innerX0 = cssRect.left * scale;
  const innerX1 = cssRect.right * scale;
  const innerY0 = cssRect.top * scale;
  const innerY1 = cssRect.bottom * scale;

  const outerX0 = Math.max(0, Math.floor(innerX0 - marginCssPx * scale));
  const outerX1 = Math.min(png.width - 1, Math.ceil(innerX1 + marginCssPx * scale));
  const outerY0 = Math.max(0, Math.floor(innerY0 - marginCssPx * scale));
  const outerY1 = Math.min(png.height - 1, Math.ceil(innerY1 + marginCssPx * scale));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = outerY0; y <= outerY1; y++) {
    for (let x = outerX0; x <= outerX1; x++) {
      const inInner = x >= innerX0 && x <= innerX1 && y >= innerY0 && y <= innerY1;
      if (inInner) continue; // skip the glyph's own footprint — band only
      const idx = (png.width * y + x) << 2;
      sumR += png.data[idx];
      sumG += png.data[idx + 1];
      sumB += png.data[idx + 2];
      count++;
    }
  }

  if (count === 0) {
    // Degenerate (glyph fills the whole sampling window) — fall back to the
    // inner box itself rather than returning nothing.
    for (let y = Math.floor(innerY0); y <= Math.ceil(innerY1); y++) {
      for (let x = Math.floor(innerX0); x <= Math.ceil(innerX1); x++) {
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const idx = (png.width * y + x) << 2;
        sumR += png.data[idx];
        sumG += png.data[idx + 1];
        sumB += png.data[idx + 2];
        count++;
      }
    }
  }

  if (count === 0) return { r: 255, g: 255, b: 255 };
  return { r: sumR / count, g: sumG / count, b: sumB / count };
}

async function collectTextElements(page) {
  return page.evaluate(() => {
    function cumulativeOpacity(el) {
      let opacity = 1;
      let node = el;
      while (node) {
        const cs = window.getComputedStyle(node);
        const o = parseFloat(cs.opacity);
        if (!Number.isNaN(o)) opacity *= o;
        node = node.parentElement;
      }
      return opacity;
    }

    function nearestBackground(el) {
      let node = el.parentElement;
      while (node) {
        const cs = window.getComputedStyle(node);
        const bg = cs.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    }

    function isMarkElement(el) {
      const tag = el.tagName.toLowerCase();
      return tag !== 'text' && tag !== 'tspan';
    }

    function overlapsAMark(rect) {
      const marks = [...document.querySelectorAll('svg [fill]:not([fill="none"]), canvas')].filter(isMarkElement);
      return marks.some((m) => {
        const mr = m.getBoundingClientRect();
        return !(rect.right < mr.left || rect.left > mr.right || rect.bottom < mr.top || rect.top > mr.bottom);
      });
    }

    const candidates = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent.trim().length > 0 && node.parentElement) {
        candidates.add(node.parentElement);
      }
      node = walker.nextNode();
    }

    const results = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const isSvgText = el.namespaceURI === 'http://www.w3.org/2000/svg';
      const cs = window.getComputedStyle(el);
      const colorStr = isSvgText ? cs.fill : cs.color;
      const fontSize = parseFloat(cs.fontSize);
      const fontWeight = parseInt(cs.fontWeight, 10) || 400;
      const opacity = cumulativeOpacity(el);
      const background = isSvgText ? nearestBackground(el.closest('svg') || el) : nearestBackground(el);
      const isAttributionFooter = !!el.closest('.viz-attribution');
      const overlapsMark = overlapsAMark(rect);

      results.push({
        text: el.textContent.trim().slice(0, 60),
        tag: el.tagName.toLowerCase(),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        colorStr,
        fontSize,
        fontWeight,
        opacity,
        background,
        isAttributionFooter,
        overlapsMark,
      });
    }
    return results;
  });
}

export async function run(ctx) {
  const { page, screenshot } = ctx;
  const deviceScaleFactor = ctx.deviceScaleFactor ?? 2;

  const elements = await collectTextElements(page);
  const png = PNG.sync.read(screenshot);

  const findings = [];
  let worst = 'PASS';
  let anyChecked = 0;

  for (const el of elements) {
    const fgRgb = parseCssColor(el.colorStr);
    if (!fgRgb) continue;

    const totalAlpha = (fgRgb.a ?? 1) * el.opacity;

    // Effectively-invisible text (cumulative opacity ~0) contributes nothing
    // to the rendered frame — animated pieces commonly hold a hidden
    // duplicate of a label mid-crossfade (e.g. a "travel-readout" copy at
    // opacity:0 alongside a "final-label" copy at opacity:1 for the same
    // text). Compositing zero-alpha foreground over its background is
    // mathematically background-over-background (ratio 1.0), which would
    // otherwise read as a false contrast VIOLATION for text nobody sees.
    if (totalAlpha < 0.02) continue;

    anyChecked++;
    const isLarge = el.fontSize >= 24 || (el.fontSize >= 18.66 && el.fontWeight >= 700);

    let bgRgb;
    let path;
    if (el.overlapsMark) {
      path = 'pixel-sampled';
      bgRgb = sampleMarginBand(png, el.rect, deviceScaleFactor);
    } else {
      path = 'computed-style';
      bgRgb = parseCssColor(el.background) ?? { r: 255, g: 255, b: 255 };
    }

    const effectiveFg = compositeOver(fgRgb, bgRgb, totalAlpha);
    const fgHex = toHex(effectiveFg);
    const bgHex = toHex(bgRgb);

    const ratio = wcag21(fgHex, bgHex);
    const apcaVal = apca(fgHex, bgHex);

    const label = `"${el.text}" (${el.tag}${el.isAttributionFooter ? ', attribution-footer' : ''})`;

    if (el.isAttributionFooter) {
      if (ratio < FOOTER_VIOLATION_MIN) {
        findings.push(
          `VIOLATION ${label}: ratio ${ratio.toFixed(2)} < ${FOOTER_VIOLATION_MIN} (fg ${fgHex} / bg ${bgHex}, ${path})`
        );
        worst = 'VIOLATION';
      } else if (ratio < FOOTER_CAUTION_MIN) {
        findings.push(
          `CAUTION ${label}: attribution-footer de-emphasis ratio ${ratio.toFixed(2)} (fg ${fgHex} / bg ${bgHex}, ${path})`
        );
        if (worst !== 'VIOLATION') worst = 'CAUTION';
      }
      continue;
    }

    const minRatio = isLarge ? LARGE_MIN : NORMAL_MIN;
    if (ratio < minRatio) {
      findings.push(
        `VIOLATION ${label}: ratio ${ratio.toFixed(2)} < ${minRatio} (fg ${fgHex} / bg ${bgHex}, ${path}${
          path === 'pixel-sampled' ? ', pixel-sampled background' : ''
        })`
      );
      worst = 'VIOLATION';
      continue;
    }

    if (Math.abs(apcaVal) < APCA_CAUTION_ABS && !isLarge) {
      findings.push(
        `CAUTION ${label}: APCA |Lc| ${Math.abs(apcaVal).toFixed(1)} < ${APCA_CAUTION_ABS} (advisory; WCAG 2.1 ${ratio.toFixed(2)} passes) (fg ${fgHex} / bg ${bgHex}, ${path})`
      );
      if (worst !== 'VIOLATION') worst = 'CAUTION';
    }
  }

  if (findings.length === 0) {
    return {
      name,
      severity: 'PASS',
      evidence: `${anyChecked} text element(s) checked, all clear WCAG 2.1 AA (normal >= ${NORMAL_MIN}, large >= ${LARGE_MIN})`,
    };
  }

  return { name, severity: worst, evidence: findings.join(' | ') };
}
