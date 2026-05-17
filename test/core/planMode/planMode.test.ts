// test/core/planMode/planMode.test.ts
//
// Iter YYY — spec for the plan-mode infrastructure.
//
// Two surfaces under test:
//   - PlanModeState — lifecycle + history bookkeeping (state machine).
//   - makeEnterPlanModeTool / makeExitPlanModeTool / makeIsInPlanModeTool —
//     the agent-facing Tools that mutate the state.
//
// First-pass scope: state + tools only. Enforcement (blocking writes
// while active) is wired in a later iter via PermissionChecker.

import { describe, expect, it } from 'vitest'
import {
  PlanModeState,
  type PlanEntry,
} from '../../../src/core/planMode/planModeState'
import {
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  IS_IN_PLAN_MODE_TOOL_NAME,
  makeEnterPlanModeTool,
  makeExitPlanModeTool,
  makeIsInPlanModeTool,
  makePlanModeTools,
  type EnterPlanModeResult,
  type ExitPlanModeResult,
  type IsInPlanModeResult,
} from '../../../src/core/planMode/planModeTools'
import type { ToolContext } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

// ─── PlanModeState — lifecycle ────────────────────────────────────────

describe('PlanModeState lifecycle', () => {
  it('starts inactive with no plans', () => {
    const s = new PlanModeState()
    expect(s.isActive()).toBe(false)
    expect(s.planCount).toBe(0)
    expect(s.latestPlan()).toBeUndefined()
    expect(s.history()).toEqual([])
  })

  it('enter() flips isActive() to true', () => {
    const s = new PlanModeState()
    s.enter()
    expect(s.isActive()).toBe(true)
  })

  it('exit() records the plan and flips isActive() back to false', () => {
    let now = 1_000
    const s = new PlanModeState(() => now)
    s.enter()
    now = 1_500
    const entry = s.exit('# my plan\n- step 1')
    expect(s.isActive()).toBe(false)
    expect(entry).toEqual<PlanEntry>({ ts: 1_500, plan: '# my plan\n- step 1' })
    expect(s.planCount).toBe(1)
    expect(s.latestPlan()).toEqual<PlanEntry>({ ts: 1_500, plan: '# my plan\n- step 1' })
  })

  it('multiple enter() calls without exit() are idempotent (no extra event)', () => {
    const s = new PlanModeState()
    s.enter()
    s.enter()
    s.enter()
    expect(s.isActive()).toBe(true)
    // No plan should have been recorded by enter().
    expect(s.planCount).toBe(0)
    // A subsequent exit still records exactly one plan.
    s.exit('p')
    expect(s.planCount).toBe(1)
  })

  it('exit() without prior enter() still records the plan and stays inactive', () => {
    let now = 42
    const s = new PlanModeState(() => now)
    expect(s.isActive()).toBe(false)
    const entry = s.exit('orphan plan')
    expect(s.isActive()).toBe(false)
    expect(entry.plan).toBe('orphan plan')
    expect(entry.ts).toBe(42)
    expect(s.planCount).toBe(1)
  })

  it('exit() throws on empty / whitespace-only plan', () => {
    const s = new PlanModeState()
    expect(() => s.exit('')).toThrow(/non-empty/)
    expect(() => s.exit('   ')).toThrow(/non-empty/)
    expect(() => s.exit('\n\t')).toThrow(/non-empty/)
    // The failed call must not record anything or change state.
    expect(s.planCount).toBe(0)
  })

  it('exit() throws on non-string plan', () => {
    const s = new PlanModeState()
    // Caller is supposed to validate at the type level; we still guard.
    expect(() =>
      s.exit(undefined as unknown as string),
    ).toThrow(TypeError)
    expect(() => s.exit(42 as unknown as string)).toThrow(TypeError)
  })

  it('latestPlan() returns the most recent plan across multiple cycles', () => {
    let now = 100
    const s = new PlanModeState(() => now)
    s.enter()
    now = 200
    s.exit('first')
    s.enter()
    now = 300
    s.exit('second')
    s.enter()
    now = 400
    s.exit('third')
    expect(s.planCount).toBe(3)
    expect(s.latestPlan()).toEqual<PlanEntry>({ ts: 400, plan: 'third' })
  })

  it('latestPlan() returns a copy that callers cannot mutate', () => {
    const s = new PlanModeState(() => 7)
    s.exit('orig')
    const a = s.latestPlan()
    expect(a).toBeDefined()
    if (a) {
      a.plan = 'tampered'
      a.ts = 0
    }
    // Internal state should be untouched.
    expect(s.latestPlan()).toEqual<PlanEntry>({ ts: 7, plan: 'orig' })
  })

  it('history() returns freshest-first plans as a fresh array', () => {
    let now = 0
    const s = new PlanModeState(() => now)
    now = 1
    s.exit('a')
    now = 2
    s.exit('b')
    now = 3
    s.exit('c')
    const h = s.history()
    expect(h.map(e => e.plan)).toEqual(['c', 'b', 'a'])
    // Mutating the returned snapshot must not affect state.
    h.length = 0
    expect(s.planCount).toBe(3)
  })

  it('reset() clears both isActive() and plans', () => {
    const s = new PlanModeState()
    s.enter()
    s.exit('foo')
    s.enter()
    expect(s.isActive()).toBe(true)
    expect(s.planCount).toBe(1)
    s.reset()
    expect(s.isActive()).toBe(false)
    expect(s.planCount).toBe(0)
    expect(s.latestPlan()).toBeUndefined()
  })
})

