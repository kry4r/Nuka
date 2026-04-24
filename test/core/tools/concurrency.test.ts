// test/core/tools/concurrency.test.ts
import { describe, it, expect } from 'vitest'
import { createSemaphore, parallelBatch } from '../../../src/core/tools/concurrency'

describe('createSemaphore', () => {
  it('allows up to max concurrent holders', async () => {
    const sem = createSemaphore(2)
    let active = 0
    let maxActive = 0

    const tasks = Array.from({ length: 4 }, async (_, i) => {
      const release = await sem.acquire()
      active++
      maxActive = Math.max(maxActive, active)
      // Simulate async work
      await new Promise<void>(r => setTimeout(r, 5))
      active--
      release()
      return i
    })

    await Promise.all(tasks)
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('resolves in FIFO order', async () => {
    const sem = createSemaphore(1)
    const order: number[] = []

    // Grab the semaphore immediately
    const r0 = await sem.acquire()
    // Queue two waiters
    const p1 = sem.acquire().then(rel => { order.push(1); rel() })
    const p2 = sem.acquire().then(rel => { order.push(2); rel() })
    r0() // release first slot
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })
})

describe('parallelBatch', () => {
  it('returns results in input order even when items complete out of order', async () => {
    const delays = [50, 10, 30]
    const results = await parallelBatch(
      delays,
      async (delay, i) => {
        await new Promise<void>(r => setTimeout(r, delay))
        return i
      },
      3,
    )
    expect(results).toEqual([0, 1, 2])
  })

  it('respects concurrency cap', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 6 }, (_, i) => i)
    await parallelBatch(
      items,
      async (_item) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise<void>(r => setTimeout(r, 5))
        active--
      },
      3,
    )
    expect(maxActive).toBeLessThanOrEqual(3)
  })

  it('handles empty input', async () => {
    const results = await parallelBatch([], async (x: number) => x, 4)
    expect(results).toEqual([])
  })

  it('propagates errors from individual items', async () => {
    await expect(
      parallelBatch(
        [1, 2, 3],
        async (x) => {
          if (x === 2) throw new Error('boom')
          return x
        },
        4,
      ),
    ).rejects.toThrow('boom')
  })

  it('two items complete in max(t1, t2) time, not t1+t2', async () => {
    const t0 = Date.now()
    await parallelBatch(
      [60, 30],
      async (delay) => {
        await new Promise<void>(r => setTimeout(r, delay))
        return delay
      },
      4,
    )
    const elapsed = Date.now() - t0
    // Should take ~60ms, not ~90ms
    expect(elapsed).toBeLessThan(90)
    expect(elapsed).toBeGreaterThanOrEqual(50)
  })
})
