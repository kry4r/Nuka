import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore } from '../../../../src/core/session/store'
import { HistoryStore } from '../../../../src/core/session/history/store'
import type { SessionId } from '../../../../src/core/session/history/types'
import type { Message } from '../../../../src/core/message/types'
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

describe('HistoryStore.search', () => {
  async function persistMessages(session: ReturnType<typeof createSession>, messages: Message[]) {
    session.messages.push(...messages)
    for (const msg of messages) {
      await store.appendMessage(session.id, msg)
    }
    await store.writeMeta(session)
  }

  it('finds sessions by case-insensitive persisted content and returns newest matches first', async () => {
    const older = createSession({ providerId: 'p', model: 'm1' })
    older.createdAt = 100; older.updatedAt = 100
    await persistMessages(older, [
      { role: 'user', id: 'u1', ts: 100, content: [{ type: 'text', text: 'Investigate auth bug in login' }] },
      { role: 'assistant', id: 'a1', ts: 101, content: [{ type: 'text', text: 'The fix is in session middleware.' }] },
    ])

    const newer = createSession({ providerId: 'p', model: 'm2' })
    newer.createdAt = 200; newer.updatedAt = 200
    await persistMessages(newer, [
      { role: 'user', id: 'u2', ts: 200, content: [{ type: 'text', text: 'Check deploy notes' }] },
      { role: 'tool', id: 't1', ts: 201, toolUseId: 'grep-1', content: 'AUTH BUG appears in release notes', isError: false },
    ])

    const results = await history.search('Auth Bug')

    expect(results.map(r => r.id)).toEqual([
      newer.id as unknown as SessionId,
      older.id as unknown as SessionId,
    ])
    expect(results[0]!.preview).toMatch(/AUTH BUG/)
    expect(results[1]!.preview).toMatch(/auth bug/)
  })

  it('matches assistant and system text from persisted messages', async () => {
    const assistantMatch = createSession({ providerId: 'p', model: 'm1' })
    assistantMatch.createdAt = 100; assistantMatch.updatedAt = 100
    await persistMessages(assistantMatch, [
      { role: 'user', id: 'u1', ts: 100, content: [{ type: 'text', text: 'Summarize the debugging session' }] },
      { role: 'assistant', id: 'a1', ts: 101, content: [{ type: 'text', text: 'Rollback boundary is the history store.' }] },
    ])

    const systemMatch = createSession({ providerId: 'p', model: 'm2' })
    systemMatch.createdAt = 200; systemMatch.updatedAt = 200
    await persistMessages(systemMatch, [
      { role: 'system', content: 'Project instruction: preserve rollback boundary notes.' },
      { role: 'user', id: 'u2', ts: 201, content: [{ type: 'text', text: 'Normal prompt' }] },
    ])

    const results = await history.search('rollback boundary')

    expect(results.map(r => r.id)).toEqual([
      systemMatch.id as unknown as SessionId,
      assistantMatch.id as unknown as SessionId,
    ])
  })

  it('delegates blank queries to list', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.createdAt = 100; s.updatedAt = 100
    appendMessage(s, makeUserMessage({ text: 'hello world' }))
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)

    expect(await history.search('   ')).toEqual(await history.list())
  })

  it('returns no match for malformed or unreadable messages instead of throwing', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.createdAt = 100; s.updatedAt = 100
    await store.writeMeta(s)
    appendFileSync(path.join(dir, `${s.id}.jsonl`), '{not json}\n', 'utf8')

    await expect(history.search('anything')).resolves.toEqual([])
  })
})