// ─── Tool metadata ────────────────────────────────────────────────────

describe('plan-mode Tools — schema + metadata', () => {
  it('exposes the documented tool names', () => {
    const state = new PlanModeState()
    expect(makeEnterPlanModeTool(state).name).toBe(ENTER_PLAN_MODE_TOOL_NAME)
    expect(makeExitPlanModeTool(state).name).toBe(EXIT_PLAN_MODE_TOOL_NAME)
    expect(makeIsInPlanModeTool(state).name).toBe(IS_IN_PLAN_MODE_TOOL_NAME)
    expect(ENTER_PLAN_MODE_TOOL_NAME).toBe('EnterPlanMode')
    expect(EXIT_PLAN_MODE_TOOL_NAME).toBe('ExitPlanMode')
    expect(IS_IN_PLAN_MODE_TOOL_NAME).toBe('IsInPlanMode')
  })

  it('ExitPlanMode requires `plan` in its JSON Schema', () => {
    const t = makeExitPlanModeTool(new PlanModeState())
    const params = t.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; minLength?: number }>
    }
    expect(params.required).toEqual(['plan'])
    expect(params.properties?.plan?.type).toBe('string')
    expect(params.properties?.plan?.minLength).toBe(1)
  })

  it('declares the documented capability tags and permissions', () => {
    const s = new PlanModeState()
    const e = makeEnterPlanModeTool(s)
    const x = makeExitPlanModeTool(s)
    const i = makeIsInPlanModeTool(s)
    for (const t of [e, x, i]) {
      expect(t.tags).toContain('core')
      expect(t.tags).toContain('plan')
    }
    expect(e.annotations?.readOnly).toBe(true)
    expect(i.annotations?.readOnly).toBe(true)
    // ExitPlanMode mutates plan history, so it's not read-only.
    expect(x.annotations?.readOnly).toBe(false)
    // Iter LLLL — EnterPlanMode declares `'ask'` so the PermissionChecker
    // routes it through `askUser` before `run()` fires. Exit + status
    // remain `'none'` (no consent needed once the user is already in
    // plan mode / reading status).
    expect(e.needsPermission({} as never)).toBe('ask')
    expect(x.needsPermission({} as never)).toBe('none')
    expect(i.needsPermission({} as never)).toBe('none')
  })

  it('declares plan-related searchHints so the activation algorithm can pick them up', () => {
    const t = makeEnterPlanModeTool(new PlanModeState())
    expect(t.searchHint).toContain('plan')
    expect(t.searchHint).toContain('planning')
  })
})

// ─── EnterPlanMode tool behaviour ─────────────────────────────────────

describe('EnterPlanMode tool', () => {
  it('flips the shared state to active and returns a confirmation', async () => {
    const state = new PlanModeState()
    const tool = makeEnterPlanModeTool(state)
    expect(state.isActive()).toBe(false)
    const r = await tool.run({}, mkCtx())
    expect(r.isError).toBe(false)
    expect(state.isActive()).toBe(true)
    const payload = JSON.parse(r.output as string) as EnterPlanModeResult
    expect(payload.action).toBe('enter')
    expect(payload.active).toBe(true)
    expect(payload.message).toContain('Plan mode entered')
  })

  it('idempotent: calling enter twice keeps state active and annotates the message', async () => {
    const state = new PlanModeState()
    const tool = makeEnterPlanModeTool(state)
    await tool.run({}, mkCtx())
    const r = await tool.run({}, mkCtx())
    const payload = JSON.parse(r.output as string) as EnterPlanModeResult
    expect(state.isActive()).toBe(true)
    expect(payload.action).toBe('enter')
    if (payload.action === 'enter') {
      expect(payload.message).toContain('already in plan mode')
    }
  })
})

// ─── ExitPlanMode tool behaviour ──────────────────────────────────────

