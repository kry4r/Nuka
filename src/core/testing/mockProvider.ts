// src/core/testing/mockProvider.ts
//
// Phase 9 §7 — scriptable LLMProvider used by the auto-test harness.
//
// Yields scripted text deltas in order, terminating each turn with a single
// `message_stop` event carrying `stopReason: 'end_turn'` and the response's
// optional `usage` block (or zeros). The real ProviderEvent union has no
// separate `usage` event — usage is folded into `message_stop`.

import type { LLMProvider, LLMRequest, ProviderEvent, ProviderFormat } from '../provider/types'
import type { ProviderResponse } from './plan'

export type MockProviderOpts = {
  id?: string
  format?: ProviderFormat
  responses?: ProviderResponse[]
}

export class MockProvider implements LLMProvider {
  readonly id: string
  readonly format: ProviderFormat
  private queue: ProviderResponse[]

  constructor(opts: MockProviderOpts = {}) {
    this.id = opts.id ?? 'mock'
    this.format = opts.format ?? 'anthropic'
    this.queue = opts.responses ? [...opts.responses] : []
  }

  /** Append a scripted response (used by `mock` plan steps). */
  append(response: ProviderResponse): void {
    this.queue.push(response)
  }

  /** Replace the entire queue. */
  setResponses(responses: ProviderResponse[]): void {
    this.queue = [...responses]
  }

  /** Number of remaining scripted responses (for assertions in tests). */
  remaining(): number {
    return this.queue.length
  }

  async listRemoteModels(): Promise<string[]> {
    return []
  }

  async *stream(_req: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    void _req
    const r = this.queue.shift()
    if (!r) {
      throw new Error('MockProvider: no scripted response left')
    }
    for (const d of r.delta) {
      if (signal.aborted) return
      yield { type: 'text_delta', text: d.text }
    }
    if (signal.aborted) return
    const usage = r.usage ?? { inputTokens: 0, outputTokens: 0 }
    yield {
      type: 'message_stop',
      stopReason: 'end_turn',
      usage,
    }
  }
}
