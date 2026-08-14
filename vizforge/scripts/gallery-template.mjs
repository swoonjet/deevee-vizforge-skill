#!/usr/bin/env node
// scripts/gallery-template.mjs
//
// GALL-02 house-style showcase renderer (05-02-PLAN.md). Exports a PURE
// function, renderGalleryIndex(data, { tokensCss, fontsCss }), that turns
// the Plan 01 provenance data model (gallery/gallery-data.json's shape,
// documented in docs/gallery.md) into a self-contained gallery/index.html
// string. Every card's provenance (technique, tier, dataset id/source/url,
// kind) is read verbatim from the record — never hand-typed — so the
// smoke test (gallery-provenance.test.mjs) can prove zero drift against
// each piece's own meta.json.
//
// Design (05-CONTEXT.md "The index page"):
// - Paper canvas + house type (Space Grotesk / Inter / IBM Plex Mono),
//   editorial 3-col/1-col responsive card grid.
// - ALWAYS renders all three tier sections (Tier 1/2/3), even if a given
//   dataset has zero pieces in a tier — the page always tells the
//   three-tier range story, and this also keeps a single-piece --only
//   render (used by the fast self-test / --data-only verify path)
//   structurally identical to the full 16-piece render.
// - Static cards show the 2x poster; animated cards show the poster plus a
//   no-autoplay "animated — open / MP4" affordance. No <video>, no
//   autoplay anywhere in the shell.
// - Craft law applies to the shell too (docs/craft-law.md): no decorative
//   rule lines/dividers, no gradient scrims, no neon/glow, no box-shadow.
//   Separation is by space, weight, and alignment only.
// - Zero external network resources except each card's one allowed
//   external href: the dataset source citation link (dataset.url).

const TIERS = [
  { tier: 1, label: 'Tier 1 — Conventional' },
  { tier: 2, label: 'Tier 2 — Unconventional' },
  { tier: 3, label: 'Tier 3 — Experimental' },
];

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// One provenance card. technique/tier/dataset/kind/assets are copied
// straight from the record — this function never invents or retypes a
// provenance value.
function renderCard(piece) {
  const { slug, tier, technique, kind, dataset, pieceHref, assets, register } = piece;
  const kindLabel = kind === 'animated' ? 'Animated' : 'Static';
  // Phase 18 (EXPR-08): a plain text register label, space/weight only — no
  // rule lines/dividers/pills/box-shadow (craft law + Jon's standing
  // no-decorative-lines rule). House pieces (register absent or 'house')
  // render exactly as before.
  const registerLabel = register === 'expressive' ? `<span class="piece-card__register-label">Expressive register</span>` : '';

  const animatedAffordance =
    kind === 'animated'
      ? `
          <div class="piece-card__animated">
            <a class="piece-card__animated-link" href="${escapeAttr(assets.mp4)}">Animated — open to view (MP4)</a>${
              assets.gif ? ` <a class="piece-card__gif-link" href="${escapeAttr(assets.gif)}">GIF</a>` : ''
            }
          </div>`
      : '';

  return `
      <article class="piece-card" data-slug="${escapeAttr(slug)}" data-kind="${escapeAttr(kind)}">
        <a class="piece-card__thumb" href="${escapeAttr(pieceHref)}">
          <img class="piece-card__poster" src="${escapeAttr(assets.poster)}" alt="${escapeAttr(technique)} — ${escapeAttr(
    dataset.id
  )}" loading="lazy">
          <span class="piece-card__kind-tag">${kindLabel}</span>
        </a>
        <div class="piece-card__body">
          <div class="piece-card__meta-row">
            <span class="piece-card__tier-badge">Tier ${tier}</span>
            <span class="piece-card__technique">${technique}</span>${registerLabel}
          </div>
          <p class="piece-card__provenance">
            <span class="piece-card__dataset-id">${dataset.id}</span><br>
            Source: <a class="piece-card__source-link" href="${escapeAttr(
              dataset.url
            )}" target="_blank" rel="noopener noreferrer">${dataset.source}</a>
          </p>${animatedAffordance}
          <a class="piece-card__open-link" href="${escapeAttr(pieceHref)}">Open piece &rarr;</a>
        </div>
      </article>`;
}

