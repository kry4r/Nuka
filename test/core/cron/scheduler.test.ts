// test/core/cron/scheduler.test.ts
//
// Practical Iter GGGG — REPL-side cron tick.
//
// Covers:
//   - tickNow with no tasks: no fire, no throw
//   - due recurring task → fire called once per tick with (id, task, now)
//   - not-due task → fire NOT called
//   - one-shot task → fired, then removed from store, then NOT refired
//   - recurring task → after a fire, lastFiredAt advances; next due
//     computation respects the new anchor
//   - multiple due tasks in one tick → fire called for each (sequentially)
//   - fire throws → onError fired, scheduler keeps running, next task in
//     the same tick still gets fired, next tick still works
//   - overlapping ticks prevented when fire is slow
//   - start() / stop() drive the setInterval (fake timers)
//   - stop() is idempotent
//   - start() is idempotent (second call is a no-op)
//   - custom clock used (deterministic — no Date.now reads)
//   - custom intervalMs respected
//   - tickNow works without start()
//   - invalid cron in a hand-edited persist file → not fired (defensive)
//   - tasks added during a fire callback are deferred to the next tick

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  CronScheduler,
  DEFAULT_CRON_TICK_INTERVAL_MS,
} from '../../../src/core/cron/scheduler'
import { createCronStore } from '../../../src/core/cron/store'

