#!/usr/bin/env node
// scripts/qa/determinism-stress.mjs
//
// RENDER-04 (Phase 9, Plan 01, Task 1): deliberate-concurrency stress harness.
//
// The historical `--deep` gate flake (scaffolds/flow-field-animated.html,
// scaffolds/ambient-sculpture-animated.html — see
// .planning/phases/05-showcase-gallery-diversity-enforcement/deferred-items.md
// and .planning/phases/08-intent-recommendation-preview-ui/deferred-items.md)
// only ever manifested under MANY CONCURRENT Playwright sessions racing
// Chromium's async compositor/raster pipeline — never in isolation, and
// never via test-runner parallelism (`npm run verify` serializes at
// --test-concurrency=1, per the Phase 5 mitigation). This harness reproduces
// that exact environment on demand by opening its OWN deliberate concurrency
// inside one process, via Promise.all — the only way any test in this
// project ever legitimately exercises concurrent Chromium sessions.
//
// runStress({ htmlPath, sessions, rounds, deepGates }):
//   - Opens `sessions` concurrent openPiece() sessions of the scaffold.
//   - Each round renders probe frames {0, floor(T/2), T-1} (read from
//     session.viz.totalFrames — the EXACT frames gate.mjs's
//     runDeterminismCheck compares) via renderFrameShot(i) in every open
//     session concurrently, and SHA-256-hashes every shot.
//   - Optionally fires `deepGates` concurrent runGate(htmlPath, { deep:
//     true, noSidecar: true }) calls interleaved with the probe load —
//     this exercises the actual historical flake site (gate.mjs's
//     runDeterminismCheck), not just this harness's own comparison logic.
//   - Cross-compares hashes BOTH across concurrent sessions within a round
//     AND across rounds: the first hash observed for a given frame index is
//     recorded as canonical; any later mismatch (same or different
//     session/round) is a named divergence carrying { scaffold, round,
//     frame, hashes }.
//   - Every opened session is closed in a `finally` block even when a probe
//     throws — no leaked Chromium from the harness itself.
//
// CLI: node scripts/qa/determinism-stress.mjs <scaffold.html> --sessions N
//      --rounds R --deep-gates K
// Prints the report and exits 1 on any divergence or deep-gate FAIL; exits 0
// clean. Mirrors gate.mjs's import.meta.url CLI guard — importing runStress
// never triggers the CLI.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { openPiece } from './checks/session.mjs';
import { runGate } from './gate.mjs';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function resolveSessionOpts(htmlPath) {
  const metaPath = htmlPath.replace(/\.html$/i, '.meta.json');
  const raw = await readFile(metaPath, 'utf8');
  const meta = JSON.parse(raw);
  if (meta.framePreset) return { preset: meta.framePreset };
  if (meta.dimensions?.css) {
    const [width, height] = meta.dimensions.css;
    return { width, height, deviceScaleFactor: 2 };
  }
  throw new Error(`resolveSessionOpts: ${metaPath} has neither framePreset nor dimensions.css`);
}

/**
 * runStress({ htmlPath, sessions, rounds, deepGates, browser }) -> report
 *
 * report.clean === true iff zero hash divergence across all sessions/rounds
 * AND every fired deep gate (if any) reported verdict 'PASS'.
 *
 * `browser` (Phase 9, Plan 04 — RENDER-04's service-level proof): an
 * OPTIONAL injected Playwright Browser (the pooled render-service browser,
 * app/lib/browser-pool.mjs), threaded into every `openPiece()`/`runGate()`
 * call this harness makes. Mirrors the ownsBrowser pattern already
 * established by capture.mjs/session.mjs/gate.mjs (Plan 02) — with no
 * `browser` this harness self-launches exactly as before (the CLI path,
 * UNCHANGED, still the code path this file's own header describes as
 * reproducing the historical flake's actual environment); with an injected
 * browser, every probe session/deep gate shares ONE already-pooled Chromium
 * PROCESS via fresh contexts, letting this same harness double as the
 * SERVICE's real-concurrency proof (scripts/tests/integration/
 * render-service-determinism-stress.test.mjs) without a second implementation.
 */
