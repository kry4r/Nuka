// test/core/awaySummary/awaySummaryTool.test.ts
//
// Unit tests for the agent-callable AwaySummaryTool surface. The
// underlying runner is mocked — these tests verify:
//   - Tool delegates to the runner with the supplied transcript
//   - Tool falls back to ctx.session.messages when input.messages is empty
//   - "no recap" results are surfaced as non-error friendly text
//   - Runner exceptions are surfaced as tool errors

import { describe, it, expect, vi } from 'vitest'
import {
  makeAwaySummaryTool,
  AWAY_SUMMARY_TOOL_NAME,
} from '../../../src/core/awaySummary/awaySummaryTool'
import type { AwaySummaryRunner } from '../../../src/core/awaySummary/runner'
import {
  makeUserMessage,
  emptyAssistant,
} from '../../../src/core/message/factories'
import type {
  AssistantMessage,
  Message,
} from '../../../src/core/message/types'
import type { Session } from '../../../src/core/session/types'
import type { ToolContext } from '../../../src/core/tools/types'

function assistantWithText(text: string): AssistantMessage {
  const m = emptyAssistant()
  m.content = [{ type: 'text', text }]
  return m
}

function makeCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    signal: new AbortController().signal,
    cwd: '/tmp/fake',
    ...over,
  }
}

function makeSession(messages: Message[]): Session {
  // Construct a minimal Session-like object — only the fields the tool reads
  // need to be populated. Other fields are stubbed with type assertions to
  // satisfy the strict shape without pulling in the full SessionManager.
  return {
    id: 'sess-fake',
    providerId: 'p',
    model: 'm',
    messages,
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    permissionCache: { allow: new Set<string>(), deny: new Set<string>() } as Session['permissionCache'],
    queue: { enqueue: () => {}, drain: () => [] } as unknown as Session['queue'],
    mode: 'normal',
    createdAt: 0,
    updatedAt: 0,
    unDeferredToolNames: new Set<string>(),
  }
}

describe('makeAwaySummaryTool', () => {
  it('exposes the documented tool name + permission hint', () => {
    const runner: AwaySummaryRunner = vi.fn()
    const tool = makeAwaySummaryTool(runner)
    expect(tool.name).toBe(AWAY_SUMMARY_TOOL_NAME)
    expect(tool.needsPermission({} as never)).toBe('none')
    expect(tool.annotations?.readOnly).toBe(true)
  })

  it('returns a friendly "no transcript" line when neither input nor session has messages', async () => {
    const runner: AwaySummaryRunner = vi.fn()
    const tool = makeAwaySummaryTool(runner)
    const ctx = makeCtx({ session: makeSession([]) })
    const result = await tool.run({}, ctx)
    expect(result.isError).toBe(false)
    expect(String(result.output)).toMatch(/no transcript available/i)
    expect(runner).not.toHaveBeenCalled()
  })

  it('delegates to runner with explicit input messages when provided', async () => {
    const runner = vi.fn().mockResolvedValue({
      text: 'You were refactoring auth. Next: wire idle hook.',
      tokensUsed: 42,
      modelUsed: 'claude-haiku-test',
    })
    const tool = makeAwaySummaryTool(runner)
    const result = await tool.run(
      {
        messages: [
          { role: 'user', text: 'fix auth' },
          { role: 'assistant', text: 'inspecting' },
        ],
      },
      makeCtx(),
    )
    expect(runner).toHaveBeenCalledOnce()
    const passed = runner.mock.calls[0]![0]
    expect(passed.messages).toHaveLength(2)
    expect(passed.messages[0].role).toBe('user')
    expect(passed.messages[1].role).toBe('assistant')
    expect(result.isError).toBe(false)
    expect(String(result.output)).toContain('You were refactoring auth')
    expect(String(result.output)).toContain('model=claude-haiku-test')
    expect(String(result.output)).toContain('tokens=42')
  })

  it('falls back to ctx.session.messages when input.messages is empty', async () => {
    const runner = vi.fn().mockResolvedValue({
      text: 'recap text',
      tokensUsed: 10,
      modelUsed: 'm',
    })
    const tool = makeAwaySummaryTool(runner)
    const sessionMessages: Message[] = [
      makeUserMessage({ text: 'session-user' }),
      assistantWithText('session-assistant'),
    ]
    await tool.run({}, makeCtx({ session: makeSession(sessionMessages) }))
    expect(runner).toHaveBeenCalledOnce()
    const passed = runner.mock.calls[0]![0]
    // The tool filters to renderable messages but should preserve order &
    // identity of each entry. With only user/assistant entries we expect a
    // deep-equal pass-through.
    expect(passed.messages).toStrictEqual(sessionMessages)
  })

  it('surfaces a null recap as a non-error "no recap" line', async () => {
    const runner = vi.fn().mockResolvedValue(null)
    const tool = makeAwaySummaryTool(runner)
    const result = await tool.run(
      { messages: [{ role: 'user', text: 'hi' }] },
      makeCtx(),
    )
    expect(result.isError).toBe(false)
    expect(String(result.output)).toMatch(/no recap/i)
  })

  it('surfaces a null recap as "aborted" when signal is aborted', async () => {
    const runner = vi.fn().mockResolvedValue(null)
    const tool = makeAwaySummaryTool(runner)
    const ac = new AbortController()
    ac.abort()
    const result = await tool.run(
      { messages: [{ role: 'user', text: 'hi' }] },
      makeCtx({ signal: ac.signal }),
    )
    expect(result.isError).toBe(false)
    expect(String(result.output)).toMatch(/aborted/i)
  })

  it('surfaces a runner exception as a tool error', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('boom'))
    const tool = makeAwaySummaryTool(runner)
    const result = await tool.run(
      { messages: [{ role: 'user', text: 'hi' }] },
      makeCtx(),
    )
    expect(result.isError).toBe(true)
    expect(String(result.output)).toContain('boom')
  })
})
