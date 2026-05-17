// test/core/awaySummary/idleHook.test.ts
//
// Iter RR — covers `startIdleAwaySummaryHook` end-to-end with fake
// timers and a stubbed runner. Asserts:
//
//   • The runner fires after `thresholdMs` has elapsed AND the next
//     `poke()` simulates "user returned".
//   • A null transcript path skips the runner entirely.
//   • The runner is invoked with the *current* transcript (snapshot
//     happens at trigger time, not hook-construction time).
//   • Recap text is routed to the recap sink with a back-after-Xs prefix.
//   • Runner rejection is swallowed and routed to the error sink — does
//     not throw out of the idle loop.
//   • `stop()` aborts any in-flight runner call.

import { describe, it, expect, vi } from 'vitest'
import { startIdleAwaySummaryHook } from '../../../src/core/awaySummary/idleHook'
import type { AwaySummaryRunner } from '../../../src/core/awaySummary/runner'
import type { AwaySummaryResult } from '../../../src/core/awaySummary/summary'
import { makeUserMessage } from '../../../src/core/message/factories'

function makeRunner(
  impl: (signal: AbortSignal) => Promise<AwaySummaryResult | null>,
): { runner: AwaySummaryRunner; getCalls: () => number } {
  let calls = 0
  const runner: AwaySummaryRunner = async ({ signal }) => {
    calls++
    return impl(signal)
  }
  return { runner, getCalls: () => calls }
}

// Drain N microtask ticks so fire-and-forget runner promises settle
// without pumping the watcher's self-scheduling setTimeout chain
// (which is unbounded under `vi.runAllTimersAsync()`).
async function drainMicrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

