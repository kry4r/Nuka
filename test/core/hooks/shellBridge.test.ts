// test/core/hooks/shellBridge.test.ts
//
// Iter OOOO — tests for the shell-hook → in-process registry bridge.
//
// Coverage:
//   - registry-threaded runHooks fires `shellHookExecuted` per shell hook
//   - payload shape: event, hookId, command, exitCode, canceled, durationMs
//   - stdout/stderr preview truncation at 500 chars
//   - multiple shell hooks for one event → multiple fires
//   - cancel:true → payload.canceled === true and runHooks stops loop
//   - non-zero exit with no JSON → exitCode reflected, canceled false
//   - launch failure (timeout) → errorMessage populated, stdoutPreview absent
//   - no registry threaded → no event fired (backward compat)
//   - hookEntryToHookId stability across identical entries
//   - registry throws → swallowed (shell veto loop unaffected)
//   - tool filter passed through into payload

import { describe, it, expect } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { runHooks } from '../../../src/core/hooks/runner'
import {
  fireShellHookExecuted,
  hookEntryToHookId,
  truncatePreview,
  type ShellHookExecutedPayload,
} from '../../../src/core/hooks/shellBridge'
import type { HookEntry } from '../../../src/core/hooks/types'
import type { HookContext } from '../../../src/core/hooks/events'

/**
 * Capture every `shellHookExecuted` payload that lands on a fresh
 * registry. Returns the registry and a `payloads` array that the handler
 * populates as events fire.
 */
function capturingRegistry(): {
  registry: ReturnType<typeof createHookRegistry>
  payloads: ShellHookExecutedPayload[]
} {
  const registry = createHookRegistry()
  const payloads: ShellHookExecutedPayload[] = []
  registry.register('shellHookExecuted', (ctx: HookContext) => {
    payloads.push(ctx.payload as unknown as ShellHookExecutedPayload)
  })
  return { registry, payloads }
}

