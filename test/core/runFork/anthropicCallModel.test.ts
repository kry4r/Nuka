// test/core/runFork/anthropicCallModel.test.ts
//
// Unit tests for the production `CallModelFn` binding. We feed a
// hand-rolled fake `LLMProvider` (matching the existing pattern in
// `test/core/provider/anthropic.test.ts`) and assert that the
// callModel returns the accumulated text + final usage.

import { describe, it, expect, vi } from 'vitest'
import { createAnthropicCallModel } from '../../../src/core/runFork/anthropicCallModel'
import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
} from '../../../src/core/provider/types'

/**
 * Minimal fake provider. The fork adapter only consumes
 * `provider.stream(req, signal)`; `id`, `format`, and
 * `listRemoteModels` are required by the interface but never used.
 */
function fakeProvider(
  events: ProviderEvent[],
  capture?: { req?: LLMRequest; signal?: AbortSignal },
): LLMProvider {
  return {
    id: 'fake',
    format: 'anthropic',
    async *stream(req, signal) {
      if (capture) {
        capture.req = req
        capture.signal = signal
      }
      for (const ev of events) yield ev
    },
    async listRemoteModels() {
      return []
    },
  }
}

describe('createAnthropicCallModel', () => {
  it('accumulates text_delta events and returns the final usage from message_stop', async () => {
    const captured: { req?: LLMRequest; signal?: AbortSignal } = {}
    const provider = fakeProvider(
      [
        { type: 'text_delta', text: 'hello' },
        { type: 'text_delta', text: ' world' },
        {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: {
            inputTokens: 12,
            outputTokens: 4,
            cacheReadTokens: 2,
            cacheWriteTokens: 0,
          },
        },
      ],
      captured,
    )
    const callModel = createAnthropicCallModel(provider)
    const signal = new AbortController().signal
    const result = await callModel({
      model: 'claude-haiku-test',
      systemPrompt: 'sys',
      prompt: 'do thing',
      maxTokens: 512,
      temperature: 0,
      signal,
    })
    expect(result.text).toBe('hello world')
    expect(result.modelUsed).toBe('claude-haiku-test')
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
    })

    // Sanity: req shape passed to the provider.
    expect(captured.req).toBeDefined()
    expect(captured.signal).toBe(signal)
    expect(captured.req!.model).toBe('claude-haiku-test')
    expect(captured.req!.system).toBe('sys')
    expect(captured.req!.maxTokens).toBe(512)
    expect(captured.req!.temperature).toBe(0)
    expect(captured.req!.tools).toEqual([])
    expect(captured.req!.messages).toHaveLength(1)
    expect(captured.req!.messages[0]!.role).toBe('user')
    const block = (captured.req!.messages[0] as { content: Array<{ type: string; text?: string }> }).content[0]!
    expect(block.type).toBe('text')
    expect(block.text).toBe('do thing')
  })

  it('returns partial text when stream ends without message_stop (no usage)', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', text: 'partial' },
    ])
    const callModel = createAnthropicCallModel(provider)
    const result = await callModel({
      model: 'm',
      systemPrompt: '',
      prompt: 'x',
      maxTokens: 16,
      temperature: 0,
      signal: new AbortController().signal,
    })
    expect(result.text).toBe('partial')
    expect(result.modelUsed).toBe('m')
    expect(result.usage).toBeUndefined()
  })

  it('ignores tool_use_* events without throwing', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', text: 'before ' },
      { type: 'tool_use_start', id: 'tu1', name: 'noop' },
      { type: 'tool_use_args_delta', id: 'tu1', delta: '{}' },
      { type: 'tool_use_stop', id: 'tu1', input: {} },
      { type: 'text_delta', text: 'after' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ])
    const callModel = createAnthropicCallModel(provider)
    const result = await callModel({
      model: 'm',
      systemPrompt: '',
      prompt: 'x',
      maxTokens: 16,
      temperature: 0,
      signal: new AbortController().signal,
    })
    expect(result.text).toBe('before after')
  })

  it('wraps provider stream errors with the model name and a cause chain', async () => {
    const provider: LLMProvider = {
      id: 'fake',
      format: 'anthropic',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('upstream HTTP 500')
      },
      async listRemoteModels() {
        return []
      },
    }
    const callModel = createAnthropicCallModel(provider)
    try {
      await callModel({
        model: 'claude-haiku-1',
        systemPrompt: '',
        prompt: 'x',
        maxTokens: 16,
        temperature: 0,
        signal: new AbortController().signal,
      })
      expect.fail('callModel should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      const e = err as Error & { cause?: unknown }
      expect(e.message).toContain('claude-haiku-1')
      expect(e.message).toContain('upstream HTTP 500')
      expect((e.cause as Error).message).toBe('upstream HTTP 500')
    }
  })

  it('integrates with createRunForkedAgent end-to-end without network', async () => {
    // Local import to keep this test colocated with the wiring it asserts.
    const { createRunForkedAgent } = await import(
      '../../../src/core/runFork/runForkedAgent'
    )
    const provider = fakeProvider([
      { type: 'text_delta', text: 'recap' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 2 },
      },
    ])
    const runFork = createRunForkedAgent({
      callModel: createAnthropicCallModel(provider),
      modelName: 'haiku-int',
      defaults: { maxTokens: 64, temperature: 0 },
    })
    const result = await runFork({ prompt: 'summarize' })
    expect(result.text).toBe('recap')
    expect(result.modelUsed).toBe('haiku-int')
    expect(result.usage?.inputTokens).toBe(5)
  })

  it('uses no tools (one-shot calls do not expose tools)', async () => {
    const captured: { req?: LLMRequest } = {}
    const provider = fakeProvider(
      [
        { type: 'text_delta', text: 'ok' },
        {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
      captured,
    )
    const callModel = createAnthropicCallModel(provider)
    await callModel({
      model: 'm',
      systemPrompt: '',
      prompt: 'x',
      maxTokens: 16,
      temperature: 0,
      signal: new AbortController().signal,
    })
    expect(captured.req!.tools).toEqual([])
  })
})

// Silence "unused" warning if vi is shadowed by a future linter rule.
void vi