describe('CronScheduler — construction', () => {
  it('throws without registry', () => {
    expect(
      () =>
        new CronScheduler({
          // @ts-expect-error — exercising the runtime guard
          registry: undefined,
          fire: async () => {},
        }),
    ).toThrow(/registry/)
  })

  it('throws without fire', () => {
    const registry = createCronStore()
    expect(
      () =>
        new CronScheduler({
          registry,
          // @ts-expect-error — exercising the runtime guard
          fire: undefined,
        }),
    ).toThrow(/fire/)
  })

  it('rejects non-positive intervals', () => {
    const registry = createCronStore()
    expect(
      () =>
        new CronScheduler({
          registry,
          fire: async () => {},
          intervalMs: 0,
        }),
    ).toThrow(/intervalMs/)
    expect(
      () =>
        new CronScheduler({
          registry,
          fire: async () => {},
          intervalMs: -10,
        }),
    ).toThrow(/intervalMs/)
    expect(
      () =>
        new CronScheduler({
          registry,
          fire: async () => {},
          intervalMs: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/intervalMs/)
  })
})

describe('CronScheduler — tickNow without start()', () => {
  // Anchor `now` at a stable wall clock. Tasks are added with `now: nowMs`
  // so we know exactly when their first cron match falls.
  const nowMs = new Date('2026-05-17T12:00:00').getTime()
  let clockMs = nowMs
  const clock = () => clockMs

  beforeEach(() => {
    clockMs = nowMs
  })

  it('is a no-op when no tasks are registered', async () => {
    const registry = createCronStore()
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    await scheduler.tickNow()
    expect(fire).not.toHaveBeenCalled()
  })

  it('fires a due recurring task with (id, task, firedAt)', async () => {
    const registry = createCronStore()
    // "every minute" is the easiest "due immediately after createdAt" case.
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    // Advance clock to one minute past creation — the next fire (minute
    // 12:01) is now in the past.
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
    const [taskId, taskArg, firedAt] = fire.mock.calls[0]!
    expect(taskId).toBe(task.id)
    expect(taskArg.id).toBe(task.id)
    expect(firedAt).toBe(clockMs)
  })

  it('does not fire a task whose next-run is still in the future', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    // Tick BEFORE the next minute boundary — task should not fire.
    clockMs = nowMs + 30_000
    await scheduler.tickNow()
    expect(fire).not.toHaveBeenCalled()
  })

  it('removes a one-shot task after a successful fire', async () => {
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'reminder',
      recurring: false,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
    expect(registry.get(task.id)).toBeUndefined()
    // A second tick has no work to do — task is gone.
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('advances lastFiredAt for recurring tasks so re-fire respects the schedule', async () => {
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    // First tick at 12:01:30 → fires once.
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
    expect(scheduler.__getLastFiredAtForTests(task.id)).toBe(clockMs)
    // Second tick 10 seconds later → no new fire (next minute boundary
    // hasn't been crossed yet relative to the new anchor).
    clockMs = nowMs + 100_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
    // Third tick well past the next minute → fires again.
    clockMs = nowMs + 180_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('fires multiple due tasks in one tick, sequentially', async () => {
    const registry = createCronStore()
    const t1 = registry.add({
      cron: '* * * * *',
      prompt: 'one',
      recurring: true,
      now: nowMs,
    })
    const t2 = registry.add({
      cron: '* * * * *',
      prompt: 'two',
      recurring: true,
      now: nowMs,
    })
    const order: string[] = []
    const fire = vi.fn(async (id: string) => {
      order.push(id)
      // Simulate a small async hop so we can verify sequential ordering.
      await Promise.resolve()
    })
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(2)
    // Order matches store.list() order; we don't lock the iteration
    // semantics here — just verify both fired.
    expect(order.sort()).toEqual([t1.id, t2.id].sort())
  })

  it('keeps running when a fire throws — same tick keeps going', async () => {
    const registry = createCronStore()
    const t1 = registry.add({
      cron: '* * * * *',
      prompt: 'bad',
      recurring: true,
      now: nowMs,
    })
    const t2 = registry.add({
      cron: '* * * * *',
      prompt: 'good',
      recurring: true,
      now: nowMs,
    })
    const errors: string[] = []
    const fire = vi.fn(async (id: string) => {
      if (id === t1.id) throw new Error('boom')
    })
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      onError: (line) => errors.push(line),
    })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    // Both tasks attempted; the second one isn't blocked by the first's throw.
    expect(fire).toHaveBeenCalledTimes(2)
    expect(errors.some((e) => e.includes('boom'))).toBe(true)
    // The failing task did NOT advance lastFiredAt — the next tick will
    // try again. This is the conservative cron behaviour: missed once,
    // try again next tick.
    expect(scheduler.__getLastFiredAtForTests(t1.id)).toBeUndefined()
    // Good task did advance.
    expect(scheduler.__getLastFiredAtForTests(t2.id)).toBe(clockMs)
  })

  it('overlapping tickNow calls are skipped, not queued', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'slow',
      recurring: true,
      now: nowMs,
    })
    let resolveFire: (() => void) | null = null
    const fire = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFire = resolve
        }),
    )
    const errors: string[] = []
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      onError: (line) => errors.push(line),
    })
    clockMs = nowMs + 90_000
    // Start a tick — the fire is intentionally pending.
    const first = scheduler.tickNow()
    // While the first tick is mid-flight, kick off another.
    await scheduler.tickNow()
    expect(errors.some((e) => e.includes('skipped'))).toBe(true)
    // Fire was called exactly once (from the first tick) — second tick
    // bailed because of the overlap guard.
    expect(fire).toHaveBeenCalledTimes(1)
    // Release the first tick and let it complete.
    resolveFire!()
    await first
  })

  it('defensive: invalid cron from a hand-edited persist file is not fired', async () => {
    const registry = createCronStore()
    // Bypass the tool-layer validation by hydrating directly. The persist
    // layer would normally drop this row at load time (it round-trips
    // through `parseCronExpression`), so this is genuinely a "what if
    // something slips past every layer" guard.
    registry.hydrate([
      {
        id: 'badid',
        // Valid cron syntax that matches no calendar date in 366 days
        // is rejected by `nextCronRunMs`. Use month=2, day=30 — Feb 30
        // never exists. Parser accepts the syntactic shape; nextCronRunMs
        // returns null after the year-long walk.
        cron: '0 0 30 2 *',
        prompt: 'should not fire',
        createdAt: nowMs,
        recurring: true,
      },
    ])
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 86_400_000 // a day later
    await scheduler.tickNow()
    expect(fire).not.toHaveBeenCalled()
  })

  it('tasks added during a fire callback are deferred to the next tick', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'first',
      recurring: false,
      now: nowMs,
    })
    const fire = vi.fn(async () => {
      // Simulate a "fire-injects-followup" pattern.
      registry.add({
        cron: '* * * * *',
        prompt: 'followup',
        recurring: false,
        now: nowMs,
      })
    })
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    // Only the original task fired in this tick.
    expect(fire).toHaveBeenCalledTimes(1)
    // The follow-up task is in the store, ready for the next tick.
    expect(registry.size()).toBe(1)
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(2)
  })
})