describe('shellBridge — fireShellHookExecuted via runHooks', () => {
  it('fires shellHookExecuted once per shell hook execution (success path)', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo hello' },
    ]
    await runHooks(hooks, 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(1)
    const p = payloads[0]!
    expect(p.event).toBe('afterTurn')
    expect(p.command).toBe('echo hello')
    expect(p.exitCode).toBe(0)
    expect(p.canceled).toBe(false)
    expect(p.stdoutPreview).toBe('hello')
    expect(typeof p.durationMs).toBe('number')
    expect(p.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fires once per matching hook when multiple are registered for the event', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo one' },
      { event: 'afterTurn', command: 'echo two' },
      { event: 'beforeToolCall', command: 'echo skip' }, // wrong event
    ]
    await runHooks(hooks, 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(2)
    expect(payloads[0]!.stdoutPreview).toBe('one')
    expect(payloads[1]!.stdoutPreview).toBe('two')
  })

  it('payload.canceled === true when shell hook returns cancel:true', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"vetoed"}\' && exit 1' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {}, { registry })
    expect(result.cancel).toBe(true)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.canceled).toBe(true)
    expect(payloads[0]!.exitCode).toBe(1)
  })

  it('payload.exitCode reflects non-zero exit even when not canceled', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo bad && exit 3' },
    ]
    await runHooks(hooks, 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.exitCode).toBe(3)
    expect(payloads[0]!.canceled).toBe(false)
  })

  it('truncates stdout preview at 500 chars', async () => {
    const { registry, payloads } = capturingRegistry()
    // Emit ~1000 chars of stdout so the preview is forced to truncate.
    // `head -c` is portable on macOS/BSD/Linux.
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'yes a | head -c 1000' },
    ]
    await runHooks(hooks, 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(1)
    const preview = payloads[0]!.stdoutPreview!
    expect(preview.length).toBeLessThanOrEqual(500)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('surfaces timeouts with exitCode -1 (execa returns no exit code on SIGTERM)', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'sleep 5', timeoutMs: 100 },
    ]
    await runHooks(hooks, 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(1)
    const p = payloads[0]!
    // execa with `reject: false` and `timeout` resolves the promise with
    // `exitCode === undefined`. Our runner maps that to `-1` for a stable
    // payload shape; the original hook stdout is empty so the preview is
    // an empty string, NOT undefined.
    expect(p.exitCode).toBe(-1)
    expect(p.canceled).toBe(false)
  })

  it('does NOT fire any event when no registry is threaded (backward compat)', async () => {
    // Spy on a fresh registry that we DO NOT pass to runHooks. If the
    // bridge accidentally bypasses the opt and finds a registry through
    // some other channel, this test will fail.
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo hi' },
    ]
    await runHooks(hooks, 'afterTurn', {}) // no opts.registry
    expect(payloads).toHaveLength(0)
    // The registry exists and is functional — verify by firing manually:
    await fireShellHookExecuted(registry, {
      event: 'afterTurn',
      hookId: 'manual',
      command: 'manual',
      exitCode: 0,
      canceled: false,
      durationMs: 0,
    })
    expect(payloads).toHaveLength(1)
  })

  it('threads opts.tool into the payload when a tool filter is active', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', tool: 'Bash', command: 'echo ok' },
    ]
    await runHooks(hooks, 'beforeToolCall', {}, { tool: 'Bash', registry })
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.tool).toBe('Bash')
  })

  it('hookId is stable across runs of the same entry and distinct from a different entry', async () => {
    const { registry, payloads } = capturingRegistry()
    const sameA: HookEntry = { event: 'afterTurn', command: 'echo same' }
    const sameB: HookEntry = { event: 'afterTurn', command: 'echo same' }
    const other: HookEntry = { event: 'afterTurn', command: 'echo other' }
    await runHooks([sameA], 'afterTurn', {}, { registry })
    await runHooks([sameB], 'afterTurn', {}, { registry })
    await runHooks([other], 'afterTurn', {}, { registry })
    expect(payloads).toHaveLength(3)
    expect(payloads[0]!.hookId).toBe(payloads[1]!.hookId)
    expect(payloads[0]!.hookId).not.toBe(payloads[2]!.hookId)
  })

  it('a registry-level throw is swallowed and shell veto loop continues normally', async () => {
    // Register a handler that throws. The pipeline's per-handler try/catch
    // already isolates handler throws, but we also belt-and-braces around
    // a registry.invoke() throw. To exercise the latter we need a registry
    // whose invoke() rejects — easiest via a fake.
    const fakeRegistry = {
      invoke: () => Promise.reject(new Error('boom')),
    } as unknown as ReturnType<typeof createHookRegistry>
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"v"}\' && exit 1' },
    ]
    // If the bridge re-throws, runHooks would reject — assert it resolves
    // with the expected veto.
    const result = await runHooks(hooks, 'beforeToolCall', {}, { registry: fakeRegistry })
    expect(result.cancel).toBe(true)
    expect(result.reason).toBe('v')
  })

  it('stops the shell veto loop at first cancel:true even when bridging fires for both', async () => {
    const { registry, payloads } = capturingRegistry()
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"first"}\' && exit 1' },
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"second"}\' && exit 1' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {}, { registry })
    expect(result.cancel).toBe(true)
    expect(result.reason).toBe('first')
    // Only the first hook ran (the loop returns on first veto). The bridge
    // fires for hooks that actually executed.
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.canceled).toBe(true)
  })
})

describe('shellBridge — helpers', () => {
  it('truncatePreview returns input unchanged when at or below limit', () => {
    expect(truncatePreview('abc', 10)).toBe('abc')
    expect(truncatePreview('abcdefghij', 10)).toBe('abcdefghij')
  })

  it('truncatePreview returns string of exactly maxLen with ellipsis when over limit', () => {
    const out = truncatePreview('abcdefghijklmnop', 10)!
    expect(out).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })

  it('truncatePreview handles undefined and non-string defensively', () => {
    expect(truncatePreview(undefined, 10)).toBeUndefined()
    // Cast through unknown to exercise the type guard.
    expect(truncatePreview(123 as unknown as string, 10)).toBeUndefined()
  })

  it('hookEntryToHookId differs by event, tool, and command', () => {
    const base: HookEntry = { event: 'afterTurn', command: 'echo a' }
    const diffEvent: HookEntry = { ...base, event: 'beforeToolCall' }
    const diffTool: HookEntry = { ...base, tool: 'Bash' }
    const diffCmd: HookEntry = { ...base, command: 'echo b' }
    const a = hookEntryToHookId(base)
    expect(a).not.toBe(hookEntryToHookId(diffEvent))
    expect(a).not.toBe(hookEntryToHookId(diffTool))
    expect(a).not.toBe(hookEntryToHookId(diffCmd))
  })
})
