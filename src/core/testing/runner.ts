// src/core/testing/runner.ts
//
// Phase 9 §6 — runPlan(plan, opts) walks the plan's steps, dispatches each
// to a handler, and accumulates frames + per-step results. Snapshot files
// live under `test-plans/__snapshots__/<name>.txt` resolved relative to
// `opts.cwd ?? process.cwd()`. With `updateSnapshots:true`, mismatches
// silently overwrite the snapshot file; otherwise they produce a unified-
// diff-style failure message.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { mountApp, type Harness, type Mocks } from '../../tui/testing/harness'
import { MockProvider } from './mockProvider'
import type { Plan, Step, AssertSpec, ProviderResponse } from './plan'
import { matches as matchAssertion, snapshotDiff } from './assertions'
import type { SlashRegistry } from '../../slash/registry'
import { buildSlashRegistryFromNames } from './slashRegistry'

export type RunOpts = {
  cwd?: string
  home?: string
  updateSnapshots?: boolean
  reporter?: 'tap' | 'json' | 'pretty'
  clock?: () => number
  /** Override the harness factory; lets tests inject custom mounts. */
  mountFn?: typeof mountApp
  /**
   * Phase 10 §4.2 — explicit slash registry override. When provided it
   * takes precedence over `plan.setup.slash` (so vitest tests can inject
   * a pre-built registry without going through the export-name lookup).
   */
  slash?: SlashRegistry
}

export type StepResult = {
  index: number
  ok: boolean
  kind: Step['kind']
  message?: string
  frame?: string
}

export type RunResult = {
  ok: boolean
  steps: StepResult[]
  frames: string[]
  durationMs: number
}

const DEFAULT_WAIT_TIMEOUT = 1000

export async function runPlan(plan: Plan, opts: RunOpts = {}): Promise<RunResult> {
  const cwd = opts.cwd ?? process.cwd()
  const mountFn = opts.mountFn ?? mountApp

  const mock = new MockProvider({ id: 'mock' })
  for (const r of plan.mockResponses) mock.append(r)
  const mocks: Mocks = { provider: mock }

  // Phase 10 §4.2 — if the plan opts in to slash routing, build the
  // registry from the export-name list. opts.slash always wins.
  let slashRegistry: SlashRegistry | undefined = opts.slash
  if (!slashRegistry && plan.setup?.slash && plan.setup.slash.length > 0) {
    slashRegistry = await buildSlashRegistryFromNames(plan.setup.slash)
  }

  let harness: Harness | undefined
  const stepResults: StepResult[] = []
  const startTs = Date.now()

  // Helper that ensures a harness exists; defaults to 'app' until a `render`
  // step explicitly switches target.
  const ensureMounted = (target?: string): Harness => {
    if (harness) return harness
    if (target === 'wizard') {
      harness = mountFn({ target: 'wizard', mocks })
    } else {
      harness = mountFn({ target: 'app', mocks, cwd, slash: slashRegistry })
    }
    return harness
  }

  const flush = () => new Promise<void>(r => setImmediate(r))

  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!
      try {
        await executeStep(step, i, {
          ensureMounted,
          getHarness: () => harness,
          mock,
          plan,
          cwd,
          updateSnapshots: opts.updateSnapshots ?? false,
          flush,
          appendStepResult: (r) => stepResults.push(r),
        })
      } catch (err) {
        // Step threw unexpectedly; record + continue (per spec §8).
        const h = harness as Harness | undefined
        stepResults.push({
          index: i,
          ok: false,
          kind: step.kind,
          message: `step threw: ${(err as Error).message ?? String(err)}`,
          frame: h?.frames().pop(),
        })
      }
    }
  } finally {
    const h = harness as Harness | undefined
    if (plan.cleanup?.unmount !== false && h) {
      try { h.unmount() } catch { /* ignore */ }
    }
  }

  const h = harness as Harness | undefined
  const allFrames = h ? h.frames() : []
  const ok = stepResults.every(r => r.ok)
  return {
    ok,
    steps: stepResults,
    frames: allFrames,
    durationMs: Date.now() - startTs,
  }
}

// ---------------------------------------------------------------------------
// Step dispatch
// ---------------------------------------------------------------------------

type StepCtx = {
  ensureMounted: (target?: string) => Harness
  getHarness: () => Harness | undefined
  mock: MockProvider
  plan: Plan
  cwd: string
  updateSnapshots: boolean
  flush: () => Promise<void>
  appendStepResult: (r: StepResult) => void
}