// Iter HHHH: scheduler routes fire history through the registry so the
// anchor survives a restart. These tests verify the registry integration
// path that replaced the in-memory Map.
describe('CronScheduler — lastFiredAt persistence (Iter HHHH)', () => {
  const nowMs = new Date('2026-05-17T12:00:00').getTime()
  let clockMs = nowMs
  const clock = () => clockMs

  beforeEach(() => {
    clockMs = nowMs
  })

  it('fire advances task.lastFiredAt on the registry (not a private map)', async () => {
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    // The registry's task now carries the timestamp — that's what gets
    // flushed to disk in durable mode.
    expect(registry.get(task.id)?.lastFiredAt).toBe(clockMs)
  })

  it('scheduler invokes registry.updateLastFiredAt with (id, firedAt)', async () => {
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const spy = vi.spyOn(registry, 'updateLastFiredAt')
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(spy).toHaveBeenCalledWith(task.id, clockMs)
  })

  it('rehydrated task with lastFiredAt does NOT re-fire if anchor is recent', async () => {
    // Simulate a restart: hydrate an hourly task whose lastFiredAt is at
    // the most recent hour boundary, so the next fire is an hour away.
    const registry = createCronStore()
    registry.hydrate([
      {
        id: 'rehydra1',
        // Hourly — picked so the anchor preference has room to matter.
        // Every-minute crons can't show the difference because any
        // 1-minute-old anchor still lands on "next minute".
        cron: '0 * * * *',
        prompt: 'recently fired',
        createdAt: nowMs - 86_400_000, // a day ago — without the anchor, would be wildly overdue
        lastFiredAt: nowMs, // fired at 12:00 exactly → next fire is 13:00
        recurring: true,
      },
    ])
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 1_000 // 1s after the fire — still within the same hour
    await scheduler.tickNow()
    // Without persisted anchor, this would have fired (createdAt is a
    // day ago, way overdue). With the anchor, the next hour boundary
    // is 13:00 — still in the future.
    expect(fire).not.toHaveBeenCalled()
  })

  it('rehydrated task with old lastFiredAt DOES fire once the next boundary passes', async () => {
    const registry = createCronStore()
    registry.hydrate([
      {
        id: 'rehydra2',
        cron: '0 * * * *',
        prompt: 'overdue post-restart',
        createdAt: nowMs - 86_400_000,
        // Fired 2 hours ago. nowMs is 12:00. The "next hour" after
        // 10:00 is 11:00 — squarely in the past at clockMs=12:00.
        lastFiredAt: nowMs - 7_200_000,
        recurring: true,
      },
    ])
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('rehydrated task without lastFiredAt falls back to createdAt anchor (no regression)', async () => {
    const registry = createCronStore()
    registry.hydrate([
      {
        id: 'rehydra3',
        cron: '* * * * *',
        prompt: 'never fired',
        createdAt: nowMs,
        recurring: true,
        // No lastFiredAt — pre-HHHH behavior should be preserved.
      },
    ])
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    // Cross the next minute boundary relative to createdAt.
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('failed fire does NOT advance lastFiredAt (next tick retries)', async () => {
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'fails',
      recurring: true,
      now: nowMs,
    })
    const errors: string[] = []
    const fire = vi.fn(async () => {
      throw new Error('boom')
    })
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      onError: (line) => errors.push(line),
    })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(fire).toHaveBeenCalledTimes(1)
    expect(errors.some((e) => e.includes('boom'))).toBe(true)
    // Anchor must NOT have advanced — otherwise we'd silently skip
    // retries until the next natural boundary.
    expect(registry.get(task.id)?.lastFiredAt).toBeUndefined()
  })

  it('one-shot task: lastFiredAt is set on the task before remove (atomic-ish)', async () => {
    // After a one-shot fires, the task is removed. The registry's
    // updateLastFiredAt is called BEFORE remove(), so even though
    // the task vanishes, the disk write (if durable) captured the
    // fire — that's our "fire history" durability guarantee.
    const registry = createCronStore()
    const task = registry.add({
      cron: '* * * * *',
      prompt: 'one-shot',
      recurring: false,
      now: nowMs,
    })
    let observedLastFired: number | undefined
    const spy = vi
      .spyOn(registry, 'updateLastFiredAt')
      .mockImplementation((id, ts) => {
        const t = registry.get(id)
        if (t) {
          t.lastFiredAt = ts
          observedLastFired = ts
        }
        return t !== undefined
      })
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(spy).toHaveBeenCalledWith(task.id, clockMs)
    expect(observedLastFired).toBe(clockMs)
    // And the task is gone afterwards (one-shot).
    expect(registry.get(task.id)).toBeUndefined()
  })

  it('multiple due tasks each get their own updateLastFiredAt call', async () => {
    const registry = createCronStore()
    const t1 = registry.add({
      cron: '* * * * *',
      prompt: 'a',
      recurring: true,
      now: nowMs,
    })
    const t2 = registry.add({
      cron: '* * * * *',
      prompt: 'b',
      recurring: true,
      now: nowMs,
    })
    const spy = vi.spyOn(registry, 'updateLastFiredAt')
    const fire = vi.fn()
    const scheduler = new CronScheduler({ registry, fire, clock })
    clockMs = nowMs + 90_000
    await scheduler.tickNow()
    expect(spy).toHaveBeenCalledTimes(2)
    const ids = spy.mock.calls.map((c) => c[0]).sort()
    expect(ids).toEqual([t1.id, t2.id].sort())
    // Both calls used the same firedAt (computed once per tick).
    expect(spy.mock.calls[0]![1]).toBe(clockMs)
    expect(spy.mock.calls[1]![1]).toBe(clockMs)
  })
})

