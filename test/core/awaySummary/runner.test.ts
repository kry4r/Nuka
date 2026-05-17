// test/core/awaySummary/runner.test.ts
//
// Verifies that createAwaySummaryRunner composes the runFork adapter,
// the awaySummary core, and the session-memory accessor correctly.
// No real provider is touched — `callModel` and `getSessionMemory`
// are injected for full DI.

import { describe, it, expect, vi } from 'vitest'
import {
  createAwaySummaryRunner,
  DEFAULT_AWAY_SUMMARY_MODEL,
} from '../../../src/core/awaySummary/runner'
import type { CallModelFn } from '../../../src/core/runFork/types'
import type { LLMProvider } from '../../../src/core/provider/types'
import { makeUserMessage } from '../../../src/core/message/factories'

// Empty stub provider — never invoked since we inject `callModel`.
const fakeProvider: LLMProvider = {
  id: 'fake',
  format: 'anthropic',
  // The real LLMProvider has additional methods (stream, listRemoteModels,
  // estimateTokens, ...). The runner never reads them when `callModel` is
  // injected, so a cast keeps the test lightweight.
} as unknown as LLMProvider

describe('createAwaySummaryRunner', () => {
  it('throws synchronously when provider is missing', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createAwaySummaryRunner({ provider: null as any }),
    ).toThrowError(/provider/i)
  })

  it('threads injected callModel through the runFork chain into the recap', async () => {
    const callModel: CallModelFn = vi.fn().mockResolvedValue({
      text: 'You were debugging the away-summary chain. Next: ship NN.',
      usage: { inputTokens: 50, outputTokens: 10 },
      modelUsed: 'fake-haiku',
    })
    const runner = createAwaySummaryRunner({
      provider: fakeProvider,
      callModel,
      // Disable memory lookup entirely so this test doesn't depend on
      // FS state.
      getSessionMemory: null,
    })
    const result = await runner({
      messages: [makeUserMessage({ text: 'fix the bug' })],
      signal: new AbortController().signal,
    })
    expect(callModel).toHaveBeenCalledOnce()
    expect(result).not.toBeNull()
    expect(result!.text).toBe(
      'You were debugging the away-summary chain. Next: ship NN.',
    )
    expect(result!.modelUsed).toBe('fake-haiku')
    expect(result!.tokensUsed).toBe(60)

    // CallModelInput.model defaults to DEFAULT_AWAY_SUMMARY_MODEL.
    const arg = (callModel as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.model).toBe(DEFAULT_AWAY_SUMMARY_MODEL)
  })

  it('returns null when transcript is empty', async () => {
    const callModel: CallModelFn = vi.fn()
    const runner = createAwaySummaryRunner({
      provider: fakeProvider,
      callModel,
      getSessionMemory: null,
    })
    const result = await runner({
      messages: [],
      signal: new AbortController().signal,
    })
    expect(result).toBeNull()
    expect(callModel).not.toHaveBeenCalled()
  })

  it('uses the injected getSessionMemory and inlines its content', async () => {
    const callModel: CallModelFn = vi.fn().mockResolvedValue({
      text: 'recap',
      usage: { inputTokens: 5, outputTokens: 1 },
      modelUsed: 'fake-haiku',
    })
    const getSessionMemory = vi.fn().mockResolvedValue('REMEMBER: ship NN')
    const runner = createAwaySummaryRunner({
      provider: fakeProvider,
      callModel,
      getSessionMemory,
    })
    await runner({
      messages: [makeUserMessage({ text: 'hi' })],
      signal: new AbortController().signal,
    })
    expect(getSessionMemory).toHaveBeenCalledOnce()
    const prompt = (callModel as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .prompt as string
    expect(prompt).toContain('REMEMBER: ship NN')
  })

  it('honors a custom modelName override', async () => {
    const callModel: CallModelFn = vi.fn().mockResolvedValue({
      text: 'recap',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelUsed: 'other-model',
    })
    const runner = createAwaySummaryRunner({
      provider: fakeProvider,
      callModel,
      modelName: 'other-model',
      getSessionMemory: null,
    })
    await runner({
      messages: [makeUserMessage({ text: 'x' })],
      signal: new AbortController().signal,
    })
    const arg = (callModel as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.model).toBe('other-model')
  })
})