describe('startIdleAwaySummaryHook', () => {
  it('throws synchronously when runner is missing', () => {
    expect(() =>
      startIdleAwaySummaryHook({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runner: undefined as any,
        getMessages: () => [],
      }),
    ).toThrowError(/runner/i)
  })

  it('throws when getMessages is missing', () => {
    const { runner } = makeRunner(async () => null)
    expect(() =>
      startIdleAwaySummaryHook({
        runner,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMessages: undefined as any,
      }),
    ).toThrowError(/getMessages/i)
  })

  it('throws on non-positive thresholdMs', () => {
    const { runner } = makeRunner(async () => null)
    expect(() =>
      startIdleAwaySummaryHook({
        runner,
        getMessages: () => [],
        thresholdMs: 0,
      }),
    ).toThrowError(/threshold/i)
  })

  it('fires the runner on poke-after-idle and routes recap text', async () => {
    vi.useFakeTimers()
    const { runner, getCalls } = makeRunner(async () => ({
      text: 'Recap: you were rebasing the harness.',
      modelUsed: 'fake',
      truncated: false,
    }))
    const recapSink = vi.fn()
    const messages = [makeUserMessage({ text: 'fix the bug' })]

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => messages,
      thresholdMs: 1000,
      onRecap: recapSink,
    })

    await vi.advanceTimersByTimeAsync(1500)
    // onAway has fired now (internal). Simulate return.
    hook.poke()
    await drainMicrotasks()

    expect(getCalls()).toBe(1)
    expect(recapSink).toHaveBeenCalledTimes(1)
    const line = recapSink.mock.calls[0]![0] as string
    expect(line).toMatch(/awaySummary \| back after \d+s/)
    expect(line).toContain('Recap: you were rebasing the harness.')

    hook.stop()
    vi.useRealTimers()
  })

  it('skips the runner when transcript is empty', async () => {
    vi.useFakeTimers()
    const { runner, getCalls } = makeRunner(async () => null)
    const recapSink = vi.fn()

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [],
      thresholdMs: 1000,
      onRecap: recapSink,
    })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()

    expect(getCalls()).toBe(0)
    expect(recapSink).not.toHaveBeenCalled()

    hook.stop()
    vi.useRealTimers()
  })

  it('snapshots the live transcript at trigger time, not at hook-construction', async () => {
    vi.useFakeTimers()
    let messages: readonly ReturnType<typeof makeUserMessage>[] = []
    const seen: number[] = []
    const { runner } = makeRunner(async () => {
      // Record the snapshot size at the moment the runner sees it.
      seen.push(messages.length)
      return null
    })

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => messages,
      thresholdMs: 500,
    })

    // First trigger: empty transcript → runner skipped (length 0 path).
    await vi.advanceTimersByTimeAsync(700)
    hook.poke()
    await drainMicrotasks()

    // Grow the transcript and trigger again.
    messages = [makeUserMessage({ text: 'a' }), makeUserMessage({ text: 'b' })]
    await vi.advanceTimersByTimeAsync(700)
    hook.poke()
    await drainMicrotasks()

    expect(seen).toEqual([2])

    hook.stop()
    vi.useRealTimers()
  })

  it('routes runner errors to the error sink, does not crash', async () => {
    vi.useFakeTimers()
    const { runner, getCalls } = makeRunner(async () => {
      throw new Error('boom')
    })
    const errorSink = vi.fn()
    const recapSink = vi.fn()

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [makeUserMessage({ text: 'x' })],
      thresholdMs: 1000,
      onRecap: recapSink,
      onError: errorSink,
    })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()

    expect(getCalls()).toBe(1)
    expect(recapSink).not.toHaveBeenCalled()
    expect(errorSink).toHaveBeenCalledTimes(1)
    expect(errorSink.mock.calls[0]![0] as string).toContain('boom')

    hook.stop()
    vi.useRealTimers()
  })

  it('stop() aborts an in-flight runner call', async () => {
    vi.useFakeTimers()
    let observedAbort = false
    const { runner } = makeRunner(
      (signal) =>
        new Promise<AwaySummaryResult | null>((resolve) => {
          signal.addEventListener('abort', () => {
            observedAbort = true
            resolve(null)
          })
        }),
    )
    const recapSink = vi.fn()

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [makeUserMessage({ text: 'x' })],
      thresholdMs: 1000,
      onRecap: recapSink,
    })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    // Drain a microtask so the runner promise is created and the abort
    // listener is wired.
    await Promise.resolve()
    // Stop should abort it.
    hook.stop()
    await drainMicrotasks()

    expect(observedAbort).toBe(true)
    expect(recapSink).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  // ─── Iter NNNN — typed recap event subscribers ───────────────────────

  it('fans out a typed AwayRecapEvent to onRecapResult subscribers', async () => {
    vi.useFakeTimers()
    const { runner } = makeRunner(async () => ({
      text: 'Recap text.',
      tokensUsed: 120,
      modelUsed: 'claude-haiku-4-5-20251001',
    }))
    const recapSink = vi.fn()
    const events: Array<{ text: string; idleMs: number; tokensUsed: number; modelUsed: string }> = []

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [makeUserMessage({ text: 'x' })],
      thresholdMs: 1000,
      onRecap: recapSink,
    })
    const unsub = hook.onRecapResult((event) => events.push(event))

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()

    expect(events.length).toBe(1)
    expect(events[0]!.text).toBe('Recap text.')
    expect(events[0]!.tokensUsed).toBe(120)
    expect(events[0]!.modelUsed).toBe('claude-haiku-4-5-20251001')
    expect(events[0]!.idleMs).toBeGreaterThanOrEqual(1000)
    // The string sink is invoked alongside the typed listener.
    expect(recapSink).toHaveBeenCalledTimes(1)

    unsub()
    hook.stop()
    vi.useRealTimers()
  })

  it('unsubscribe removes the listener and stop() clears all listeners', async () => {
    vi.useFakeTimers()
    const { runner } = makeRunner(async () => ({
      text: 'Recap text.',
      tokensUsed: 0,
      modelUsed: 'fake',
    }))
    const eventsA: number[] = []
    const eventsB: number[] = []

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [makeUserMessage({ text: 'x' })],
      thresholdMs: 1000,
    })
    const unsubA = hook.onRecapResult(() => { eventsA.push(1) })
    hook.onRecapResult(() => { eventsB.push(1) })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()
    expect(eventsA.length).toBe(1)
    expect(eventsB.length).toBe(1)

    unsubA()
    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()
    // A is unsubscribed; B still gets the second event.
    expect(eventsA.length).toBe(1)
    expect(eventsB.length).toBe(2)

    hook.stop()
    vi.useRealTimers()
  })

  it('isolates listener throws — one broken listener does not stop the others', async () => {
    vi.useFakeTimers()
    const { runner } = makeRunner(async () => ({
      text: 'Recap text.',
      tokensUsed: 0,
      modelUsed: 'fake',
    }))
    const errorSink = vi.fn()
    const eventsGood: number[] = []

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [makeUserMessage({ text: 'x' })],
      thresholdMs: 1000,
      onError: errorSink,
    })
    hook.onRecapResult(() => {
      throw new Error('listener exploded')
    })
    hook.onRecapResult(() => {
      eventsGood.push(1)
    })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()

    // Good listener still fired despite the bad one throwing.
    expect(eventsGood.length).toBe(1)
    // The throw was routed to the error sink.
    expect(errorSink).toHaveBeenCalledTimes(1)
    expect(errorSink.mock.calls[0]![0] as string).toContain('listener exploded')

    hook.stop()
    vi.useRealTimers()
  })

  it('does not fire onRecapResult when transcript is empty (no recap path)', async () => {
    vi.useFakeTimers()
    const { runner } = makeRunner(async () => null)
    const events: number[] = []

    const hook = startIdleAwaySummaryHook({
      runner,
      getMessages: () => [],
      thresholdMs: 1000,
    })
    hook.onRecapResult(() => { events.push(1) })

    await vi.advanceTimersByTimeAsync(1500)
    hook.poke()
    await drainMicrotasks()

    expect(events.length).toBe(0)
    hook.stop()
    vi.useRealTimers()
  })
})
