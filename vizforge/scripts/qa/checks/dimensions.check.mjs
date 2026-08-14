// scripts/qa/checks/dimensions.check.mjs
//
// 2x export-dimension correctness check (CRAFT-04): the captured screenshot's
// pixel size must equal the piece's declared CSS dimensions times its device
// scale factor exactly. Expected size resolves from meta.framePreset (via
// assets/frame-presets.json) for real pieces, or meta.dimensions.css * 2 for
// the framePreset: null fixture allowance (docs/qa-schemas.md).

import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dimensions';
export const needs = ['screenshot', 'meta'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

async function loadPresets() {
  const raw = await readFile(path.join(repoRoot, 'assets/frame-presets.json'), 'utf8');
  return JSON.parse(raw);
}

export async function run(ctx) {
  const meta = ctx.meta ?? {};

  let expectedWidth;
  let expectedHeight;

  if (meta.framePreset) {
    const presets = await loadPresets();
    const preset = presets[meta.framePreset];
    if (!preset) {
      return {
        name,
        severity: 'VIOLATION',
        evidence: `meta.framePreset "${meta.framePreset}" not found in assets/frame-presets.json`,
      };
    }
    expectedWidth = preset.width * preset.deviceScaleFactor;
    expectedHeight = preset.height * preset.deviceScaleFactor;
  } else if (meta.dimensions?.css) {
    const [cssWidth, cssHeight] = meta.dimensions.css;
    const dsf = ctx.deviceScaleFactor ?? 2;
    expectedWidth = cssWidth * dsf;
    expectedHeight = cssHeight * dsf;
  } else {
    return {
      name,
      severity: 'VIOLATION',
      evidence: 'meta.json has neither framePreset nor dimensions.css — cannot resolve expected export size',
    };
  }

  const png = PNG.sync.read(ctx.screenshot);

  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    return {
      name,
      severity: 'VIOLATION',
      evidence: `expected ${expectedWidth}x${expectedHeight}, got ${png.width}x${png.height}`,
    };
  }

  return { name, severity: 'PASS', evidence: `${png.width}x${png.height} matches expected 2x export size` };
}
