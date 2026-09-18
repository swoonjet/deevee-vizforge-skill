// scripts/sizes.mjs
//
// The named sizes, shared by the live-HTML path and the raster path so a
// "square" embed and a "square" PNG are the same composition at two
// resolutions rather than two independent guesses.
//
// SIZES ARE NAMED FOR DESTINATIONS, not for pixel counts. "1200x675" tells a
// user nothing about whether it will fit their slide. The CSS width is what
// sets the type scale — every module sizes itself in `cqw` against its
// container — so the box is chosen for how the piece should READ, and
// deviceScaleFactor 2 then makes the raster crisp. Changing the scale factor
// alone never changes the composition, only the resolution.

export const SIZES = {
  'slide-16x9': {
    width: 1200, height: 675, deviceScaleFactor: 2,
    label: 'Slide, 16:9',
    note: 'Fills a widescreen Keynote, Google Slides or PowerPoint page.',
  },
  'half-slide-4x3': {
    width: 900, height: 675, deviceScaleFactor: 2,
    label: 'Half slide, 4:3',
    note: 'Sits beside a column of text.',
  },
  square: {
    width: 1080, height: 1080, deviceScaleFactor: 2,
    label: 'Square',
    note: 'A social post or a document inset.',
  },
  'story-9x16': {
    width: 1080, height: 1920, deviceScaleFactor: 2,
    label: 'Story, 9:16',
    note: 'Phone-tall. Narrow: a wide form will crowd here — check it, see below.',
  },
  banner: {
    width: 1600, height: 500, deviceScaleFactor: 2,
    label: 'Banner',
    note: 'A page header strip or a wide hero.',
  },
  card: {
    width: 560, height: 420, deviceScaleFactor: 2,
    label: 'Card',
    note: 'A dashboard tile. Under 300px tall the frame goes compact on its own.',
  },
  'email-600': {
    width: 600, height: 480, deviceScaleFactor: 2,
    label: 'Email column',
    note: 'The 600px column every email client agrees on.',
  },
};

export const DEFAULT_SIZE = 'slide-16x9';

/** Widths under this crowd any form that compares many small marks precisely. */
export const TIGHT_WIDTH = 700;

export function resolveSize(name, overrides = {}) {
  const key = name || DEFAULT_SIZE;
  const preset = SIZES[key];
  if (!preset) {
    throw new Error(`unknown size "${key}" — known: ${Object.keys(SIZES).join(', ')}`);
  }
  return {
    size: key,
    width: overrides.width ?? preset.width,
    height: overrides.height ?? preset.height,
    deviceScaleFactor: overrides.deviceScaleFactor ?? preset.deviceScaleFactor,
    label: preset.label,
    note: preset.note,
  };
}

/**
 * Wraps a responsive embed in a page that pins it to an exact box.
 *
 * WHY A WRAPPER RATHER THAN A BUILD FLAG. The embed itself stays responsive —
 * that is the whole promise of a portable module, and a fixed-pixel stage was
 * a mistake this library already made once and had to unwind. So a "sized"
 * artifact is the same responsive embed viewed through a box of known
 * dimensions, which is exactly what the destination imposes anyway.
 */
export function sizedShell(innerHtml, { width, height, label, title }) {
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
  const srcdoc = escape(innerHtml);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title || 'chart')} — ${escape(label)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #6b7280; }
  body { display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
  .box { width: ${width}px; height: ${height}px; max-width: 100%; box-shadow: 0 2px 28px rgba(0,0,0,.28); }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
</style>
</head>
<body>
<div class="box"><iframe title="${escape(title || 'chart')}" srcdoc="${srcdoc}"></iframe></div>
</body>
</html>
`;
}
