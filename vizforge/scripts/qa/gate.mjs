#!/usr/bin/env node
// scripts/qa/gate.mjs
//
// QA-01 single-entry-point orchestrator (docs/qa-schemas.md contract #2).
// Wires all ten check modules under scripts/qa/checks/*.check.mjs into one
// CLI / programmatic API: reads a piece's HTML + meta.json, opens AT MOST
// ONE shared Playwright session (session.mjs's openPiece — the only place
// any of this code launches Chromium, 02-RESEARCH.md's anti-pattern guard
// against re-launching per check), runs every applicable check against
// that one shared context, writes the versioned `<piece>.gate.json`
// sidecar, and exits 0 iff no check reported VIOLATION.
//
// Design choices (documented per 02-04-PLAN.md's requirement):
//
// 1. Non-applicable checks (loop-continuity/animation-meta on a static
//    piece) are OMITTED from the sidecar entirely, never listed as a
//    placeholder PASS. A skipped check reported as PASS would be a silent
//    lie about what was actually verified (locked decision). Applicability
//    is decided from meta.kind BEFORE opening any session.
//
// 2. A missing or unparseable meta.json is itself a `meta`-check VIOLATION
//    (named evidence: "meta sidecar not found"/"unparseable"), never a
//    thrown exception. If ANY selected check needs a browser session and
//    no viewport can be resolved (no framePreset, no dimensions.css — the
//    inevitable consequence of a missing meta.json for a real piece) —
//    each such check is individually reported as its own named VIOLATION
//    rather than crashing the whole run.
//
// 3. Every check invocation is wrapped in try/catch (belt-and-suspenders):
//    an unexpected throw inside a check module becomes a named VIOLATION
//    ("check threw: ...") instead of taking down the entire gate run.
//
// 4. The shared ctx object passed to every check's run() carries every
//    resolved key (html, meta, page, screenshot, viz, requests,
//    deviceScaleFactor) regardless of that particular check's own declared
//    `needs` — each module already destructures only what it declares.
//    `needs` remains the authoritative list gate.mjs itself reads to
//    decide (a) whether a session must be opened at all, and (b) whether
//    an individual selected check can run without one.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { openPiece } from './checks/session.mjs';
import * as metaCheck from './checks/meta.check.mjs';
import * as patternScanCheck from './checks/pattern-scan.check.mjs';
import * as attributionCheck from './checks/attribution.check.mjs';
import * as baselineHonestyCheck from './checks/baseline-honesty.check.mjs';
import * as selfContainedCheck from './checks/self-contained.check.mjs';
import * as dimensionsCheck from './checks/dimensions.check.mjs';
import * as contrastCheck from './checks/contrast.check.mjs';
import * as paletteCheck from './checks/palette.check.mjs';
import * as negativeGeometryCheck from './checks/negative-geometry.check.mjs';
import * as areaEncodingCheck from './checks/area-encoding.check.mjs';
import * as radialBaselineCheck from './checks/radial-baseline.check.mjs';
import * as geoHonestyCheck from './checks/geo-honesty.check.mjs';
import * as densityBandwidthCheck from './checks/density-bandwidth.check.mjs';
import * as networkPositionCheck from './checks/network-position.check.mjs';
import * as legendRequiredCheck from './checks/legend-required.check.mjs';
import * as loopContinuityCheck from './checks/loop-continuity.check.mjs';
import * as animationMetaCheck from './checks/animation-meta.check.mjs';
import * as atRestCheck from './checks/at-rest.check.mjs';

// Roster order mirrors docs/qa-schemas.md / 02-04-PLAN.md's <interfaces>
// listing — browserless checks first (meta, pattern-scan, attribution),
// then checks that need a live session, animated-only checks last.
// negative-geometry placed after palette (13-02, FIX-02: applies to every
// piece); at-rest placed after animation-meta (13-02, FIX-03: animated-only,
// staged CAUTION enforcement — see that module's header). area-encoding +
// radial-baseline placed after negative-geometry (19-03, FND-03: both are
// signal-scoped honesty checks, inert unless their meta signal is present —
// see each module's header for its applicability gate). geo-honesty +
// density-bandwidth + network-position placed immediately after (19-04,
// FND-03: the remaining three family-scoped honesty checks, same
// applicability pattern — inert unless meta.family matches). legend-required
// placed immediately after network-position (24-01, EXP-01/EXP-02): the
// sixth family-scoped honesty check, inert unless meta.family==='expressive'
// — requires a live-DOM bijection between rendered [data-legend-key]
// elements and data-bearing meta.mapping[] entries.
export const ALL_CHECKS = [
  metaCheck,
  patternScanCheck,
  attributionCheck,
  baselineHonestyCheck,
  selfContainedCheck,
  dimensionsCheck,
  contrastCheck,
  paletteCheck,
  negativeGeometryCheck,
  areaEncodingCheck,
  radialBaselineCheck,
  geoHonestyCheck,
  densityBandwidthCheck,
  networkPositionCheck,
  legendRequiredCheck,
  loopContinuityCheck,
  animationMetaCheck,
  atRestCheck,
];

