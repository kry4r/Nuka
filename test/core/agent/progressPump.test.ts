import { describe, it, expect } from 'vitest'
import { createProgressPump } from '../../../src/core/agent/progressPump'

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const v of gen) out.push(v)
  return out
}

describe('createProgressPump', () => {
  it('delivers buffered messages in order when drained after finish', async () => {
    const pump = createProgressPump()
    pump.onProgress('a')
    pump.onProgress('b')
    pump.onProgress('c')
    pump.finish()
    expect(await collect(pump.drain())).toEqual(['a', 'b', 'c'])
  })

  it('delivers messages pushed during drain (interleaved)', async () => {
    const pump = createProgressPump()
    // Push one message before starting drain (lands in queue)
    pump.onProgress('x')
    const drainPromise = collect(pump.drain())
    // Push second message after drain has started
    await Promise.resolve()
    pump.onProgress('y')
    pump.finish()
    expect(await drainPromise).toEqual(['x', 'y'])
  })

  it('finish() ends the iterator immediately when queue is empty', async () => {
    const pump = createProgressPump()
    pump.finish()
    expect(await collect(pump.drain())).toEqual([])
  })
})
