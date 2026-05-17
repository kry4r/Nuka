// test/core/planMode/planModeWiring.test.ts
//
// Iter ZZZ — integration spec for cli.tsx's `PlanModeState` subscriber.
//
// cli.tsx attaches one listener that translates `PlanModeState` events
// into `Session.mode` mutations + per-cwd `writePlan` calls. We don't
// import cli.tsx directly (it has heavy startup deps); instead we build
// the same wiring inline and check the contract end-to-end:
//
//   EnterPlanMode tool  → state.enter()  → listener → session.mode='plan'
//   ExitPlanMode  tool  → state.exit()   → listener → session.mode='normal'
//                                                  + writePlan(cwd, plan)
//
// If writePlan throws, session.mode must still reset — losing the disk
// copy is bad, leaving the user stuck in plan mode is worse.

import { describe, expect, it, vi } from 'vitest'
import { PlanModeState } from '../../../src/core/planMode/planModeState'
import {
  makeEnterPlanModeTool,
  makeExitPlanModeTool,
} from '../../../src/core/planMode/planModeTools'
import type { Session, SessionMode } from '../../../src/core/session/types'
import type { ToolContext } from '../../../src/core/tools/types'

/**
 * Build a `Session`-shaped object that only exposes the `mode` field
 * (the only field the listener under test touches). We cast through
 * `unknown` to avoid pulling in the full Session deps; this is the
 * same trick `recursion.test.ts` and friends use across the codebase.
 */
function mkSession(initialMode: SessionMode = 'normal'): Session {
  return { mode: initialMode } as unknown as Session
}

function mkCtx(): ToolContext {
  return { signal: new AbortController().signal, cwd: process.cwd() }
}

interface WireOpts {
  session: Session
  cwd: string
  writePlan: (cwd: string, plan: string) => Promise<void>
}

/**
 * Mirror of the wiring cli.tsx installs. Exposed as a helper here so we
 * can exercise the contract without booting the CLI. Returns the state
 * + unsubscribe so tests can detach + verify cleanup.
 */
function wirePlanModeState(opts: WireOpts): {
  state: PlanModeState
  unsubscribe: () => void
} {
  const state = new PlanModeState()
  const unsubscribe = state.subscribe(event => {
    if (event.type === 'enter') {
      opts.session.mode = 'plan'
      return
    }
    if (event.type === 'exit') {
      opts.session.mode = 'normal'
      void opts.writePlan(opts.cwd, event.plan).catch(err => {
        // Mirror cli.tsx: log + swallow; session.mode reset already ran.
        console.error('[plan-mode] failed to persist plan:', err)
      })
      return
    }
    // event.type === 'reset'
    opts.session.mode = 'normal'
  })
  return { state, unsubscribe }
}

