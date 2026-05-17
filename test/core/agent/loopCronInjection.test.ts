// test/core/agent/loopCronInjection.test.ts
//
// Practical Iter JJJJ — drain CronPromptQueue at start of runAgent.
//
// Covers:
//   - Pending entries → injected as synthetic user messages, in FIFO order,
//     BEFORE the user's input message.
//   - Each entry uses the `[CRON ${taskId}]` prefix.
//   - Empty queue → no extra messages prepended; only the user message lands.
//   - Drain is idempotent — a second runAgent doesn't re-inject already
//     drained entries.
//   - Env var `NUKA_CRON_INJECT_PROMPTS` OFF → queue is NOT drained even if
//     it has entries (and existing entries stay for a later invocation
//     once the env is turned on).
//   - `deps.cronPromptQueue` absent → no injection, no crash.
//
// The agent provider is a stub that emits a text-only turn so the loop
// finishes in one iteration. We assert on `session.messages` after the
// generator drains.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import { CronPromptQueue } from '../../../src/core/session/cronPromptQueue'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'

function textOnlyProvider(reply = 'ok'): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text: reply }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
    async listRemoteModels() {
      return []
    },
  } as LLMProvider
}

function makeDeps(provider: LLMProvider, session: ReturnType<typeof createSession>, queue?: CronPromptQueue) {
  const tools = new ToolRegistry()
  const permission = new PermissionChecker(
    () => session.permissionCache,
    async () => ({ allowed: true }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deps: any = {
    provider: { resolveFor: () => ({ provider, model: 'm' }) },
    tools,
    permission,
  }
  if (queue) deps.cronPromptQueue = queue
  return deps
}

async function drainEvents(gen: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ev of gen) { /* drain */ }
}

describe('runAgent — cron prompt injection (NUKA_CRON_INJECT_PROMPTS)', () => {
  const origEnv = process.env['NUKA_CRON_INJECT_PROMPTS']
  beforeEach(() => {
    delete process.env['NUKA_CRON_INJECT_PROMPTS']
  })
  afterEach(() => {
    if (origEnv === undefined) delete process.env['NUKA_CRON_INJECT_PROMPTS']
    else process.env['NUKA_CRON_INJECT_PROMPTS'] = origEnv
  })

  it('prepends synthetic user messages from drained queue (env ON)', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    queue.enqueue('task-A', 'wake up', 1000)
    queue.enqueue('task-B', 'check deploy', 2000)

    await drainEvents(
      runAgent(
        { text: 'user-typed' },
        session,
        makeDeps(textOnlyProvider(), session, queue),
        new AbortController().signal,
      ),
    )

    // Expected message order: cron-A, cron-B, user-typed, assistant
    expect(session.messages.length).toBe(4)
    expect(session.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '[CRON task-A] wake up' }],
    })
    expect(session.messages[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '[CRON task-B] check deploy' }],
    })
    expect(session.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'user-typed' }],
    })
    expect(session.messages[3]).toMatchObject({ role: 'assistant' })
  })

  it('FIFO order across many entries', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    for (let i = 0; i < 5; i++) queue.enqueue(`t${i}`, `p${i}`, i)

    await drainEvents(
      runAgent(
        { text: 'final' },
        session,
        makeDeps(textOnlyProvider(), session, queue),
        new AbortController().signal,
      ),
    )

    const userTexts = session.messages
      .filter(m => m.role === 'user')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(m => (m as any).content[0].text as string)
    expect(userTexts).toEqual([
      '[CRON t0] p0',
      '[CRON t1] p1',
      '[CRON t2] p2',
      '[CRON t3] p3',
      '[CRON t4] p4',
      'final',
    ])
  })

  it('drain is idempotent — second runAgent does not re-inject', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    queue.enqueue('once', 'fire', 1)

    await drainEvents(
      runAgent({ text: 'first' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    const afterFirst = session.messages.length
    expect(queue.size).toBe(0)

    // Second invocation — queue empty, no extra cron messages should land.
    await drainEvents(
      runAgent({ text: 'second' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    // Second turn appends: user-second + assistant = +2 messages
    expect(session.messages.length).toBe(afterFirst + 2)
    // The new tail should be user 'second' then assistant.
    const tail = session.messages.slice(-2)
    expect(tail[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'second' }],
    })
    expect(tail[1]).toMatchObject({ role: 'assistant' })
  })

  it('empty queue is a no-op (env ON)', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()

    await drainEvents(
      runAgent({ text: 'hello' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    // Just user + assistant
    expect(session.messages.length).toBe(2)
    expect(session.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('env OFF → queue is NOT drained even if non-empty', async () => {
    // env var explicitly absent (beforeEach deletes it)
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    queue.enqueue('skip-me', 'should not fire', 999)

    await drainEvents(
      runAgent({ text: 'user'}, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    expect(session.messages.length).toBe(2) // user + assistant only
    // Queue retains its entry — a later run with env ON would inject it.
    expect(queue.size).toBe(1)
    expect(queue.peek()[0]).toMatchObject({ taskId: 'skip-me' })
  })

  it('env explicitly "0" → no injection', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '0'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    queue.enqueue('skip-me', 'no go', 1)

    await drainEvents(
      runAgent({ text: 'u' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    expect(session.messages.length).toBe(2)
    expect(queue.size).toBe(1)
  })

  it('cronPromptQueue absent in deps → loop runs normally (no crash)', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })

    await drainEvents(
      runAgent({ text: 'hi' }, session, makeDeps(textOnlyProvider(), session, /* no queue */), new AbortController().signal),
    )
    expect(session.messages.length).toBe(2)
  })

  it('queue draining survives entries enqueued AFTER runAgent started (next turn picks them up)', async () => {
    process.env['NUKA_CRON_INJECT_PROMPTS'] = '1'
    const session = createSession({ providerId: 'p', model: 'm' })
    const queue = new CronPromptQueue()
    // Enqueue BEFORE first run — gets drained.
    queue.enqueue('first', 'a', 1)

    await drainEvents(
      runAgent({ text: 'turn1' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )
    // Now enqueue mid-idle — should land on next runAgent call.
    queue.enqueue('second', 'b', 2)
    expect(queue.size).toBe(1)

    await drainEvents(
      runAgent({ text: 'turn2' }, session, makeDeps(textOnlyProvider(), session, queue), new AbortController().signal),
    )

    const userTexts = session.messages
      .filter(m => m.role === 'user')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(m => (m as any).content[0].text as string)
    expect(userTexts).toEqual([
      '[CRON first] a',
      'turn1',
      '[CRON second] b',
      'turn2',
    ])
    expect(queue.size).toBe(0)
  })
})