describe('ExitPlanMode tool', () => {
  it('records the plan with a fresh timestamp and flips state to inactive', async () => {
    let now = 5_000
    const state = new PlanModeState(() => now)
    const enter = makeEnterPlanModeTool(state)
    const exit = makeExitPlanModeTool(state)
    await enter.run({}, mkCtx())
    now = 5_500
    const r = await exit.run({ plan: 'Plan A\n- step 1\n- step 2' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = JSON.parse(r.output as string) as ExitPlanModeResult
    expect(payload.action).toBe('exit')
    expect(payload.active).toBe(false)
    expect(payload.plan).toBe('Plan A\n- step 1\n- step 2')
    expect(payload.recordedAt).toBe(5_500)
    expect(payload.planCount).toBe(1)
    expect(payload.wasActive).toBe(true)
    expect(state.isActive()).toBe(false)
    expect(state.latestPlan()?.plan).toBe('Plan A\n- step 1\n- step 2')
  })

  it('errors when plan is empty', async () => {
    const state = new PlanModeState()
    const tool = makeExitPlanModeTool(state)
    const r = await tool.run({ plan: '' }, mkCtx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('non-empty')
    expect(state.planCount).toBe(0)
  })

  it('errors when plan is whitespace-only', async () => {
    const state = new PlanModeState()
    const tool = makeExitPlanModeTool(state)
    const r = await tool.run({ plan: '   \n\t' }, mkCtx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('non-empty')
  })

  it('errors when plan is not a string', async () => {
    const state = new PlanModeState()
    const tool = makeExitPlanModeTool(state)
    const r = await tool.run(
      { plan: 42 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('plan')
  })

  it('still records the plan when called without prior enter() and sets wasActive=false', async () => {
    let now = 1
    const state = new PlanModeState(() => now)
    const tool = makeExitPlanModeTool(state)
    const r = await tool.run({ plan: 'orphan' }, mkCtx())
    expect(r.isError).toBe(false)
    const payload = JSON.parse(r.output as string) as ExitPlanModeResult
    expect(payload.wasActive).toBe(false)
    expect(payload.plan).toBe('orphan')
    expect(state.planCount).toBe(1)
  })

  it('successive exits accumulate planCount and refresh latestPlan', async () => {
    let now = 0
    const state = new PlanModeState(() => now)
    const exit = makeExitPlanModeTool(state)
    now = 10
    await exit.run({ plan: 'first' }, mkCtx())
    now = 20
    await exit.run({ plan: 'second' }, mkCtx())
    now = 30
    const r = await exit.run({ plan: 'third' }, mkCtx())
    const payload = JSON.parse(r.output as string) as ExitPlanModeResult
    expect(payload.planCount).toBe(3)
    expect(payload.recordedAt).toBe(30)
    expect(state.latestPlan()?.plan).toBe('third')
  })
})

// ─── IsInPlanMode tool behaviour ──────────────────────────────────────

describe('IsInPlanMode tool', () => {
  it('reflects an inactive state with no plans', async () => {
    const state = new PlanModeState()
    const tool = makeIsInPlanModeTool(state)
    const r = await tool.run({}, mkCtx())
    expect(r.isError).toBe(false)
    const payload = JSON.parse(r.output as string) as IsInPlanModeResult
    expect(payload.active).toBe(false)
    expect(payload.planCount).toBe(0)
    expect(payload.latestPlanAt).toBeUndefined()
  })

  it('reflects active state and latest timestamp after a cycle', async () => {
    let now = 100
    const state = new PlanModeState(() => now)
    const tools = makePlanModeTools(state)
    await tools.enter.run({}, mkCtx())
    now = 200
    await tools.exit.run({ plan: 'finalised plan' }, mkCtx())
    await tools.enter.run({}, mkCtx())
    const r = await tools.status.run({}, mkCtx())
    const payload = JSON.parse(r.output as string) as IsInPlanModeResult
    expect(payload.active).toBe(true)
    expect(payload.planCount).toBe(1)
    expect(payload.latestPlanAt).toBe(200)
  })
})

// ─── Factory helper ───────────────────────────────────────────────────

describe('makePlanModeTools factory', () => {
  it('returns three tools sharing one PlanModeState instance', async () => {
    const state = new PlanModeState(() => 9999)
    const tools = makePlanModeTools(state)
    // Identity check: tools must mutate the supplied state, not a copy.
    await tools.enter.run({}, mkCtx())
    expect(state.isActive()).toBe(true)
    await tools.exit.run({ plan: 'shared' }, mkCtx())
    expect(state.isActive()).toBe(false)
    expect(state.latestPlan()?.plan).toBe('shared')
    const status = await tools.status.run({}, mkCtx())
    const payload = JSON.parse(status.output as string) as IsInPlanModeResult
    expect(payload.active).toBe(false)
    expect(payload.planCount).toBe(1)
    expect(payload.latestPlanAt).toBe(9999)
  })
})
