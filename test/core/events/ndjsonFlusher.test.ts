import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEventBus } from '../../../src/core/events/bus'
import { attachNdjsonFlusher } from '../../../src/core/events/ndjsonFlusher'

describe('attachNdjsonFlusher', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-evt-')) })

  it('writes one ndjson line per emitted event', async () => {
    const bus = createEventBus()
    const stop = attachNdjsonFlusher({ bus, dir, sessionId: 'sess-1' })
    bus.emit('task', { type: 'task.evicted', id: 'a' })
    bus.emit('agent', { type: 'agent.usage', sessionId: 'sess-1', inputTokens: 1, outputTokens: 2 })
    await stop()
    const file = path.join(dir, 'sess-1.ndjson')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const recs = lines.map(l => JSON.parse(l))
    expect(recs[0].topic).toBe('task')
    expect(recs[0].seq).toBe(0)
    expect(recs[1].topic).toBe('agent')
    expect(recs[1].seq).toBe(1)
  })
})
