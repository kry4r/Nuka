// src/core/testing/explorer/fuzz.ts
//
// L3 Fuzz verb — M3.T3 orchestrator.
// See locked spec §4.4.
//
// Algorithm:
//   1. Load fixture (target file path or inline _fixtureDef backdoor).
//   2. Build StdinFuzzer(seed). For step 1..steps:
//        a. Optionally resize via fuzzer.shouldResize(p) → pickViewport.
//        b. Send next key via stdin.write; flush a microtask.
//        c. Parse current grid; run L1 invariants. On first violation:
//           record sequence, viewport, invariant rule; break out of loop.
//   3. If violation: shrink the recorded keystroke sequence. The predicate
//      replays the prefix from a *fresh mount* at the violation-time
//      viewport and asks: did the same invariant rule fire again?
//   4. Return FuzzResult.
//
// Hermetic predicate: every shrink predicate call mounts a fresh handle
// and unmounts before returning. State never leaks between calls.

import fs from 'node:fs'
import path from 'node:path'
import { renderWithViewport } from './L0/render'
import { AnsiGrid } from './L0/grid'
import { runAll } from './L1/index'
import { VIEWPORT_PROFILES } from './sweep/viewportMatrix'
import { StdinFuzzer, type Keystroke } from './L3/stdinFuzzer'
import { shrink } from './L3/shrinker'
import type { FixtureDef, FuzzOpts, FuzzResult, Viewport } from './types'

// file-local: _fixtureDef backdoor for tests (same pattern as capture/sweep)
type FuzzOptsExtended = FuzzOpts & {
  _fixtureDef?: FixtureDef
}

const DEFAULT_STEPS = 200
const DEFAULT_P_RESIZE = 0.05

/**
 * Wait for ink + React to commit any state changes triggered by the most
 * recent stdin event. ink uses both microtask scheduling (for setState in
 * useInput callbacks) and a ~16ms throttled frame flush; a single
 * setImmediate is insufficient on cold mounts. Empirically 35 ms is the
 * minimum reliable wait across vitest + Node 18+; we add headroom (40 ms)
 * so the predicate replay path matches the live fuzz loop's frame budget.
 */
async function flushPaint(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r))
  await new Promise<void>((r) => setTimeout(r, 40))
  await new Promise<void>((r) => setImmediate(r))
}

/**
 * Dynamically load a fixture file. Mirrors fixtureLoader's tsImport-then-
 * native-import fallback pattern so the function works under both the
 * vitest runtime (native .tsx) and dist/explorer.js (tsx esm loader).
 */
async function loadFixtureFile(absPath: string): Promise<FixtureDef> {
  let raw: unknown
  try {
    const { tsImport } = await import('tsx/esm/api')
    const mod = (await tsImport(absPath, import.meta.url)) as
      | { default?: FixtureDef }
      | FixtureDef
    raw = 'default' in (mod as object) ? (mod as { default?: FixtureDef }).default : mod
  } catch {
    const mod = (await import(absPath)) as { default?: FixtureDef } | FixtureDef
    raw = 'default' in (mod as object) ? (mod as { default?: FixtureDef }).default : mod
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`fuzz: ${absPath} default export is not a FixtureDef object`)
  }
  return raw as FixtureDef
}

/**
 * Run the L1 invariants against a freshly-rendered grid. Returns the first
 * violated rule name, or `null` if all invariants are clean.
 *
 * Hermetic: caller must pass an unmounted handle pre-mount; we don't
 * touch global state.
 */
function firstViolationRule(
  handle: ReturnType<typeof renderWithViewport>,
  viewport: Viewport,
  fixtureCase: FixtureDef['cases'][string] | undefined,
): string | null {
  const frame = handle.lastFrame()
  const grid = AnsiGrid.parse(frame, viewport)
  const violations = runAll(grid, {
    viewport,
    staticWrites: handle.staticWrites(),
    fixtureCase,
  })
  return violations[0]?.rule ?? null
}

/**
 * Replay a keystroke prefix from a fresh mount at the given viewport.
 * Returns the *first* invariant rule fired, or null if clean.
 */
async function replayAndCheck(
  fixture: FixtureDef,
  caseName: string,
  viewport: Viewport,
  keys: Keystroke[],
): Promise<string | null> {
  const fixtureCase = fixture.cases[caseName]
  if (!fixtureCase) return null
  const handle = renderWithViewport(fixtureCase.render(), viewport)
  try {
    // Initial paint settle — same rhythm as the main loop so the shrinker's
    // "replay from empty" matches the live fuzz path exactly.
    await flushPaint()
    for (const k of keys) {
      handle.stdin.write(k)
      await flushPaint()
    }
    return firstViolationRule(handle, viewport, fixtureCase)
  } finally {
    handle.unmount()
  }
}

/**
 * Random stdin + occasional viewport resize, shrunk to minimal repro on
 * failure. See locked spec §4.4.
 */
