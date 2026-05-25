// test/core/compact/compact.test.ts
import { describe, it, expect } from 'vitest'
import { compactSession, COMPACT_SUMMARY_MARKER } from '../../../src/core/compact/compact'
import { MICROCOMPACT_CLEARED_TOOL_RESULT } from '../../../src/core/compact/microCompact'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, LLMRequest, ProviderEvent } from '../../../src/core/provider/types'

function stub(text: string): LLMProvider {
  return {
    id: 'p', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('compactSession', () => {
  it('replaces older messages with a single compact summary, preserves keepTurns most recent', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    expect(s.messages).toHaveLength(12)

    const before = s.messages.slice(-6) // last 3 turns
    await compactSession(s, { provider: stub('SUMMARY'), model: 'm', keepTurns: 3 })

    // 1 summary + last 6 messages = 7
    expect(s.messages).toHaveLength(7)
    const first = s.messages[0]
    expect(first.role).toBe('assistant')
    if (first.role === 'assistant') {
      const text = first.content.map((b: any) => b.text ?? '').join('')
      expect(text).toContain(COMPACT_SUMMARY_MARKER)
      expect(text).toContain('SUMMARY')
    }
    expect(s.messages.slice(1)).toEqual(before)
  })

  it('is a no-op when message count is already within the keep window', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.messages.push({ role: 'user', id: 'u', ts: 1, content: [{ type: 'text', text: 'hi' }] })
    const before = s.messages.length
    await compactSession(s, { provider: stub('X'), model: 'm', keepTurns: 3 })
    expect(s.messages.length).toBe(before)
  })

  it('preserves one trailing newline in text compact summaries', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 4; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }

    await compactSession(s, { provider: stub('\nSUMMARY\n\n'), model: 'm', keepTurns: 1 })

    expect(s.messages[0]).toMatchObject({ role: 'assistant' })
    if (s.messages[0]?.role === 'assistant') {
      expect(s.messages[0].content[0]).toMatchObject({
        type: 'text',
        text: `${COMPACT_SUMMARY_MARKER}\nSUMMARY\n`,
      })
    }
  })

  it('honors retainedMessageBudget even when keepTurns would keep the transcript', async () => {
    const streamRequests: LLMRequest[] = []
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req): AsyncIterable<ProviderEvent> {
        streamRequests.push(req)
        yield { type: 'text_delta', text: 'BUDGET SUMMARY' }
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    const older = s.messages.slice(0, 8)
    const kept = s.messages.slice(-4)

    await compactSession(s, {
      provider,
      model: 'm',
      keepTurns: 10,
      retainedMessageBudget: 4,
    })

    expect(streamRequests).toHaveLength(1)
    expect(streamRequests[0]!.messages).toEqual(older)
    expect(s.messages).toHaveLength(5)
    expect(s.messages.slice(1)).toEqual(kept)
    expect(s.messages[0]).toMatchObject({ role: 'assistant' })
    if (s.messages[0]?.role === 'assistant') {
      expect(s.messages[0].content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('BUDGET SUMMARY'),
      })
    }
  })

  it('treats retainedMessageBudget as an estimated token budget for the retained tail', async () => {
    const streamRequests: LLMRequest[] = []
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req): AsyncIterable<ProviderEvent> {
        streamRequests.push(req)
        yield { type: 'text_delta', text: 'TOKEN SUMMARY' }
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 4; i++) {
      const assistantText = i === 2 ? 'x'.repeat(80) : `a${i}`
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: assistantText }] })
    }
    const older = s.messages.slice(0, 6)
    const kept = s.messages.slice(-2)

    await compactSession(s, {
      provider,
      model: 'm',
      keepTurns: 10,
      retainedMessageBudget: 4,
    })

    expect(streamRequests[0]!.messages).toEqual(older)
    expect(s.messages.slice(1)).toEqual(kept)
  })

  it('does not orphan retained tool results when a retained budget cut lands inside a tool pair', async () => {
    const streamRequests: LLMRequest[] = []
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req): AsyncIterable<ProviderEvent> {
        streamRequests.push(req)
        yield { type: 'text_delta', text: 'TOOLPAIR SUMMARY' }
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const s = createSession({ providerId: 'p', model: 'm' })
    s.messages.push({ role: 'user', id: 'u0', ts: 1, content: [{ type: 'text', text: 'older' }] })
    s.messages.push({ role: 'assistant', id: 'a0', ts: 2, content: [{ type: 'text', text: 'older answer' }] })
    s.messages.push({ role: 'user', id: 'u1', ts: 3, content: [{ type: 'text', text: 'read file' }] })
    s.messages.push({
      role: 'assistant',
      id: 'a1',
      ts: 4,
      content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a.ts' } }],
    })
    s.messages.push({
      role: 'tool',
      id: 't1',
      ts: 5,
      toolUseId: 'call_1',
      content: 'ok',
      isError: false,
    })
    const older = s.messages.slice(0, 3)
    const kept = s.messages.slice(3)

    await compactSession(s, {
      provider,
      model: 'm',
      keepTurns: 10,
      retainedMessageBudget: 1,
    })

    expect(streamRequests[0]!.messages).toEqual(older)
    expect(s.messages.slice(1)).toEqual(kept)
    expect(s.messages[1]?.role).toBe('assistant')
    expect(s.messages[2]?.role).toBe('tool')
  })

  it('uses native provider compaction when available and keeps returned Responses items model-visible', async () => {
    const calls: Array<{ kind: 'compact'; req: LLMRequest } | { kind: 'stream' }> = []
    const provider: LLMProvider = {
      id: 'custom',
      format: 'openai',
      async compact(req) {
        calls.push({ kind: 'compact', req })
        return {
          implementation: 'responses_compact',
          output: [
            { role: 'user', content: 'recent request' },
            { type: 'compaction', encrypted_content: 'ENCRYPTED_CONTEXT_COMPACTION_SUMMARY' },
          ],
        }
      },
      async *stream(): AsyncIterable<ProviderEvent> {
        calls.push({ kind: 'stream' })
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      },
      async listRemoteModels() { return [] },
    }
    const s = createSession({ providerId: 'custom', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    const older = s.messages.slice(0, -6)
    const before = s.messages.slice(-6)

    await compactSession(s, { provider, model: 'm', keepTurns: 3 })

    expect(calls.map(c => c.kind)).toEqual(['compact'])
    expect(calls[0]).toMatchObject({
      kind: 'compact',
      req: {
        model: 'm',
        maxTokens: 800,
        messages: older,
      },
    })
    expect(s.messages).toEqual([
      {
        role: 'responses_compaction',
        provider: 'openai',
        output: [
          { role: 'user', content: 'recent request' },
          { type: 'compaction', encrypted_content: 'ENCRYPTED_CONTEXT_COMPACTION_SUMMARY' },
        ],
        id: expect.any(String),
        ts: expect.any(Number),
      },
      ...before,
    ])
  })

  it('cleans stale tool results in the kept window after compacting', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i * 4, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({
        role: 'assistant',
        id: `a${i}`,
        ts: i * 4 + 1,
        content: [{ type: 'tool_use', id: `call_${i}`, name: 'Read', input: { path: `${i}.ts` } }],
      })
      s.messages.push({
        role: 'tool',
        id: `t${i}`,
        ts: i * 4 + 2,
        toolUseId: `call_${i}`,
        content: `read result ${i}`,
        isError: false,
      })
    }

    await compactSession(s, {
      provider: stub('SUMMARY'),
      model: 'm',
      keepTurns: 3,
      postCompactMicroCompact: { keepRecent: 1 },
    })

    const toolMessages = s.messages.filter((m): m is Extract<typeof m, { role: 'tool' }> => m.role === 'tool')
    expect(toolMessages.map(m => m.content)).toEqual([
      MICROCOMPACT_CLEARED_TOOL_RESULT,
      MICROCOMPACT_CLEARED_TOOL_RESULT,
      'read result 5',
    ])
  })

  it('shrinks and retries native compact when the older slice exceeds context', async () => {
    const compactRequests: LLMRequest[] = []
    const provider: LLMProvider = {
      id: 'custom',
      format: 'openai',
      async compact(req) {
        compactRequests.push(req)
        if (compactRequests.length === 1) {
          throw new Error('OpenAI Responses compact request failed (413 Payload Too Large): prompt is too long for context window')
        }
        return {
          implementation: 'responses_compact',
          output: [{ type: 'compaction', encrypted_content: 'shrunk' }],
        }
      },
      async *stream(): AsyncIterable<ProviderEvent> {
        throw new Error('stream should not be used')
      },
      async listRemoteModels() { return [] },
    }
    const s = createSession({ providerId: 'custom', model: 'm' })
    for (let i = 0; i < 8; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }

    await compactSession(s, { provider, model: 'm', keepTurns: 2, maxShrinkRetries: 2 })

    expect(compactRequests).toHaveLength(2)
    expect(compactRequests[1]!.messages.length).toBeLessThan(compactRequests[0]!.messages.length)
    expect(s.messages[0]).toMatchObject({
      role: 'responses_compaction',
      output: [{ type: 'compaction', encrypted_content: 'shrunk' }],
    })
  })

  it('shrinks and retries summary compact when the older slice exceeds context', async () => {
    const streamRequests: LLMRequest[] = []
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req): AsyncIterable<ProviderEvent> {
        streamRequests.push(req)
        if (streamRequests.length === 1) {
          throw new Error('context length exceeded: prompt too long')
        }
        yield { type: 'text_delta', text: 'SHRUNK SUMMARY' }
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 8; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }

    await compactSession(s, { provider, model: 'm', keepTurns: 2, maxShrinkRetries: 2 })

    expect(streamRequests).toHaveLength(2)
    expect(streamRequests[1]!.messages.length).toBeLessThan(streamRequests[0]!.messages.length)
    expect(s.messages[0]).toMatchObject({ role: 'assistant' })
    if (s.messages[0]?.role === 'assistant') {
      expect(s.messages[0].content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('SHRUNK SUMMARY'),
      })
    }
  })
})
