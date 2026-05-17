// src/core/runFork/anthropicCallModel.ts
//
// Production binding for `CallModelFn`. Wraps Nuka's existing
// `LLMProvider` abstraction (see `src/core/provider/types.ts`) so the
// runForkedAgent adapter uses whatever SDK + auth + headers the rest
// of Nuka already uses.
//
// This file is intentionally tiny:
//
//   • Build an `LLMRequest` from `CallModelInput`.
//   • Consume the provider stream until `message_stop`, accumulating
//     `text_delta` events and capturing the final `usage`.
//   • Return `{ text, usage, modelUsed }`.
//
// Tool-use deltas are ignored — runForkedAgent calls do not pass
// tools, so the provider should never emit them in the first place,
// but we tolerate them to keep the stream-drain robust.
//
// This module does network I/O *via the provider it is given*.
// Tests for `runForkedAgent.ts` do NOT import this file — they pass
// a fake `callModel` directly. There is no global singleton here.

import type {
  LLMProvider,
  LLMRequest,
  ProviderEvent,
  ToolSpec,
} from '../provider/types'
import type { Message } from '../message/types'
import type { CallModelFn, CallModelInput, RunForkResult } from './types'

/** No tools are exposed to one-shot fork calls. */
const NO_TOOLS: ToolSpec[] = []

/**
 * Build a `CallModelFn` backed by an `LLMProvider` instance.
 *
 * @example
 * ```ts
 * const { provider } = providerResolver.resolveFor(session)
 * const callModel = createAnthropicCallModel(provider)
 * const runFork = createRunForkedAgent({
 *   callModel,
 *   modelName: 'claude-haiku-4-5',
 * })
 * ```
 *
 * Re-throws upstream errors with the offending model + a `cause`
 * chain so the surrounding `runForkedAgent` catch frame can wrap
 * the message cleanly without losing the original.
 */
export function createAnthropicCallModel(provider: LLMProvider): CallModelFn {
  return async function callModel(
    input: CallModelInput,
  ): Promise<RunForkResult> {
    const messages: Message[] = [
      {
        role: 'user',
        // ulid-style id is not required for one-shot calls; the
        // provider does not echo the id back and the message is not
        // recorded into any transcript. A stable synthetic prefix
        // keeps the field non-empty without pulling in `ulid`.
        id: `runfork-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        ts: Date.now(),
        content: [{ type: 'text', text: input.prompt }],
      },
    ]

    const req: LLMRequest = {
      model: input.model,
      system: input.systemPrompt,
      messages,
      tools: NO_TOOLS,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    }

    let text = ''
    let result: RunForkResult | undefined

    try {
      for await (const ev of provider.stream(req, input.signal)) {
        const e: ProviderEvent = ev
        if (e.type === 'text_delta') {
          text += e.text
        } else if (e.type === 'message_stop') {
          result = {
            text,
            usage: e.usage,
            modelUsed: input.model,
          }
        }
        // tool_use_* events: ignored — see file header.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `anthropicCallModel stream failed (model=${input.model}): ${message}`,
        { cause: err },
      )
    }

    if (result === undefined) {
      // Stream ended without a `message_stop`. Return what we have so
      // callers downstream of `runForkedAgent` can still observe the
      // partial text — but mark `usage` absent.
      return { text, modelUsed: input.model }
    }
    return result
  }
}
