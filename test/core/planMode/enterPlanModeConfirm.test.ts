// test/core/planMode/enterPlanModeConfirm.test.ts
//
// Iter LLLL — re-targeted spec for `EnterPlanMode`'s confirmation
// pathway.
//
// History:
//   - YYY/ZZZ shipped EnterPlanMode as an unconditional state mutator.
//   - FFFF bolted a schema-level `confirm: boolean` field onto the tool
//     input because `PermissionHint` had no `'ask'` variant; the
//     "asking" phase therefore lived in the tool body.
//   - LLLL extends `PermissionHint` with `'ask'` (see
//     `src/core/tools/types.ts`) so confirmation can live in the
//     permission layer where it belongs. The tool's `run()` is now a
//     straight commit — the `PermissionChecker` routes through
//     `askUser` first, and if the user rejects, `run()` never fires.
//
// What this file pins:
//   - `EnterPlanMode.needsPermission(...)` returns `'ask'`.
//   - The tool's input schema no longer carries `confirm` and rejects
//     extra properties (`additionalProperties: false`).
//   - The `PermissionChecker` + tool, wired the way the agent loop
//     does, exhibits the user-facing behaviour: approve flips state,
//     reject leaves it untouched.
//
// What this file does NOT cover (owned by sibling specs):
//   - The full enter/exit lifecycle (planMode.test.ts).
//   - The Session.mode wiring (planModeWiring.test.ts).
//   - The listener API itself (planModeSubscribe.test.ts).
//   - `'ask'` hint semantics in the checker itself
//     (test/core/permission/checker.test.ts).

import { describe, expect, it, vi } from 'vitest'
import { PlanModeState, type PlanModeEvent } from '../../../src/core/planMode/planModeState'
import {
  makeEnterPlanModeTool,
  type EnterPlanModeResult,
} from '../../../src/core/planMode/planModeTools'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { PermissionPayload } from '../../../src/core/permission/bridge'
import type { ToolContext } from '../../../src/core/tools/types'
import type { ToolResult } from '../../../src/core/tools/types'

function mkCtx(): ToolContext {
  return { signal: new AbortController().signal, cwd: process.cwd() }
}

function decode(result: { output: string | unknown }): EnterPlanModeResult {
  return JSON.parse(result.output as string) as EnterPlanModeResult
}

/**
 * Mirror of the agent loop's "check then run" pattern so we can pin
 * the contract end-to-end without booting the full loop. Returns the
 * same shape the loop synthesises into a `tool_result`: either the
 * tool's own `ToolResult`, or a "Rejected: …" envelope.
 */
async function checkAndRun(
  checker: PermissionChecker,
  state: PlanModeState,
): Promise<ToolResult> {
  const tool = makeEnterPlanModeTool(state)
  const decision = await checker.check({
    toolName: tool.name,
    hint: tool.needsPermission({}),
    input: {},
    annotations: tool.annotations,
  })
  if (!decision.allowed) {
    return { isError: true, output: `Rejected: ${decision.reason ?? 'user denied'}` }
  }
  return tool.run({}, mkCtx())
}

describe('EnterPlanMode — tool surface', () => {
  it('declares needsPermission() === "ask"', () => {
    const tool = makeEnterPlanModeTool(new PlanModeState())
    expect(tool.needsPermission({})).toBe('ask')
  })

  it('exposes an empty parameters schema with additionalProperties:false', () => {
    const tool = makeEnterPlanModeTool(new PlanModeState())
    const params = tool.parameters as {
      properties?: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
    }
    // The FFFF `confirm` field is gone — confirmation lives at the
    // permission layer now.
    expect(params.properties).toEqual({})
    expect(params.required ?? []).toEqual([])
    expect(params.additionalProperties).toBe(false)
  })

  it('description mentions that the user is prompted (not a self-confirmation ritual)', () => {
    const tool = makeEnterPlanModeTool(new PlanModeState())
    // The agent must know rejection comes back as a tool_result, not a
    // schema-level `confirm: true` re-call.
    expect(tool.description.toLowerCase()).toContain('confirm')
    expect(tool.description.toLowerCase()).not.toContain('confirm: true')
  })
})

