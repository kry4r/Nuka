// test/core/session/truncate.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '../../../src/core/session/manager'
import { SessionStore, DebouncedMetaWriter } from '../../../src/core/session/store'
import type { Message } from '../../../src/core/message/types'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-truncate-test-'))
}

function u(id: string, text: string): Message {
  return { role: 'user', id, ts: 1, content: [{ type: 'text', text }] }
}
function a(id: string, text: string): Message {
  return { role: 'assistant', id, ts: 2, content: [{ type: 'text', text }] }
}

describe('SessionManager.truncateAfter', () => {
  it('drops the target message and everything after (in-memory)', async () => {
    const m = new SessionManager()
    const s = m.start({ providerId: 'p', model: 'x' })
    s.messages.push(u('u1', 'hi'), a('a1', 'hello'), u('u2', 'more'), a('a2', 'ok'))
    const removed = await m.truncateAfter('a1')
    expect(removed).toBe(3)
    expect(s.messages.map(x => (x as any).id)).toEqual(['u1'])
  })

  it('returns 1 when truncating at the last message', async () => {
    const m = new SessionManager()
    const s = m.start({ providerId: 'p', model: 'x' })
    s.messages.push(u('u1', 'hi'), a('a1', 'hello'))
    const removed = await m.truncateAfter('a1')
    expect(removed).toBe(1)
    expect(s.messages.map(x => (x as any).id)).toEqual(['u1'])
  })

  it('throws when message is not in the session', async () => {
    const m = new SessionManager()
    m.start({ providerId: 'p', model: 'x' })
    await expect(m.truncateAfter('missing')).rejects.toThrow(/message not in session/)
  })

  it('throws when there is no active session', async () => {
    const m = new SessionManager()
    await expect(m.truncateAfter('x')).rejects.toThrow(/no active session/)
  })

  it('persists the truncated transcript via SessionStore.rewriteMessages', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const metaWriter = new DebouncedMetaWriter(store, 0)
    const m = new SessionManager({ store, metaWriter })
    const s = m.start({ providerId: 'p', model: 'x' })
    await store.appendMessage(s.id, u('u1', 'hi'))
    await store.appendMessage(s.id, a('a1', 'hello'))
    await store.appendMessage(s.id, u('u2', 'more'))
    s.messages.push(u('u1', 'hi'), a('a1', 'hello'), u('u2', 'more'))

    await m.truncateAfter('a1')
    const persisted = await store.readMessages(s.id)
    expect(persisted.map(x => (x as any).id)).toEqual(['u1'])
  })

  it('rewriteMessages handles empty lists', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    await store.appendMessage('s1', u('u1', 'hi'))
    await store.rewriteMessages('s1', [])
    const persisted = await store.readMessages('s1')
    expect(persisted).toEqual([])
  })
})