function renderTierSection({ tier, label }, piecesInTier) {
  const cards = piecesInTier.map(renderCard).join('\n');
  return `
    <section class="tier-section" data-tier="${tier}">
      <h2 class="tier-section__heading">${label}</h2>
      <div class="card-grid">${cards}</div>
    </section>`;
}

const SHELL_CSS = `
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-label), sans-serif;
}

.gallery-header {
  max-width: 68rem;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-6);
}

.gallery-header__title {
  font-family: var(--font-headline), sans-serif;
  font-weight: var(--weight-headline);
  font-size: clamp(2.5rem, 5vw, 4rem);
  letter-spacing: var(--letter-headline);
  margin: 0 0 var(--space-3);
}

.gallery-header__dek {
  font-size: var(--size-dek);
  line-height: var(--line-dek);
  max-width: 42rem;
  margin: 0;
}

.gallery-main {
  max-width: 84rem;
  margin: 0 auto;
  padding: 0 var(--space-6) var(--space-8);
}

.tier-section {
  padding-top: var(--space-8);
}

.tier-section__heading {
  font-family: var(--font-headline), sans-serif;
  font-weight: var(--weight-headline);
  font-size: 1.5rem;
  margin: 0 0 var(--space-4);
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
}

@media (max-width: 900px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 600px) {
  .card-grid { grid-template-columns: 1fr; }
  .gallery-header { padding: var(--space-6) var(--space-4); }
  .gallery-main { padding: 0 var(--space-4) var(--space-6); }
}

.piece-card {
  display: flex;
  flex-direction: column;
}

.piece-card__thumb {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--seq-1);
}

.piece-card__poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.piece-card__kind-tag {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  font-family: var(--font-figures), monospace;
  font-size: var(--size-annotation);
  background: var(--color-paper);
  color: var(--color-ink);
  padding: 0.15rem 0.5rem;
}

.piece-card__body {
  padding: var(--space-3) 0 0;
}

.piece-card__meta-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.piece-card__tier-badge {
  font-family: var(--font-figures), monospace;
  font-size: var(--size-annotation);
  font-weight: 600;
  color: var(--color-emphasis);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.piece-card__technique {
  font-family: var(--font-headline), sans-serif;
  font-weight: var(--weight-headline);
  font-size: 1.05rem;
  text-transform: capitalize;
}

.piece-card__register-label {
  font-family: var(--font-figures), monospace;
  font-size: var(--size-annotation);
  font-style: italic;
  color: var(--color-ink);
}

.piece-card__provenance {
  font-family: var(--font-figures), monospace;
  font-size: var(--size-figures);
  line-height: var(--line-figures);
  margin: 0 0 var(--space-2);
}

.piece-card__source-link,
.piece-card__open-link,
.piece-card__animated-link,
.piece-card__gif-link {
  color: var(--color-ink);
}

.piece-card__animated {
  font-family: var(--font-label), sans-serif;
  font-size: var(--size-annotation);
  margin-bottom: var(--space-2);
}

.piece-card__open-link {
  display: inline-block;
  font-family: var(--font-label), sans-serif;
  font-weight: 600;
  font-size: var(--size-axis);
}

.gallery-footer {
  max-width: 68rem;
  margin: 0 auto;
  padding: var(--space-6);
  font-family: var(--font-figures), monospace;
  font-size: var(--size-source);
  color: var(--color-ink);
}
`;

/**
 * renderGalleryIndex(data, { tokensCss, fontsCss }) -> HTML string.
 *
 * data: the gallery-data.json object ({ pieces: [...], dropped: [...] }).
 * tokensCss/fontsCss: raw file contents of assets/tokens.css and
 * assets/fonts/fonts-inline.css, inlined verbatim so the page opens
 * offline via file:// with zero font/token network requests.
 *
 * PURE — no Date.now(), no randomness, no filesystem access. Calling this
 * twice with the same arguments produces byte-identical output.
 */
