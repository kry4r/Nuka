import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore, DebouncedMetaWriter } from '../../src/core/session/store'
import { SessionManager } from '../../src/core/session/manager'
import { HistoryStore } from '../../src/core/session/history/store'
import { makeUserMessage } from '../../src/core/message/factories'

describe('B4 — cross-startup resume', () => {
  let dir: string
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('persists then resumes a session via HistoryStore.list + manager.resume', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-b4-'))
    const store = new SessionStore({ dir })
    const writer = new DebouncedMetaWriter(store, 5)
    const mgr = new SessionManager({ store, metaWriter: writer })
    const s = mgr.start({ providerId: 'p', model: 'm' })
    const msg = makeUserMessage({ text: 'replay me' })
    s.messages.push(msg)
    await store.appendMessage(s.id, msg)
    await writer.flush()

    // simulate restart: fresh manager + history store reading the same dir
    const store2 = new SessionStore({ dir })
    const writer2 = new DebouncedMetaWriter(store2, 5)
    const mgr2 = new SessionManager({ store: store2, metaWriter: writer2 })
    const history = new HistoryStore({ store: store2 })
    const list = await history.list()
    expect(list.find(e => e.id === s.id)?.preview).toBe('replay me')
    const resumed = await mgr2.resume(s.id)
    expect(resumed.id).toBe(s.id)
    expect(resumed.messages).toHaveLength(1)
  })
})