async function executeStep(step: Step, index: number, ctx: StepCtx): Promise<void> {
  switch (step.kind) {
    case 'render': {
      const h = ctx.ensureMounted(step.target)
      await ctx.flush()
      ctx.appendStepResult({
        index, ok: true, kind: 'render',
        frame: h.frames().pop(),
      })
      return
    }
    case 'keystroke': {
      const h = ctx.ensureMounted()
      h.stdin.write(step.chars)
      // ink-testing-library can swallow keys without a microtask flush.
      await ctx.flush()
      ctx.appendStepResult({
        index, ok: true, kind: 'keystroke',
        frame: h.frames().pop(),
      })
      return
    }
    case 'slash': {
      const h = ctx.ensureMounted()
      // Phase 10 §4.2 — type the command, settle, THEN send Enter on its
      // own. ink-testing-library batches chunks within a single
      // stdin.write into one keypress event; if "/stats\r" lands as one
      // chunk, the Enter is swallowed. Sending the carriage return as a
      // separate write (with a microtask flush AND a real macrotask
      // delay between) delivers a `key.return` to PromptInput's
      // useInput hook so onSubmit fires.
      const text = step.command.startsWith('/') ? step.command : '/' + step.command
      h.stdin.write(text)
      await h.waitFor({ contains: text }, 500)
      await ctx.flush()
      await new Promise(r => setTimeout(r, 30))
      h.stdin.write('\r')
      // Allow async slash dispatch (registry.find -> cmd.run -> setDialog
      // -> re-render) to settle before the next step samples the frame.
      await ctx.flush()
      await new Promise(r => setTimeout(r, 30))
      await ctx.flush()
      ctx.appendStepResult({
        index, ok: true, kind: 'slash',
        frame: h.frames().pop(),
      })
      return
    }
    case 'wait': {
      const h = ctx.ensureMounted()
      const spec = step.spec
      if ('ms' in spec) {
        await new Promise(r => setTimeout(r, spec.ms))
        ctx.appendStepResult({ index, ok: true, kind: 'wait' })
      } else {
        const timeoutMs = spec.timeoutMs ?? DEFAULT_WAIT_TIMEOUT
        try {
          await h.waitFor(spec.until, timeoutMs)
          ctx.appendStepResult({ index, ok: true, kind: 'wait', frame: h.frames().pop() })
        } catch (err) {
          ctx.appendStepResult({
            index, ok: false, kind: 'wait',
            message: `timed out waiting for assertion: ${(err as Error).message}`,
            frame: h.frames().pop(),
          })
        }
      }
      return
    }
    case 'assert': {
      const h = ctx.ensureMounted()
      const fs = h.frames()
      const r = matchAssertion(step.spec as AssertSpec, {
        frames: fs,
        lastFrame: fs[fs.length - 1] ?? '',
      })
      ctx.appendStepResult({
        index, ok: r.ok, kind: 'assert',
        message: r.ok ? undefined : r.message,
        frame: fs[fs.length - 1],
      })
      return
    }
    case 'snapshot': {
      const h = ctx.ensureMounted()
      const last = h.frames().pop() ?? ''
      const file = path.resolve(ctx.cwd, 'test-plans', '__snapshots__', `${step.name}.txt`)
      if (ctx.updateSnapshots) {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, last, 'utf8')
        ctx.appendStepResult({ index, ok: true, kind: 'snapshot', frame: last })
        return
      }
      let expected: string | null = null
      try {
        expected = await fs.readFile(file, 'utf8')
      } catch {
        ctx.appendStepResult({
          index, ok: false, kind: 'snapshot',
          message: `snapshot missing: ${file}\n(re-run with --update-snapshots to create)`,
          frame: last,
        })
        return
      }
      if (expected === last) {
        ctx.appendStepResult({ index, ok: true, kind: 'snapshot', frame: last })
      } else {
        ctx.appendStepResult({
          index, ok: false, kind: 'snapshot',
          message: snapshotDiff(expected, last),
          frame: last,
        })
      }
      return
    }
    case 'mock': {
      ctx.mock.append(step.append as ProviderResponse)
      ctx.appendStepResult({ index, ok: true, kind: 'mock' })
      return
    }
    default: {
      const _exhaustive: never = step
      void _exhaustive
      ctx.appendStepResult({
        index, ok: false, kind: (step as Step).kind,
        message: `runner: unhandled step kind`,
      })
    }
  }
}