export async function fuzz(opts: FuzzOptsExtended): Promise<FuzzResult> {
  const {
    target,
    seed = 0,
    steps = DEFAULT_STEPS,
    pResize = DEFAULT_P_RESIZE,
    cwd = process.cwd(),
    viewportMatrix = VIEWPORT_PROFILES,
    _fixtureDef,
  } = opts

  // ---- 1. Load fixture ----------------------------------------------------
  let fixture: FixtureDef
  if (_fixtureDef) {
    fixture = _fixtureDef
  } else if (target && target !== '__inline__') {
    const absPath = path.isAbsolute(target) ? target : path.join(cwd, target)
    if (!fs.existsSync(absPath)) {
      throw new Error(`fuzz: target fixture not found: ${absPath}`)
    }
    fixture = await loadFixtureFile(absPath)
  } else {
    throw new Error('fuzz: must supply target= or _fixtureDef')
  }

  const caseNames = Object.keys(fixture.cases)
  if (caseNames.length === 0) {
    throw new Error(`fuzz: fixture ${fixture.component} has no cases`)
  }
  // Default to the first case; future enhancement: --case=<name> flag.
  const caseName = caseNames[0]!
  const fixtureCase = fixture.cases[caseName]!

  // ---- 2. Initial viewport ------------------------------------------------
  // Use the fixture's first viewport (if specified) as the starting viewport,
  // matching sweep semantics. Resize draws from `viewportMatrix`.
  const fixtureViewports: Viewport[] =
    fixture.viewports && fixture.viewports !== 'default'
      ? (fixture.viewports as Viewport[])
      : viewportMatrix
  let currentViewport: Viewport = fixtureViewports[0] ?? viewportMatrix[0]!

  // ---- 3. Mount + fuzz loop ----------------------------------------------
  const fuzzer = new StdinFuzzer(seed)
  const sequence: Keystroke[] = []

  let handle = renderWithViewport(fixtureCase.render(), currentViewport)
  await flushPaint()

  // Check for a pre-existing violation on the unfuzzed initial frame —
  // if so, the empty sequence is the minimal repro.
  let violatedRule: string | null = firstViolationRule(handle, currentViewport, fixtureCase)
  if (violatedRule) {
    handle.unmount()
    return {
      ok: false,
      failure: {
        seed,
        sequence: [],
        shrunk: [],
        invariant: violatedRule,
        viewport: currentViewport,
      },
    }
  }

  try {
    for (let step = 0; step < steps; step++) {
      // 3a. Maybe resize
      if (fuzzer.shouldResize(pResize)) {
        const next = fuzzer.pickViewport(viewportMatrix)
        currentViewport = next
        handle.resize(next.cols, next.rows)
        await flushPaint()
      }
      // 3b. Send a key
      const key = fuzzer.nextKey()
      sequence.push(key)
      handle.stdin.write(key)
      await flushPaint()

      // 3c. Check invariants
      violatedRule = firstViolationRule(handle, currentViewport, fixtureCase)
      if (violatedRule) break
    }
  } finally {
    handle.unmount()
  }

  // ---- 4. No violation → clean run ---------------------------------------
  if (!violatedRule) return { ok: true }

  // ---- 5. Shrink the failing sequence ------------------------------------
  // Predicate: replay the prefix at the violation-time viewport; same rule
  // must fire. Hermetic: each call mounts a fresh handle.
  const violationRule = violatedRule
  const violationViewport = currentViewport

  // The shrinker uses a synchronous predicate. We pre-evaluate the candidate
  // results on demand via a small replay queue. Because shrink() is sync,
  // we trade off by re-running the loop asynchronously through promises.
  //
  // Workaround: run an async shrink wrapper that re-implements the same
  // two-phase strategy, but awaits each predicate.
  const shrunk = await asyncShrink(sequence, async (cand) => {
    const rule = await replayAndCheck(fixture, caseName, violationViewport, cand)
    return rule === violationRule
  })

  return {
    ok: false,
    failure: {
      seed,
      sequence,
      shrunk,
      invariant: violationRule,
      viewport: violationViewport,
    },
  }
}

// ---------------------------------------------------------------------------
// asyncShrink — mirror of L3/shrinker.ts but for async predicates.
// Same deterministic two-phase strategy (binary-search prefix, per-step
// deletion until fixed point). Kept inline here so the sync `shrink()` in
// L3/shrinker.ts remains the primary, test-covered, reusable API.
// ---------------------------------------------------------------------------
async function asyncShrink<T>(
  sequence: T[],
  predicate: (s: T[]) => Promise<boolean>,
  maxIters = 4096,
): Promise<T[]> {
  if (sequence.length === 0) return sequence.slice()
  if (!(await predicate(sequence))) return sequence.slice()

  let iters = 0

  // Phase 1 — binary-search prefix
  let lo = 1
  let hi = sequence.length
  let best = sequence.slice()
  while (lo < hi && iters < maxIters) {
    const mid = (lo + hi) >> 1
    iters++
    const cand = sequence.slice(0, mid)
    if (await predicate(cand)) {
      hi = mid
      best = cand
    } else {
      lo = mid + 1
    }
  }

  // Phase 2 — per-step deletion, pass-until-fixed-point
  let progress = true
  while (progress && iters < maxIters) {
    progress = false
    for (let i = 0; i < best.length && iters < maxIters; i++) {
      const cand = best.slice(0, i).concat(best.slice(i + 1))
      iters++
      if (await predicate(cand)) {
        best = cand
        progress = true
        break
      }
    }
  }

  return best
}
