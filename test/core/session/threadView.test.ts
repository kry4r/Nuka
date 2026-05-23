import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore } from '../../../src/core/session/store'
import { createSession } from '../../../src/core/session/session'
import { ThreadViewStore } from '../../../src/core/session/threadView'
import type { Message } from '../../../src/core/message/types'

let dir: string
let store: SessionStore
let threads: ThreadViewStore

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-thread-view-'))
  store = new SessionStore({ dir })
  threads = new ThreadViewStore({ store })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function user(id: string, text: string, ts: number): Message {
  return {
    role: 'user',
    id,
    ts,
    content: [{ type: 'text', text }],
  }
}

function assistant(id: string, text: string, ts: number): Message {
  return {
    role: 'assistant',
    id,
    ts,
    content: [{ type: 'text', text }],
  }
}

async function writeThread(
  messages: Message[],
  opts: {
    providerId?: string
    model?: string
    updatedAt?: number
  } = {},
): Promise<string> {
  const session = createSession({
    providerId: opts.providerId ?? 'p',
    model: opts.model ?? 'm',
  })
  session.createdAt = 100
  session.updatedAt = opts.updatedAt ?? 900
  session.messages = messages
  for (const message of messages) {
    await store.appendMessage(session.id, message)
  }
  await store.writeMeta(session)
  return session.id
}

describe('ThreadViewStore.read', () => {
  it('returns metadata without turns by default', async () => {
    const id = await writeThread([
      user('u1', 'first prompt', 1),
      assistant('a1', 'first answer', 2),
    ])
    const meta = await store.readMeta(id)
    await store.writeMeta({
      ...createSession({ providerId: meta!.providerId, model: meta!.model }),
      id,
      messages: [
        user('u1', 'first prompt', 1),
        assistant('a1', 'first answer', 2),
      ],
      totalUsage: meta!.totalUsage,
      mode: meta!.mode,
      createdAt: meta!.createdAt,
      updatedAt: meta!.updatedAt,
      unDeferredToolNames: new Set(),
      goal: {
        objective: 'keep goal visible',
        status: 'active',
        createdAt: 10,
        updatedAt: 20,
      },
    })

    const thread = await threads.read(id)

    expect(thread).toMatchObject({
      id,
      providerId: 'p',
      model: 'm',
      messageCount: 2,
      status: 'notLoaded',
      turns: [],
    })
    expect(thread?.goal).toMatchObject({
      objective: 'keep goal visible',
      status: 'active',
    })
  })

  it('includes reconstructed turns when requested', async () => {
    const id = await writeThread([
      user('u1', 'first prompt', 1),
      assistant('a1', 'first answer', 2),
      user('u2', 'second prompt', 3),
      assistant('a2', 'second answer', 4),
    ])

    const thread = await threads.read(id, { includeTurns: true })

    expect(thread?.turns.map(turn => turn.id)).toEqual(['u1', 'u2'])
    expect(thread?.turns[0]).toMatchObject({
      id: 'u1',
      status: 'completed',
      startedAt: 1,
      updatedAt: 2,
    })
    expect(thread?.turns[0]?.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    expect(thread?.turns[1]?.messages.map(message => message.id)).toEqual(['u2', 'a2'])
  })

  it('returns null for unknown threads', async () => {
    expect(await threads.read('missing')).toBeNull()
  })
})

describe('ThreadViewStore.list', () => {
  it('pages thread metadata newest-first with JSON cursors', async () => {
    const first = await writeThread([user('u1', 'first prompt', 1)], { updatedAt: 100 })
    const second = await writeThread([user('u2', 'second prompt', 2)], { updatedAt: 200 })
    const third = await writeThread([user('u3', 'third prompt', 3)], { updatedAt: 300 })

    const firstPage = await threads.list({ limit: 2 })

    expect(firstPage.threads.map(thread => thread.id)).toEqual([third, second])
    expect(JSON.parse(firstPage.nextCursor ?? '{}')).toEqual({
      threadId: second,
      includeAnchor: false,
    })

    const secondPage = await threads.list({
      limit: 2,
      cursor: firstPage.nextCursor,
    })
    expect(secondPage.threads.map(thread => thread.id)).toEqual([first])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('filters thread metadata by provider, model, and search text', async () => {
    const matching = await writeThread([user('u1', 'needle prompt', 1)])
    await writeThread(
      [user('u2', 'other prompt', 2)],
      {
        providerId: 'other-provider',
        model: 'other-model',
      },
    )

    const page = await threads.list({
      providerIds: ['p'],
      models: ['m'],
      searchTerm: 'needle',
    })

    expect(page.threads.map(thread => thread.id)).toEqual([matching])
  })
})

describe('ThreadViewStore.listTurns', () => {
  it('pages turns newest-first with JSON cursors', async () => {
    const id = await writeThread([
      user('u1', 'first', 1),
      assistant('a1', 'first answer', 2),
      user('u2', 'second', 3),
      assistant('a2', 'second answer', 4),
      user('u3', 'third', 5),
      assistant('a3', 'third answer', 6),
    ])

    const firstPage = await threads.listTurns(id, { limit: 2 })

    expect(firstPage.turns.map(turn => turn.id)).toEqual(['u3', 'u2'])
    expect(JSON.parse(firstPage.backwardsCursor ?? '{}')).toEqual({
      turnId: 'u3',
      includeAnchor: true,
    })
    expect(JSON.parse(firstPage.nextCursor ?? '{}')).toEqual({
      turnId: 'u2',
      includeAnchor: false,
    })

    const secondPage = await threads.listTurns(id, {
      limit: 2,
      cursor: firstPage.nextCursor,
    })
    expect(secondPage.turns.map(turn => turn.id)).toEqual(['u1'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('can page ascending from an inclusive backwards cursor', async () => {
    const id = await writeThread([
      user('u1', 'first', 1),
      assistant('a1', 'first answer', 2),
      user('u2', 'second', 3),
      assistant('a2', 'second answer', 4),
      user('u3', 'third', 5),
      assistant('a3', 'third answer', 6),
    ])

    const latest = await threads.listTurns(id, { limit: 1 })
    const asc = await threads.listTurns(id, {
      sortDirection: 'asc',
      cursor: latest.backwardsCursor,
    })

    expect(asc.turns.map(turn => turn.id)).toEqual(['u3'])
  })

  it('throws for invalid cursors', async () => {
    const id = await writeThread([user('u1', 'first', 1)])

    await expect(threads.listTurns(id, { cursor: 'not-json' }))
      .rejects.toThrow(/invalid cursor/)
  })
})