describe('PlanModeState ⇄ Session.mode wiring', () => {
  it('EnterPlanMode tool flips session.mode to "plan"', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/proj', writePlan })

    const enter = makeEnterPlanModeTool(state)
    const result = await enter.run({}, mkCtx())

    expect(result.isError).toBe(false)
    expect(session.mode).toBe('plan')
    expect(state.isActive()).toBe(true)
    expect(writePlan).not.toHaveBeenCalled()
  })

  it('ExitPlanMode tool flips session.mode back to "normal" and persists the plan', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/proj', writePlan })

    const enter = makeEnterPlanModeTool(state)
    const exit = makeExitPlanModeTool(state)

    await enter.run({}, mkCtx())
    expect(session.mode).toBe('plan')

    const exitResult = await exit.run({ plan: '# real plan\n- step' }, mkCtx())
    expect(exitResult.isError).toBe(false)

    // session.mode should have flipped synchronously inside the listener.
    expect(session.mode).toBe('normal')
    expect(state.isActive()).toBe(false)

    // writePlan is called via a non-awaited promise; flush microtasks.
    await new Promise(resolve => setImmediate(resolve))
    expect(writePlan).toHaveBeenCalledTimes(1)
    expect(writePlan).toHaveBeenCalledWith('/proj', '# real plan\n- step')
  })

  it('a writePlan failure does NOT block the session.mode reset', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = mkSession('plan')
    const writePlan = vi.fn().mockRejectedValue(new Error('disk full'))
    const { state } = wirePlanModeState({ session, cwd: '/proj', writePlan })

    // Pre-seed: imagine enter already ran.
    state.enter()
    expect(session.mode).toBe('plan')

    const exit = makeExitPlanModeTool(state)
    const result = await exit.run({ plan: 'p' }, mkCtx())

    // Mode reset is synchronous in the listener; it must hold even
    // when writePlan rejects later.
    expect(result.isError).toBe(false)
    expect(session.mode).toBe('normal')

    // Give the rejected promise a chance to land in the catch handler.
    await new Promise(resolve => setImmediate(resolve))
    expect(writePlan).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('an enter-then-enter (idempotent) does not call writePlan or double-flip', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/x', writePlan })

    const enter = makeEnterPlanModeTool(state)
    await enter.run({}, mkCtx())
    await enter.run({}, mkCtx())
    await enter.run({}, mkCtx())

    expect(session.mode).toBe('plan')
    expect(writePlan).not.toHaveBeenCalled()
  })

  it('ExitPlanMode without prior EnterPlanMode still resets mode + persists', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/x', writePlan })

    const exit = makeExitPlanModeTool(state)
    const result = await exit.run({ plan: 'orphan' }, mkCtx())

    expect(result.isError).toBe(false)
    expect(session.mode).toBe('normal')
    await new Promise(resolve => setImmediate(resolve))
    expect(writePlan).toHaveBeenCalledWith('/x', 'orphan')
  })

  it('unsubscribe stops further session.mode mutations', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state, unsubscribe } = wirePlanModeState({
      session,
      cwd: '/x',
      writePlan,
    })

    unsubscribe()

    const enter = makeEnterPlanModeTool(state)
    await enter.run({}, mkCtx())

    // Listener detached — session is unchanged.
    expect(session.mode).toBe('normal')
    expect(state.isActive()).toBe(true)
  })

  it('reset() flips session.mode back to normal without calling writePlan', () => {
    const session = mkSession('plan')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/x', writePlan })

    state.enter()
    state.reset()

    expect(session.mode).toBe('normal')
    expect(writePlan).not.toHaveBeenCalled()
  })

  it('cwd captured at wire-time is used for every writePlan call', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({
      session,
      cwd: '/captured-cwd',
      writePlan,
    })

    const exit = makeExitPlanModeTool(state)
    await exit.run({ plan: 'A' }, mkCtx())
    await exit.run({ plan: 'B' }, mkCtx())

    await new Promise(resolve => setImmediate(resolve))
    expect(writePlan).toHaveBeenNthCalledWith(1, '/captured-cwd', 'A')
    expect(writePlan).toHaveBeenNthCalledWith(2, '/captured-cwd', 'B')
  })

  it('full enter/exit cycle restores session to a normal-mode baseline', async () => {
    const session = mkSession('normal')
    const writePlan = vi.fn().mockResolvedValue(undefined)
    const { state } = wirePlanModeState({ session, cwd: '/x', writePlan })

    const enter = makeEnterPlanModeTool(state)
    const exit = makeExitPlanModeTool(state)

    await enter.run({}, mkCtx())
    expect(session.mode).toBe('plan')
    await exit.run({ plan: 'done' }, mkCtx())
    expect(session.mode).toBe('normal')
    await enter.run({}, mkCtx())
    expect(session.mode).toBe('plan')
    await exit.run({ plan: 'done2' }, mkCtx())
    expect(session.mode).toBe('normal')

    await new Promise(resolve => setImmediate(resolve))
    expect(writePlan).toHaveBeenCalledTimes(2)
  })
})
