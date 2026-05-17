// test/core/runFork/runForkedAgent.test.ts
//
// Unit tests for the `createRunForkedAgent` factory and the
// `adaptToAwaySummaryRunFork` bridge. No network I/O — `callModel` is
// always a `vi.fn()` returning a canned `RunForkResult`.

import { describe, it, expect, vi, type MockedFunction } from 'vitest'
import {
  createRunForkedAgent,
  adaptToAwaySummaryRunFork,
  DEFAULT_RUN_FORK_MAX_TOKENS,
  DEFAULT_RUN_FORK_TEMPERATURE,
} from '../../../src/core/runFork/runForkedAgent'
import type {
  CallModelFn,
  CallModelInput,
  RunForkResult,
} from '../../../src/core/runFork/types'

type MockedCall = MockedFunction<CallModelFn>

function fakeOk(over: Partial<RunForkResult> = {}): RunForkResult {
  return {
    text: 'ok',
    usage: { inputTokens: 10, outputTokens: 5 },
    modelUsed: 'fake-haiku',
    ...over,
  }
}

describe('createRunForkedAgent — construction', () => {
  it('throws synchronously when modelName is empty', () => {
    const callModel: MockedCall = vi.fn()
    expect(() =>
      createRunForkedAgent({ callModel, modelName: '' }),
    ).toThrowError(/modelName/)
  })

  it('throws synchronously when modelName is whitespace-only', () => {
    const callModel: MockedCall = vi.fn()
    expect(() =>
      createRunForkedAgent({ callModel, modelName: '   ' }),
    ).toThrowError(/modelName/)
  })
})

describe('createRunForkedAgent — happy path', () => {
  it('invokes callModel once with the prompt and returns its result', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'claude-haiku-test',
    })
    const result = await runFork({ prompt: 'summarize: x' })
    expect(callModel).toHaveBeenCalledOnce()
    expect(result).toEqual(fakeOk())
  })

  it('applies the documented defaults when no per-call overrides are supplied', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'claude-haiku-test',
    })
    await runFork({ prompt: 'hi' })
    const arg = callModel.mock.calls[0]![0]
    expect(arg.model).toBe('claude-haiku-test')
    expect(arg.maxTokens).toBe(DEFAULT_RUN_FORK_MAX_TOKENS)
    expect(arg.temperature).toBe(DEFAULT_RUN_FORK_TEMPERATURE)
    expect(arg.systemPrompt).toBe('')
    // signal exists (we supply a fresh AbortController.signal by default)
    expect(arg.signal).toBeInstanceOf(AbortSignal)
    expect(arg.signal.aborted).toBe(false)
  })

  it('applies factory defaults when per-call options omit them', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'm',
      defaults: { maxTokens: 256, temperature: 0.3, systemPrompt: 'be brief' },
    })
    await runFork({ prompt: 'hi' })
    const arg = callModel.mock.calls[0]![0]
    expect(arg.maxTokens).toBe(256)
    expect(arg.temperature).toBe(0.3)
    expect(arg.systemPrompt).toBe('be brief')
  })
})

describe('createRunForkedAgent — overrides', () => {
  it('per-call maxTokens override wins over factory default', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'm',
      defaults: { maxTokens: 256 },
    })
    await runFork({ prompt: 'hi', maxTokens: 2048 })
    expect(callModel.mock.calls[0]![0].maxTokens).toBe(2048)
  })

  it('per-call systemPrompt override wins over factory default', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'm',
      defaults: { systemPrompt: 'factory says brief' },
    })
    await runFork({ prompt: 'hi', systemPrompt: 'caller says verbose' })
    expect(callModel.mock.calls[0]![0].systemPrompt).toBe('caller says verbose')
  })

  it('per-call model override wins over factory modelName', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'haiku',
    })
    await runFork({ prompt: 'hi', model: 'sonnet' })
    expect(callModel.mock.calls[0]![0].model).toBe('sonnet')
  })

  it('per-call temperature override wins over factory default', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'm',
      defaults: { temperature: 0.1 },
    })
    await runFork({ prompt: 'hi', temperature: 1 })
    expect(callModel.mock.calls[0]![0].temperature).toBe(1)
  })

  it('forwards the caller-supplied AbortSignal to callModel', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({ callModel, modelName: 'm' })
    const ac = new AbortController()
    await runFork({ prompt: 'hi', signal: ac.signal })
    expect(callModel.mock.calls[0]![0].signal).toBe(ac.signal)
  })
})

describe('createRunForkedAgent — input validation', () => {
  it('throws when prompt is empty', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({ callModel, modelName: 'm' })
    await expect(runFork({ prompt: '' })).rejects.toThrow(/prompt/)
    expect(callModel).not.toHaveBeenCalled()
  })
})

describe('createRunForkedAgent — error propagation', () => {
  it('wraps callModel errors with model context, preserving cause', async () => {
    const original = new Error('upstream boom')
    const callModel: MockedCall = vi.fn().mockRejectedValue(original)
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'haiku-test',
    })
    try {
      await runFork({ prompt: 'hi' })
      // Should have thrown.
      expect.fail('runForkedAgent should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      const e = err as Error & { cause?: unknown }
      expect(e.message).toContain('haiku-test')
      expect(e.message).toContain('upstream boom')
      expect(e.cause).toBe(original)
    }
  })

  it('wraps non-Error throwables (string) with model context', async () => {
    const callModel: MockedCall = vi.fn().mockRejectedValue('plain string')
    const runFork = createRunForkedAgent({ callModel, modelName: 'm' })
    await expect(runFork({ prompt: 'hi' })).rejects.toThrow(/plain string/)
  })
})

describe('adaptToAwaySummaryRunFork', () => {
  it('produces a (prompt, signal) -> RunForkResult callable', async () => {
    const result = fakeOk({ text: 'recap text' })
    const callModel: MockedCall = vi.fn().mockResolvedValue(result)
    const runFork = createRunForkedAgent({ callModel, modelName: 'm' })
    const adapted = adaptToAwaySummaryRunFork(runFork)

    const ac = new AbortController()
    const out = await adapted('prompt here', ac.signal)
    expect(out).toEqual(result)

    const passed: CallModelInput = callModel.mock.calls[0]![0]
    expect(passed.prompt).toBe('prompt here')
    expect(passed.signal).toBe(ac.signal)
  })

  it('uses factory defaults — adapter does not let awaySummary pick a model', async () => {
    const callModel: MockedCall = vi.fn().mockResolvedValue(fakeOk())
    const runFork = createRunForkedAgent({
      callModel,
      modelName: 'claude-haiku-test',
      defaults: { maxTokens: 333, temperature: 0, systemPrompt: 'sys' },
    })
    const adapted = adaptToAwaySummaryRunFork(runFork)
    const ac = new AbortController()
    await adapted('p', ac.signal)
    const arg = callModel.mock.calls[0]![0]
    expect(arg.model).toBe('claude-haiku-test')
    expect(arg.maxTokens).toBe(333)
    expect(arg.systemPrompt).toBe('sys')
  })

  it('propagates errors through the adapter', async () => {
    const callModel: MockedCall = vi.fn().mockRejectedValue(new Error('boom'))
    const runFork = createRunForkedAgent({ callModel, modelName: 'm' })
    const adapted = adaptToAwaySummaryRunFork(runFork)
    await expect(adapted('p', new AbortController().signal)).rejects.toThrow(
      /boom/,
    )
  })
})
