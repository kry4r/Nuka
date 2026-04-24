// src/core/tools/concurrency.ts

/**
 * Classic counting semaphore.
 * acquire() resolves with a release function when a slot is available.
 */
export function createSemaphore(max: number): { acquire(): Promise<() => void> } {
  let count = 0
  const waiters: Array<() => void> = []

  function tryRelease() {
    if (waiters.length > 0) {
      const next = waiters.shift()!
      next()
    } else {
      count--
    }
  }

  return {
    acquire(): Promise<() => void> {
      if (count < max) {
        count++
        return Promise.resolve(tryRelease)
      }
      return new Promise<() => void>(resolve => {
        waiters.push(() => {
          resolve(tryRelease)
        })
      })
    },
  }
}

/**
 * Run items in parallel with bounded concurrency.
 * Results are returned in INPUT ORDER regardless of completion order.
 */
export async function parallelBatch<T, R>(
  items: T[],
  run: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const sem = createSemaphore(concurrency)
  await Promise.all(
    items.map(async (item, i) => {
      const release = await sem.acquire()
      try {
        results[i] = await run(item, i)
      } finally {
        release()
      }
    }),
  )
  return results
}
