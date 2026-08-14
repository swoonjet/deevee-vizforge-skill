// scripts/qa/tnum-check.mjs
//
// Verifies the subsetted woff2 fonts did not silently lose the OpenType
// `tnum` (tabular numerals) GSUB feature — the classic font-subsetting
// pitfall where digit-alignment features get stripped because the
// subsetter's naive glyph closure doesn't realize `tnum` will be invoked
// later by `font-variant-numeric: tabular-nums` in CSS.
//
// Loads fonts-inline.css into a headless page, renders "1111" and "9999"
// with tabular-nums in Inter 400 and IBM Plex Mono 400, and asserts equal
// widths (within 0.5px) per family after `document.fonts.ready`.
//
// Run: node scripts/qa/tnum-check.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

import { DETERMINISM_LAUNCH_ARGS } from '../lib/browser-launch-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const FAMILIES_TO_CHECK = [
  { family: 'Inter', weight: 400 },
  { family: 'IBM Plex Mono', weight: 400 },
];

const TOLERANCE_PX = 0.5;

async function main() {
  const fontsCss = await readFile(path.join(repoRoot, 'assets/fonts/fonts-inline.css'), 'utf8');

  const spans = FAMILIES_TO_CHECK.map(
    ({ family, weight }, i) => `
      <div class="row">
        <span id="a${i}" style="font-family: '${family}'; font-weight: ${weight};">1111</span>
        <span id="b${i}" style="font-family: '${family}'; font-weight: ${weight};">9999</span>
      </div>`
  ).join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${fontsCss}
.row span {
  font-size: 32px;
  font-variant-numeric: tabular-nums;
  white-space: pre;
}
</style>
</head>
<body>
${spans}
</body>
</html>`;

  const browser = await chromium.launch({ args: DETERMINISM_LAUNCH_ARGS });
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);

  const failures = [];

  for (let i = 0; i < FAMILIES_TO_CHECK.length; i++) {
    const { family, weight } = FAMILIES_TO_CHECK[i];
    const widthA = await page.locator(`#a${i}`).evaluate((el) => el.getBoundingClientRect().width);
    const widthB = await page.locator(`#b${i}`).evaluate((el) => el.getBoundingClientRect().width);
    const delta = Math.abs(widthA - widthB);

    const status = delta <= TOLERANCE_PX ? 'PASS' : 'FAIL';
    console.log(
      `${status}: ${family} ${weight} — "1111"=${widthA.toFixed(2)}px "9999"=${widthB.toFixed(2)}px (delta ${delta.toFixed(3)}px)`
    );

    if (delta > TOLERANCE_PX) {
      failures.push(`${family} ${weight}: tabular numerals misaligned by ${delta.toFixed(3)}px`);
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.error('\nTabular numeral check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('\nAll tabular numeral checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