describe('CronScheduler — setInterval lifecycle', () => {
  const nowMs = new Date('2026-05-17T12:00:00').getTime()
  let clockMs = nowMs
  const clock = () => clockMs

  beforeEach(() => {
    vi.useFakeTimers()
    clockMs = nowMs
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start() begins polling at the configured interval', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      intervalMs: 5_000,
    })
    scheduler.start()
    // Move both fake-time AND the injected clock so the cron schedule
    // perceives time as moving.
    clockMs = nowMs + 60_000
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fire).toHaveBeenCalled()
    scheduler.stop()
  })

  it('stop() cancels future ticks', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      intervalMs: 1_000,
    })
    scheduler.start()
    scheduler.stop()
    clockMs = nowMs + 90_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fire).not.toHaveBeenCalled()
  })

  it('start() is idempotent — second call does not spawn a second timer', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const scheduler = new CronScheduler({
      registry,
      fire,
      clock,
      intervalMs: 1_000,
    })
    scheduler.start()
    scheduler.start()
    clockMs = nowMs + 90_000
    await vi.advanceTimersByTimeAsync(1_000)
    // Exactly one fire — if two timers were running, we'd have seen two.
    expect(fire).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('stop() is idempotent', () => {
    const registry = createCronStore()
    const scheduler = new CronScheduler({
      registry,
      fire: async () => {},
      clock,
    })
    expect(() => scheduler.stop()).not.toThrow()
    scheduler.start()
    scheduler.stop()
    expect(() => scheduler.stop()).not.toThrow()
  })

  it('defaults to DEFAULT_CRON_TICK_INTERVAL_MS', () => {
    expect(DEFAULT_CRON_TICK_INTERVAL_MS).toBe(30_000)
  })

  it('uses the injected clock — never reads Date.now', async () => {
    const registry = createCronStore()
    registry.add({
      cron: '* * * * *',
      prompt: 'tick',
      recurring: true,
      now: nowMs,
    })
    const fire = vi.fn()
    const realDateNow = Date.now
    // Sabotage Date.now to prove the scheduler does not call it.
    Date.now = () => {
      throw new Error('scheduler should not be calling Date.now')
    }
    try {
      const scheduler = new CronScheduler({ registry, fire, clock })
      clockMs = nowMs + 90_000
      await scheduler.tickNow()
      expect(fire).toHaveBeenCalledTimes(1)
    } finally {
      Date.now = realDateNow
    }
  })
})
