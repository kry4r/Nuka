import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore } from '../../../../src/core/session/store'
import { HistoryStore } from '../../../../src/core/session/history/store'
import type { SessionId } from '../../../../src/core/session/history/types'
import { createSession, appendMessage } from '../../../../src/core/session/session'
import { makeUserMessage, emptyAssistant } from '../../../../src/core/message/factories'

let dir: string
let store: SessionStore
let history: HistoryStore

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-hist-'))
  store = new SessionStore({ dir })
  history = new HistoryStore({ store })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('HistoryStore.list', () => {
  it('returns [] when sessions dir is empty', async () => {
    expect(await history.list()).toEqual([])
  })

  it('lists sessions newest-first with truncated preview', async () => {
    const s1 = createSession({ providerId: 'p', model: 'm1' })
    s1.createdAt = 100; s1.updatedAt = 100
    appendMessage(s1, makeUserMessage({ text: 'hello world' }))
    await store.appendMessage(s1.id, s1.messages[0]!)
    await store.writeMeta(s1)

    const s2 = createSession({ providerId: 'p', model: 'm2' })
    s2.createdAt = 200; s2.updatedAt = 200
    appendMessage(s2, makeUserMessage({ text: 'X'.repeat(200) }))
    await store.appendMessage(s2.id, s2.messages[0]!)
    await store.writeMeta(s2)

    const entries = await history.list()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.id).toBe(s2.id as unknown as SessionId)
    expect(entries[0]!.preview.length).toBeLessThanOrEqual(64)
    expect(entries[1]!.preview).toBe('hello world')
  })

  it('skips sessions with no readable user message', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    appendMessage(s, emptyAssistant())
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    const entries = await history.list()
    expect(entries[0]!.preview).toBe('')
  })
})

describe('HistoryStore.delete', () => {
  it('removes both jsonl and meta files', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    appendMessage(s, makeUserMessage({ text: 'gone' }))
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    expect((await history.list())).toHaveLength(1)
    await history.delete(s.id as unknown as SessionId)
    expect((await history.list())).toHaveLength(0)
  })
})

describe('HistoryStore.read', () => {
  it('returns full HistoryRecord for known id', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.totalUsage = { inputTokens: 5, outputTokens: 7 }
    appendMessage(s, makeUserMessage({ text: 'preview text' }))
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    const rec = await history.read(s.id as unknown as SessionId)
    expect(rec).not.toBeNull()
    expect(rec!.preview).toBe('preview text')
    expect(rec!.totalUsage.inputTokens).toBe(5)
  })
  it('returns null for unknown id', async () => {
    expect(await history.read('missing' as unknown as SessionId)).toBeNull()
  })
})