export async function runStress({ htmlPath, sessions = 3, rounds = 2, deepGates = 0, browser = null } = {}) {
  const sessionOpts = await resolveSessionOpts(htmlPath);

  const openedSessions = [];
  const divergences = [];
  const gateResults = [];
  // canonical.get(frame) -> { hash, session, round } of the FIRST observation.
  const canonical = new Map();

  function recordHash(frame, hash, session, round) {
    const prior = canonical.get(frame);
    if (!prior) {
      canonical.set(frame, { hash, session, round });
      return;
    }
    if (prior.hash !== hash) {
      divergences.push({
        scaffold: htmlPath,
        round,
        frame,
        hashes: [
          { session: prior.session, round: prior.round, sha256: prior.hash },
          { session, round, sha256: hash },
        ],
      });
    }
  }

  try {
    for (let s = 0; s < sessions; s++) {
      openedSessions.push(await openPiece(htmlPath, { ...sessionOpts, browser }));
    }

    const totalFrames = openedSessions[0].viz.totalFrames;
    const probeFrames = [0, Math.floor(totalFrames / 2), totalFrames - 1];

    for (let round = 0; round < rounds; round++) {
      const deepGatePromises = [];
      for (let g = 0; g < deepGates; g++) {
        deepGatePromises.push(
          runGate(htmlPath, { deep: true, noSidecar: true, browser }).then((report) => {
            const violationEvidence = report.checks
              .filter((c) => c.severity === 'VIOLATION')
              .map((c) => ({ name: c.name, evidence: c.evidence }));
            gateResults.push({
              round,
              verdict: report.verdict,
              violations: report.violations,
              violationEvidence,
            });
          })
        );
      }

      const probePromises = openedSessions.map(async (session, sessionIndex) => {
        for (const frame of probeFrames) {
          const shot = await session.renderFrameShot(frame);
          recordHash(frame, sha256(shot), sessionIndex, round);
        }
      });

      await Promise.all([...probePromises, ...deepGatePromises]);
    }
  } finally {
    await Promise.all(openedSessions.map((session) => session.close()));
  }

  const gateFailures = gateResults.filter((g) => g.verdict !== 'PASS');

  return {
    scaffold: htmlPath,
    sessions,
    rounds,
    deepGates,
    clean: divergences.length === 0 && gateFailures.length === 0,
    divergences,
    gateResults,
    gateFailures,
  };
}

function formatReport(report, elapsedMs) {
  const lines = [];
  lines.push(`Determinism stress: ${report.scaffold}`);
  lines.push(`  sessions=${report.sessions} rounds=${report.rounds} deepGates=${report.deepGates}`);
  if (report.divergences.length > 0) {
    lines.push(`  DIVERGENCES (${report.divergences.length}):`);
    for (const d of report.divergences) {
      lines.push(
        `    frame ${d.frame}: ${d.hashes
          .map((h) => `session ${h.session}@round ${h.round}=${h.sha256.slice(0, 12)}`)
          .join(' vs ')}`
      );
    }
  } else {
    lines.push('  No hash divergences.');
  }
  if (report.deepGates > 0) {
    const failed = report.gateFailures;
    lines.push(
      failed.length > 0
        ? `  Deep gates: ${failed.length}/${report.gateResults.length} FAILED —\n${failed
            .map(
              (f) =>
                `    [round ${f.round}] ${(f.violationEvidence ?? []).map((v) => `${v.name}: ${v.evidence}`).join(' | ')}`
            )
            .join('\n')}`
        : `  Deep gates: ${report.gateResults.length}/${report.gateResults.length} PASS`
    );
  }
  lines.push(`  Result: ${report.clean ? 'CLEAN' : 'DIVERGENT'}`);
  if (elapsedMs != null) lines.push(`  Wall time: ${(elapsedMs / 1000).toFixed(1)}s`);
  return lines.join('\n');
}

// --- CLI ---
// node scripts/qa/determinism-stress.mjs <scaffold.html> --sessions N --rounds R --deep-gates K

function parseCliArgs(argv) {
  const positional = [];
  const flags = { sessions: 3, rounds: 2, deepGates: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sessions') flags.sessions = Number(argv[++i]);
    else if (arg === '--rounds') flags.rounds = Number(argv[++i]);
    else if (arg === '--deep-gates') flags.deepGates = Number(argv[++i]);
    else positional.push(arg);
  }
  return { positional, flags };
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseCliArgs(argv);
  const [htmlPath] = positional;

  if (!htmlPath) {
    console.error(
      'Usage: node scripts/qa/determinism-stress.mjs <scaffold.html> --sessions N --rounds R --deep-gates K'
    );
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const report = await runStress({
    htmlPath,
    sessions: flags.sessions,
    rounds: flags.rounds,
    deepGates: flags.deepGates,
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(formatReport(report, elapsedMs));

  process.exitCode = report.clean ? 0 : 1;
}

// Only run the CLI when this file is executed directly (not when imported by
// tests) — mirrors gate.mjs/capture.mjs's guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
