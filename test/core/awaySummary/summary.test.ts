// test/core/awaySummary/summary.test.ts
import { describe, it, expect, vi, type MockedFunction } from 'vitest'
import {
  generateAwaySummary,
  AWAY_SUMMARY_MAX_CHARS,
  RECENT_MESSAGE_WINDOW,
  type RunForkFn,
  type GetSessionMemoryFn,
} from '../../../src/core/awaySummary/summary'
import {
  makeUserMessage,
  makeSystemMessage,
  makeToolMessage,
  emptyAssistant,
} from '../../../src/core/message/factories'
import type {
  AssistantMessage,
  Message,
} from '../../../src/core/message/types'

type MockedFork = MockedFunction<RunForkFn>
type MockedMemory = MockedFunction<GetSessionMemoryFn>

function assistantWithText(text: string): AssistantMessage {
  const m = emptyAssistant()
  m.content = [{ type: 'text', text }]
  return m
}

describe('generateAwaySummary', () => {
  it('returns null on empty messages', async () => {
    const runFork: MockedFork = vi.fn()
    const result = await generateAwaySummary({
      messages: [],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result).toBeNull()
    expect(runFork).not.toHaveBeenCalled()
  })

  it('returns null when signal already aborted', async () => {
    const runFork: MockedFork = vi.fn()
    const ac = new AbortController()
    ac.abort()
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'hello' })],
      signal: ac.signal,
      deps: { runFork },
    })
    expect(result).toBeNull()
    expect(runFork).not.toHaveBeenCalled()
  })

  it('calls runFork once with the recap prompt and returns trimmed/capped text', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: '  You were refactoring the recap pipeline. Next: wire the cron seam.  ',
      usage: { inputTokens: 100, outputTokens: 30 },
      modelUsed: 'claude-haiku-test',
    })
    const result = await generateAwaySummary({
      messages: [
        makeUserMessage({ text: 'fix the bug' }),
        assistantWithText('inspecting types'),
      ],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(runFork).toHaveBeenCalledOnce()
    expect(result).not.toBeNull()
    expect(result!.text).toBe(
      'You were refactoring the recap pipeline. Next: wire the cron seam.',
    )
    expect(result!.tokensUsed).toBe(130)
    expect(result!.modelUsed).toBe('claude-haiku-test')

    const promptArg = runFork.mock.calls[0]![0]
    expect(promptArg).toContain('stepped away and is coming back')
    expect(promptArg).toContain('[user] fix the bug')
    expect(promptArg).toContain('[assistant] inspecting types')
  })

  it('caps text at AWAY_SUMMARY_MAX_CHARS', async () => {
    const big = 'y'.repeat(800)
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: big,
      usage: { inputTokens: 0, outputTokens: 0 },
      modelUsed: 'm',
    })
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'go' })],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result).not.toBeNull()
    expect(result!.text.length).toBe(AWAY_SUMMARY_MAX_CHARS)
  })

  it('returns null when runFork throws (errors are swallowed)', async () => {
    const runFork: MockedFork = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'go' })],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result).toBeNull()
  })

  it('returns null when runFork returns empty text', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: '   ',
      usage: { inputTokens: 5, outputTokens: 0 },
      modelUsed: 'm',
    })
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'go' })],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result).toBeNull()
  })

  it('returns null when signal aborts mid-fork', async () => {
    const ac = new AbortController()
    const runFork: MockedFork = vi.fn().mockImplementation(async () => {
      ac.abort()
      return { text: 'too late', usage: { inputTokens: 1, outputTokens: 1 } }
    })
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'go' })],
      signal: ac.signal,
      deps: { runFork },
    })
    expect(result).toBeNull()
  })

  it('includes session memory content in the prompt when provided', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'recap',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelUsed: 'm',
    })
    const getSessionMemoryContent: MockedMemory = vi
      .fn()
      .mockResolvedValue('Project is Nuka. Convention: vitest + zod.')
    await generateAwaySummary({
      messages: [makeUserMessage({ text: 'hi' })],
      signal: new AbortController().signal,
      deps: { runFork, getSessionMemoryContent },
    })
    expect(getSessionMemoryContent).toHaveBeenCalledOnce()
    const promptArg = runFork.mock.calls[0]![0]
    expect(promptArg).toContain('Session memory (broader context):')
    expect(promptArg).toContain('Project is Nuka.')
  })

  it('continues without memory when getSessionMemoryContent throws', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelUsed: 'm',
    })
    const getSessionMemoryContent: MockedMemory = vi
      .fn()
      .mockRejectedValue(new Error('fs error'))
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'hi' })],
      signal: new AbortController().signal,
      deps: { runFork, getSessionMemoryContent },
    })
    expect(result).not.toBeNull()
    const promptArg = runFork.mock.calls[0]![0]
    expect(promptArg).not.toContain('Session memory')
  })

  it('skips system and tool messages and empty assistant text when building the prompt', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelUsed: 'm',
    })
    const messages: Message[] = [
      makeSystemMessage('system rules'),
      makeUserMessage({ text: 'hi' }),
      emptyAssistant(),
      assistantWithText('assistant reply'),
      makeToolMessage('use-1', { output: 'tool out', isError: false }),
    ]
    await generateAwaySummary({
      messages,
      signal: new AbortController().signal,
      deps: { runFork },
    })
    const promptArg = runFork.mock.calls[0]![0]
    expect(promptArg).toContain('[user] hi')
    expect(promptArg).toContain('[assistant] assistant reply')
    expect(promptArg).not.toContain('system rules')
    expect(promptArg).not.toContain('tool out')
  })

  it('truncates transcript to RECENT_MESSAGE_WINDOW', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelUsed: 'm',
    })
    const many: Message[] = []
    for (let i = 0; i < RECENT_MESSAGE_WINDOW + 10; i++) {
      many.push(makeUserMessage({ text: `msg-${i}` }))
    }
    await generateAwaySummary({
      messages: many,
      signal: new AbortController().signal,
      deps: { runFork },
    })
    const promptArg = runFork.mock.calls[0]![0]
    // First 10 messages should be dropped; last 30 kept.
    expect(promptArg).not.toContain('msg-0\n')
    expect(promptArg).not.toContain('[user] msg-9 ')
    expect(promptArg).toContain('msg-10')
    expect(promptArg).toContain(`msg-${RECENT_MESSAGE_WINDOW + 9}`)
  })

  it('defaults modelUsed to "unknown" when fork omits it', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'recap',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'hi' })],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result?.modelUsed).toBe('unknown')
  })

  it('defaults tokensUsed to 0 when fork omits usage', async () => {
    const runFork: MockedFork = vi.fn().mockResolvedValue({
      text: 'recap',
      modelUsed: 'm',
    })
    const result = await generateAwaySummary({
      messages: [makeUserMessage({ text: 'hi' })],
      signal: new AbortController().signal,
      deps: { runFork },
    })
    expect(result?.tokensUsed).toBe(0)
  })
})
