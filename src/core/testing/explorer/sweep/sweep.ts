// src/core/testing/explorer/sweep/sweep.ts
//
// L2 Sweep verb — M2 implementation.
// Flow per locked spec §4.3 steps 1–6:
//   load fixtures × viewports → capture (in-memory) → runAll L1 → writeFailureDump

import path from 'node:path'
import fs from 'node:fs'
import { renderWithViewport } from '../L0/render'
import { AnsiGrid } from '../L0/grid'
import { runAll } from '../L1/index'
import { writeFailureDump } from '../common/tracingFs'
import type { ExplorerPaths } from '../common/tracingFs'
import { loadFixtures, resolveViewports, type LoadedFixture } from './fixtureLoader'
import type { SweepOpts, SweepResult, FailureRecord, Viewport } from '../types'

// file-local: extends SweepOpts with test backdoor for inline fixtures +
// optional judge-stage opt-out (CLI maps --no-judge → judge:false)
type SweepOptsExtended = SweepOpts & {
  _fixtures?: LoadedFixture[]
  /** Inject a mock judge() for tests; defaults to the real two-tier judge. */
  _judge?: typeof import('../judge').judge
}

// Legacy snapshots predate fixture-level sweepMode metadata, but they should
// not keep normal CLI sweeps permanently red.
const LEGACY_EXPLICIT_ONLY_COMPONENTS = new Set([
  'BugB-Snapshot',
])

/**
 * Cartesian product sweep: every fixture × every case × every viewport.
 * Writes failure dumps to <out>/failures/ (or <cwd>/.ink-explorer/failures/).
 * `out` is treated as the `.ink-explorer` base dir (matching capture.ts convention).
 * M2 does not implement judge stage; --judge flag is silently ignored.
 */
export async function sweep(opts: SweepOptsExtended): Promise<SweepResult> {
  const {
    cwd = process.cwd(),
    out,
    _fixtures,
    viewports: viewportsOverride,
    fixturesGlob,
    includeExplicitOnly = true,
  } = opts

  // `out` is the explorer base dir (e.g. .ink-explorer), matching capture.ts convention.
  // If not given, default to <cwd>/.ink-explorer
  const explorerBase = out
    ? (path.isAbsolute(out) ? out : path.join(cwd, out))
    : path.join(cwd, '.ink-explorer')

  const failuresDir = path.join(explorerBase, 'failures')
  const runsDir = path.join(explorerBase, 'runs')
  fs.mkdirSync(failuresDir, { recursive: true })
  fs.mkdirSync(runsDir, { recursive: true })

  // Build ExplorerPaths compatible shape for writeFailureDump
  const explorerPaths: ExplorerPaths = {
    root: explorerBase,
    failures: failuresDir,
    resolved: path.join(explorerBase, 'resolved'),
    captures: path.join(explorerBase, 'captures'),
    judgeCache: path.join(explorerBase, 'judge-cache'),
    runs: runsDir,
  }

  // Load fixtures: either inline (test backdoor) or from disk
  let fixtures: LoadedFixture[]
  if (_fixtures && _fixtures.length > 0) {
    fixtures = _fixtures
  } else {
    const fixtureRoot = fixturesGlob
      ? fixturesGlob
      : path.join(cwd, 'test', 'ui-auto', 'fixtures')
    fixtures = await loadFixtures(fixtureRoot)
  }

  const records: FailureRecord[] = []
  let totalRuns = 0
  let failed = 0

  for (const { path: fixturePath, fixture } of fixtures) {
    if (
      !includeExplicitOnly &&
      (fixture.sweepMode === 'explicit-only' || LEGACY_EXPLICIT_ONLY_COMPONENTS.has(fixture.component))
    ) {
      continue
    }
    const viewports: Viewport[] = viewportsOverride ?? resolveViewports(fixture)
    const caseNames = Object.keys(fixture.cases)

    for (const caseName of caseNames) {
      const fixtureCase = fixture.cases[caseName]!

      for (const viewport of viewports) {
        totalRuns++

        // Step 1–2: mount + flush
        const node = fixtureCase.render()
        const handle = renderWithViewport(node, viewport)
        await new Promise<void>((resolve) => setImmediate(resolve))

        const frame = handle.lastFrame()
        handle.unmount()

        // Step 3: parse grid
        const grid = AnsiGrid.parse(frame, viewport)

        // Step 4: run L1 invariants
        const violations = runAll(grid, {
          viewport,
          staticWrites: handle.staticWrites(),
          fixtureCase,
        })

        // Step 5: if violations → write failure dump
        if (violations.length > 0) {
          failed++
          const componentSlug = fixture.component.toLowerCase().replace(/[^a-z0-9]/g, '-')
          const caseSlug = caseName.toLowerCase().replace(/[^a-z0-9]/g, '-')
          const profileSlug = `${viewport.cols}x${viewport.rows}`
          const id = `${componentSlug}-${caseSlug}-${profileSlug}-${Date.now()}`

          const record: FailureRecord = {
            id,
            component: fixture.component,
            fixtureCase: caseName,
            viewport,
            violations,
            asciiView: grid.asciiView,
            gridHash: grid.hash,
            // Fix 1 (M6.P0): populate fixturePath so the repair subagent's
            // verify tool can re-mount. `fixturePath` is the absolute path
            // from the LoadedFixture loop variable at line 76.
            fixturePath,
            timestamp: new Date().toISOString(),
          }

          records.push(record)

          // Step 5: write failure dump markdown
          writeFailureDump(explorerPaths, record)
        }

        // Step 6: emit minimal log line to stdout
        if (violations.length > 0) {
          process.stdout.write(
            `[sweep] FAIL  ${fixture.component} / ${caseName} @ ${viewport.cols}×${viewport.rows} — ${violations.length} violation(s)\n`,
          )
        } else {
          process.stdout.write(
            `[sweep] pass  ${fixture.component} / ${caseName} @ ${viewport.cols}×${viewport.rows}\n`,
          )
        }
      }
    }
  }

  // M4.T4 — invoke judge() only when the caller explicitly opts in:
  //   * opts.judge === true  (CLI --judge flag or programmatic override), OR
  //   * INK_EXPLORER_JUDGE=1 (CI / automation env var)
  // AND ANTHROPIC_API_KEY is set.
  //
  // Rationale: having ANTHROPIC_API_KEY in the shell environment indicates
  // credentials are present, NOT that the developer consents to spend during
  // this particular run.  An explicit opt-in is required to avoid billed API
  // calls when running `npm test` in a dev shell that has the key set.
  //
  // opts.judge === false (CLI --no-judge) hard-disables judge even if the
  // env opt-in is set.
  const explicitJudgeOpt = opts.judge === true
  const envJudgeOpt = process.env.INK_EXPLORER_JUDGE === '1'
  const judgeDisabled = opts.judge === false
  const wantJudge = !judgeDisabled && (explicitJudgeOpt || envJudgeOpt)
  if (wantJudge && records.length > 0) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey) {
      const judgeFn = opts._judge ?? (await import('../judge')).judge
      try {
        await judgeFn({
          failures: records,
          apiKey,
          cacheRoot: explorerPaths.judgeCache,
        })
      } catch (err) {
        process.stdout.write(
          `[sweep] judge stage failed: ${(err as Error).message}\n`,
        )
      }
    } else {
      process.stdout.write(
        '[sweep] ANTHROPIC_API_KEY not set — skipping judge stage.\n',
      )
    }
  }

  return {
    records,
    totalRuns,
    passed: totalRuns - failed,
    failed,
  }
}
