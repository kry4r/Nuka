import * as fs from 'node:fs'
import * as path from 'node:path'
import type { EventBus } from './bus'
import type { Topic, EventRecord } from './types'

export type FlusherOpts = {
  bus: EventBus
  dir: string
  sessionId: string
}

export function attachNdjsonFlusher(opts: FlusherOpts): () => Promise<void> {
  fs.mkdirSync(opts.dir, { recursive: true })
  const file = path.join(opts.dir, `${opts.sessionId}.ndjson`)
  const stream = fs.createWriteStream(file, { flags: 'a' })
  let seq = 0
  const offs: Array<() => void> = []
  for (const topic of ['task', 'agent', 'message', 'harness'] as Topic[]) {
    offs.push(opts.bus.subscribe(topic, (payload: unknown) => {
      const rec = { seq: seq++, t: Date.now(), topic, payload } as EventRecord
      stream.write(JSON.stringify(rec) + '\n')
    }))
  }
  return async () => {
    for (const off of offs) off()
    await new Promise<void>((res, rej) => stream.end((err: Error | null | undefined) => err ? rej(err) : res()))
  }
}
