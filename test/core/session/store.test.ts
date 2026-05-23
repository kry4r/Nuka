// test/core/session/store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionStore, DebouncedMetaWriter } from '../../../src/core/session/store'
import { createSession } from '../../../src/core/session/session'
import type { Message } from '../../../src/core/message/types'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-store-test-'))
}

const makeMsg = (text: string): Message => ({
  role: 'user',
  id: `id-${text}`,
  ts: Date.now(),
  content: [{ type: 'text', text }],
})

describe('SessionStore', () => {
  it('appendMessage creates file and writes one JSONL line per call; readMessages round-trips', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const session = createSession({ providerId: 'p', model: 'm' })

    const m1 = makeMsg('hello')
    const m2 = makeMsg('world')
    await store.appendMessage(session.id, m1)
    await store.appendMessage(session.id, m2)

    const messages = await store.readMessages(session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual(m1)
    expect(messages[1]).toEqual(m2)
  })

  it('writeMeta + readMeta round-trip', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const session = createSession({ providerId: 'prov1', model: 'gpt-4' })
    session.messages.push(makeMsg('hi'))
    session.totalUsage = { inputTokens: 10, outputTokens: 5 }
    session.goal = {
      objective: 'finish provider fixes',
      status: 'active',
      createdAt: 111,
      updatedAt: 222,
      tokenBudget: 5000,
      tokenUsage: 1200,
    }

    await store.writeMeta(session)
    const meta = await store.readMeta(session.id)

    expect(meta).not.toBeNull()
    expect(meta!.id).toBe(session.id)
    expect(meta!.providerId).toBe('prov1')
    expect(meta!.model).toBe('gpt-4')
    expect(meta!.messageCount).toBe(1)
    expect(meta!.totalUsage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(meta!.mode).toBe('normal')
    expect(meta!.createdAt).toBe(session.createdAt)
    expect(meta!.updatedAt).toBe(session.updatedAt)
    expect(meta!.goal).toEqual(session.goal)
  })

  it('readMeta returns null if file does not exist', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const result = await store.readMeta('nonexistent-id')
    expect(result).toBeNull()
  })

  it('list returns metas sorted by updatedAt desc; malformed files are skipped with a warning', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })

    const s1 = createSession({ providerId: 'p', model: 'm' })
    s1.updatedAt = 1000
    const s2 = createSession({ providerId: 'p', model: 'm' })
    s2.updatedAt = 3000
    const s3 = createSession({ providerId: 'p', model: 'm' })
    s3.updatedAt = 2000

    await store.writeMeta(s1)
    await store.writeMeta(s2)
    await store.writeMeta(s3)

    // Write a malformed meta file
    await fs.writeFile(path.join(dir, 'bad.meta.json'), 'not-valid-json', 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const metas = await store.list()
    warnSpy.mockRestore()

    expect(metas).toHaveLength(3)
    expect(metas[0]!.id).toBe(s2.id)
    expect(metas[1]!.id).toBe(s3.id)
    expect(metas[2]!.id).toBe(s1.id)
  })

  it('delete removes both files without erroring if they do not exist', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const session = createSession({ providerId: 'p', model: 'm' })

    await store.appendMessage(session.id, makeMsg('hi'))
    await store.writeMeta(session)

    await store.delete(session.id)

    const msgs = await store.readMessages(session.id)
    expect(msgs).toHaveLength(0)
    const meta = await store.readMeta(session.id)
    expect(meta).toBeNull()

    // Second delete should not throw
    await expect(store.delete(session.id)).resolves.toBeUndefined()
  })

  it('readMessages returns empty array if file does not exist', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const result = await store.readMessages('missing-session')
    expect(result).toEqual([])
  })

  it('readMessages skips malformed lines', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const session = createSession({ providerId: 'p', model: 'm' })
    const msg = makeMsg('good')

    await store.appendMessage(session.id, msg)
    // append a malformed line manually
    await fs.appendFile(path.join(dir, `${session.id}.jsonl`), 'BAD_JSON\n', 'utf8')
    await store.appendMessage(session.id, makeMsg('also-good'))

    const messages = await store.readMessages(session.id)
    expect(messages).toHaveLength(2)
    expect((messages[0] as any).content[0].text).toBe('good')
    expect((messages[1] as any).content[0].text).toBe('also-good')
  })
})

describe('DebouncedMetaWriter', () => {
  it('schedule coalesces multiple rapid calls into one writeMeta', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const writeMetaSpy = vi.spyOn(store, 'writeMeta')

    const writer = new DebouncedMetaWriter(store, 0)
    const session = createSession({ providerId: 'p', model: 'm' })

    writer.schedule(session)
    writer.schedule(session)
    writer.schedule(session)

    await writer.flush()

    expect(writeMetaSpy).toHaveBeenCalledTimes(1)
    expect(writeMetaSpy).toHaveBeenCalledWith(session)
  })

  it('flush with no pending is a no-op', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const writeMetaSpy = vi.spyOn(store, 'writeMeta')
    const writer = new DebouncedMetaWriter(store, 0)

    await writer.flush()
    expect(writeMetaSpy).not.toHaveBeenCalled()
  })
})