export function renderGalleryIndex(data, { tokensCss = '', fontsCss = '' } = {}) {
  const pieces = data?.pieces ?? [];

  const tierSections = TIERS.map(({ tier, label }) =>
    renderTierSection({ tier, label }, pieces.filter((p) => p.tier === tier))
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VizForge — Showcase Gallery</title>
<style>
${fontsCss}
${tokensCss}
${SHELL_CSS}
</style>
</head>
<body>
<header class="gallery-header">
  <h1 class="gallery-header__title">VizForge</h1>
  <p class="gallery-header__dek">A showcase spanning the conventional to the experimental — every piece here is a real dataset, honestly encoded.</p>
</header>
<main class="gallery-main">
${tierSections}
</main>
<footer class="gallery-footer">
  <p>VizForge — given any dataset and intent, a visualization that is both correct and strikingly beautiful.</p>
</footer>
</body>
</html>
`;
}

// --- optional CLI self-test (mirrors pattern-scan.mjs's --selftest guard) ---
function runSelftest() {
  const fixture = {
    pieces: [
      {
        slug: 'fixture-piece',
        tier: 2,
        technique: 'fixture-technique',
        kind: 'animated',
        dataset: { id: 'fixture-dataset', source: 'Fixture Source', url: 'https://example.com', domain: 'test' },
        pieceHref: '../scaffolds/fixture-piece.html',
        assets: {
          poster: 'assets/fixture-piece/poster.png',
          mp4: 'assets/fixture-piece/delivery.mp4',
          gif: 'assets/fixture-piece/piece.gif',
        },
      },
      {
        slug: 'fixture-expressive-piece',
        tier: 3,
        technique: 'fixture-expressive-technique',
        kind: 'static',
        register: 'expressive',
        dataset: { id: 'fixture-dataset-2', source: 'Fixture Source', url: 'https://example.com', domain: 'test' },
        pieceHref: '../scaffolds/fixture-expressive-piece.html',
        assets: { poster: 'assets/fixture-expressive-piece/fixture-expressive-piece@2x.png', mp4: null, gif: null },
      },
    ],
  };

  const html = renderGalleryIndex(fixture, { tokensCss: '', fontsCss: '' });
  let ok = true;

  if (!/VizForge/.test(html)) {
    console.error('SELFTEST FAILED: missing VizForge header');
    ok = false;
  }
  if (/autoplay/i.test(html)) {
    console.error('SELFTEST FAILED: autoplay present in index');
    ok = false;
  }
  for (const t of ['Tier 1', 'Tier 2', 'Tier 3']) {
    if (!html.includes(t)) {
      console.error(`SELFTEST FAILED: missing tier section heading: ${t}`);
      ok = false;
    }
  }
  // Phase 18 (EXPR-08): register label present on the expressive fixture
  // card, absent (house default) on the plain fixture card.
  const houseCardMatch = html.match(/<article class="piece-card" data-slug="fixture-piece"[\s\S]*?<\/article>/);
  const expressiveCardMatch = html.match(/<article class="piece-card" data-slug="fixture-expressive-piece"[\s\S]*?<\/article>/);
  if (!expressiveCardMatch || !expressiveCardMatch[0].includes('Expressive register')) {
    console.error('SELFTEST FAILED: expressive fixture card missing the register label');
    ok = false;
  }
  if (!houseCardMatch || houseCardMatch[0].includes('Expressive register')) {
    console.error('SELFTEST FAILED: house fixture card unexpectedly shows a register label');
    ok = false;
  }
  if (ok) console.log('SELFTEST: renderGalleryIndex produces tier-grouped, autoplay-free, register-aware HTML.');
  return ok;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    const ok = runSelftest();
    process.exit(ok ? 0 : 1);
  }
}