describe('EnterPlanMode — PermissionChecker wiring (approval path)', () => {
  it('routes to askUser on the first call (no prior cache rule)', async () => {
    const ask = vi
      .fn<(p: PermissionPayload) => Promise<{ allowed: boolean }>>()
      .mockResolvedValue({ allowed: true })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const state = new PlanModeState()

    const result = await checkAndRun(checker, state)

    expect(ask).toHaveBeenCalledOnce()
    // The payload the UI receives — toolName + hint flow through unchanged.
    const payload = ask.mock.calls[0]![0]
    expect(payload.call.toolName).toBe('EnterPlanMode')
    expect(payload.call.hint).toBe('ask')

    expect(result.isError).toBe(false)
    expect(decode(result).action).toBe('enter')
    expect(state.isActive()).toBe(true)
  })

  it('approval fires the enter event exactly once', async () => {
    const events: PlanModeEvent[] = []
    const ask = vi.fn().mockResolvedValue({ allowed: true })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const state = new PlanModeState()
    state.subscribe(e => events.push(e))

    await checkAndRun(checker, state)

    expect(events).toEqual<PlanModeEvent[]>([{ type: 'enter' }])
  })

  it('a remembered "always for ask in this session" rule short-circuits askUser', async () => {
    const cache = new PermissionCache()
    cache.add({ scope: 'session', hint: 'ask' })
    const ask = vi.fn()
    const checker = new PermissionChecker(() => cache, ask)
    const state = new PlanModeState()

    const result = await checkAndRun(checker, state)

    // Critical contract: a previously remembered rule must work for
    // 'ask' the same way it does for 'write' / 'exec' — no second
    // prompt.
    expect(ask).not.toHaveBeenCalled()
    expect(result.isError).toBe(false)
    expect(decode(result).action).toBe('enter')
    expect(state.isActive()).toBe(true)
  })
})

describe('EnterPlanMode — PermissionChecker wiring (rejection path)', () => {
  it('rejection short-circuits run() — state stays untouched', async () => {
    const ask = vi
      .fn<(p: PermissionPayload) => Promise<{ allowed: boolean; reason?: string }>>()
      .mockResolvedValue({ allowed: false, reason: 'user said no' })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const state = new PlanModeState()

    const result = await checkAndRun(checker, state)

    expect(ask).toHaveBeenCalledOnce()
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Rejected')
    expect(result.output).toContain('user said no')

    // The critical invariant from FFFF — a rejected call must NOT
    // mutate PlanModeState.
    expect(state.isActive()).toBe(false)
    expect(state.planCount).toBe(0)
  })

  it('rejection fires no PlanModeState events', async () => {
    const events: PlanModeEvent[] = []
    const ask = vi.fn().mockResolvedValue({ allowed: false, reason: 'no' })
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const state = new PlanModeState()
    state.subscribe(e => events.push(e))

    await checkAndRun(checker, state)

    // No mutation = no event. The ZZZ wiring depends on this — Session.mode
    // must not flip when the user rejects EnterPlanMode.
    expect(events).toEqual([])
  })

  it('rejection followed by approval ends up in plan mode (state machine resumes cleanly)', async () => {
    let nextDecision: { allowed: boolean; reason?: string } = {
      allowed: false,
      reason: 'no',
    }
    const ask = vi.fn(async () => nextDecision)
    const checker = new PermissionChecker(() => new PermissionCache(), ask)
    const state = new PlanModeState()

    // 1) Reject.
    const r1 = await checkAndRun(checker, state)
    expect(r1.isError).toBe(true)
    expect(state.isActive()).toBe(false)

    // 2) Approve next time.
    nextDecision = { allowed: true }
    const r2 = await checkAndRun(checker, state)
    expect(r2.isError).toBe(false)
    expect(decode(r2).action).toBe('enter')
    expect(state.isActive()).toBe(true)

    // Exactly two prompts — no extra round-trips on either side.
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