const ANIMATED_ONLY = new Set(['loop-continuity', 'animation-meta', 'at-rest']);
const SESSION_KEYS = ['page', 'screenshot', 'viz', 'requests', 'consoleErrors'];

function isApplicable(checkModule, kind) {
  if (ANIMATED_ONLY.has(checkModule.name)) return kind === 'animated';
  return true;
}

function needsSessionKeys(checkModule) {
  return checkModule.needs.some((k) => SESSION_KEYS.includes(k));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function resolveMeta(htmlPath) {
  const metaPath = htmlPath.replace(/\.html$/i, '.meta.json');
  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch {
    return { meta: null, metaError: `meta sidecar not found: ${metaPath}`, metaPath };
  }
  try {
    return { meta: JSON.parse(raw), metaError: null, metaPath };
  } catch (err) {
    return { meta: null, metaError: `meta sidecar unparseable: ${metaPath} (${err.message})`, metaPath };
  }
}

function resolveSessionOpts(meta) {
  if (!meta) return null;
  if (meta.framePreset) return { preset: meta.framePreset };
  if (meta.dimensions?.css) {
    const [width, height] = meta.dimensions.css;
    return { width, height, deviceScaleFactor: 2 };
  }
  return null;
}

async function runOneCheck(checkModule, ctx) {
  try {
    return await checkModule.run(ctx);
  } catch (err) {
    return {
      name: checkModule.name,
      severity: 'VIOLATION',
      evidence: `check threw: ${err.message}`,
    };
  }
}

/**
 * Double-render determinism spot-check (--deep only). Opens a SECOND fresh
 * session of the same piece and SHA-256-compares against the first:
 *   static   -> current-state screenshot.
 *   animated -> renderFrame(i) for i in {0, floor(T/2), T-1}.
 * Phase 1 already proved SwiftShader determinism (byte-identical expected);
 * any mismatch here names the differing frame.
 */
// `browser` (Phase 9 Plan 02): when the caller injects a pooled browser,
// session2 shares it via a SECOND CONTEXT rather than a second Chromium
// process. Documented tradeoff: a pooled deep-mode run therefore compares
// two CONTEXTS on ONE browser process, versus the CLI path's two entirely
// separate processes — acceptable because Plan 01's DETERMINISM_LAUNCH_ARGS
// make rendering deterministic PROCESS-WIDE (not dependent on which process
// happens to host a given context), and the CLI path still exercises and
// proves the stricter two-process comparison on every un-pooled run.
async function runDeterminismCheck(htmlPath, sessionOpts, session1, browser = null) {
  const session2 = await openPiece(htmlPath, { ...sessionOpts, browser });
  try {
    if (session1.viz.kind !== 'animated') {
      const [shotA, shotB] = await Promise.all([session1.screenshotBuffer(), session2.screenshotBuffer()]);
      const hashA = sha256(shotA);
      const hashB = sha256(shotB);
      if (hashA !== hashB) {
        return {
          name: 'determinism',
          severity: 'VIOLATION',
          evidence: `nondeterministic render: double-rendered screenshot hashes differ (${hashA.slice(0, 12)} vs ${hashB.slice(0, 12)})`,
        };
      }
      return {
        name: 'determinism',
        severity: 'PASS',
        evidence: `double-render byte-identical (SHA-256 ${hashA.slice(0, 12)}...)`,
      };
    }

    const totalFrames = session1.viz.totalFrames;
    const frames = [0, Math.floor(totalFrames / 2), totalFrames - 1];
    for (const frame of frames) {
      const [shotA, shotB] = await Promise.all([
        session1.renderFrameShot(frame),
        session2.renderFrameShot(frame),
      ]);
      if (sha256(shotA) !== sha256(shotB)) {
        return {
          name: 'determinism',
          severity: 'VIOLATION',
          evidence: `nondeterministic render: frame ${frame} differs across double-render`,
        };
      }
    }
    return {
      name: 'determinism',
      severity: 'PASS',
      evidence: `double-render byte-identical across frames ${frames.join(', ')}`,
    };
  } finally {
    await session2.close();
  }
}

/**
 * runGate(htmlPath, { deep, only, noSidecar }) -> report object.
 * Programmatic entry point — the CLI below is a thin wrapper around this.
 */
export async function runGate(htmlPath, opts = {}) {
  const { deep = false, only = null, noSidecar = false, browser = null } = opts;

  const html = await readFile(htmlPath, 'utf8');
  const { meta, metaError } = await resolveMeta(htmlPath);
  const kind = meta?.kind === 'animated' ? 'animated' : 'static';

  let selected;
  if (only) {
    const found = ALL_CHECKS.find((c) => c.name === only);
    if (!found) {
      throw new Error(`unknown check "${only}" (known: ${ALL_CHECKS.map((c) => c.name).join(', ')})`);
    }
    selected = [found];
  } else {
    selected = ALL_CHECKS.filter((c) => isApplicable(c, kind));
  }

  const needsSession = deep || selected.some(needsSessionKeys);
  const sessionOpts = resolveSessionOpts(meta);

  let session = null;
  let sessionUnavailableReason = null;

  if (needsSession) {
    if (!sessionOpts) {
      sessionUnavailableReason = metaError
        ? `session unavailable — ${metaError} (no framePreset/dimensions.css to resolve a viewport)`
        : 'session unavailable — meta.json has neither framePreset nor dimensions.css';
    } else {
      try {
        session = await openPiece(htmlPath, { ...sessionOpts, browser });
      } catch (err) {
        sessionUnavailableReason = `session unavailable — failed to open: ${err.message}`;
      }
    }
  }

  try {
    const base = { html, meta };

    if (session) {
      base.page = session.page;
      base.requests = session.requests;
      base.consoleErrors = session.consoleErrors;
      base.viz = session.viz;
      // The RENDERED text. Six checks say "found verbatim in the rendered piece"
      // and fall back to `html` when this is absent — which for years it was, so
      // they were matching against the source, untaken `||` defaults and all.
      base.bodyText = session.bodyText;
      base.deviceScaleFactor = session.deviceScaleFactor;
      base.screenshot =
        session.viz.kind === 'animated'
          ? await session.renderFrameShot(Math.max(session.viz.totalFrames - 1, 0))
          : await session.screenshotBuffer();
    }

    const results = [];

    for (const checkModule of selected) {
      if (checkModule.name === 'meta' && metaError) {
        results.push({ name: 'meta', severity: 'VIOLATION', evidence: metaError });
        continue;
      }
      if (needsSessionKeys(checkModule) && !session) {
        results.push({
          name: checkModule.name,
          severity: 'VIOLATION',
          evidence: `cannot run — ${sessionUnavailableReason}`,
        });
        continue;
      }
      results.push(await runOneCheck(checkModule, base));
    }

    if (deep) {
      if (session) {
        results.push(await runDeterminismCheck(htmlPath, sessionOpts, session, browser));
      } else {
        results.push({
          name: 'determinism',
          severity: 'VIOLATION',
          evidence: `cannot run --deep determinism check — ${sessionUnavailableReason}`,
        });
      }
    }

    const violations = results.filter((r) => r.severity === 'VIOLATION').map((r) => r.name);
    const cautions = results.filter((r) => r.severity === 'CAUTION').map((r) => r.name);

    const report = {
      gateVersion: 1,
      piece: htmlPath,
      ranAt: new Date().toISOString(),
      mode: deep ? 'deep' : 'standard',
      checks: results,
      verdict: violations.length === 0 ? 'PASS' : 'FAIL',
      violations,
      cautions,
    };

    if (!noSidecar) {
      const sidecarPath = htmlPath.replace(/\.html$/i, '.gate.json');
      await writeFile(sidecarPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      report.sidecarPath = sidecarPath;
    }

    return report;
  } finally {
    if (session) await session.close();
  }
}

// --- CLI ---
// node scripts/qa/gate.mjs <piece.html> [--deep] [--check <name>] [--no-sidecar]

function parseCliArgs(argv) {
  const positional = [];
  const flags = { deep: false, only: null, noSidecar: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--deep') flags.deep = true;
    else if (arg === '--check') flags.only = argv[++i];
    else if (arg === '--no-sidecar') flags.noSidecar = true;
    else positional.push(arg);
  }
  return { positional, flags };
}

function formatEvidence(evidence) {
  return typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
}

function printReport(report) {
  console.log(`Gate: ${report.piece} [${report.mode}]`);
  for (const check of report.checks) {
    console.log(`[${check.severity}] ${check.name}: ${formatEvidence(check.evidence)}`);
  }
  console.log('');
  console.log(`Verdict: ${report.verdict}`);
  if (report.violations.length > 0) {
    console.log(`Violations (${report.violations.length}): ${report.violations.join(', ')}`);
  }
  // Cautions are ALWAYS printed, even on a clean PASS — consciously
  // accepted, never silently dropped (locked two-tier severity model).
  if (report.cautions.length > 0) {
    console.log(`Cautions (${report.cautions.length}): ${report.cautions.join(', ')}`);
  }
  if (report.sidecarPath) {
    console.log(`Sidecar written: ${report.sidecarPath}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseCliArgs(argv);
  const [htmlPath] = positional;

  if (!htmlPath) {
    console.error('Usage: node scripts/qa/gate.mjs <piece.html> [--deep] [--check <name>] [--no-sidecar]');
    process.exitCode = 1;
    return;
  }

  const report = await runGate(htmlPath, {
    deep: flags.deep,
    only: flags.only,
    noSidecar: flags.noSidecar,
  });

  printReport(report);
  process.exitCode = report.violations.length > 0 ? 1 : 0;
}

// Only run the CLI when this file is executed directly (not when imported by
// tests/runGate callers) — mirrors capture.mjs/pattern-scan.mjs's guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
