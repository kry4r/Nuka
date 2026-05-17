// src/core/awaySummary/awaySummaryTool.ts
//
// Agent-callable Tool surface for `generateAwaySummary`. Lets the
// model trigger a "while you were away" recap on demand — useful when
// the harness is about to PushNotification the user back, when an
// /loop iter wakes from a long delay, or when the model deliberately
// wants a compressed view of recent transcript without spending its
// own tokens.
//
// Composition:
//   - Tool input: `{ messages?: { role, text }[] }` — when omitted,
//     the tool falls back to `ctx.session?.messages ?? []`.
//   - Tool output: the recap text plus metadata (tokensUsed,
//     modelUsed, elapsedMs). On null result, the tool returns a
//     friendly "no recap" line rather than an error.
//
// Bindings:
//   - The runner is injected at registration time via
//     `makeAwaySummaryTool(runner)`. This keeps the Tool itself a
//     pure function of the runner — tests pass a fake runner and the
//     production wiring in cli.tsx calls `createAwaySummaryRunner`
//     with the active provider.
//
// Permission: none. The tool only reads transcript + memory and
// issues a single small-model call; it does not touch the FS, does
// not run subprocesses, and does not surface anything destructive.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import type {
  AssistantMessage,
  Message,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '../message/types'
import { emptyAssistant } from '../message/factories'
import type { AwaySummaryRunner } from './runner'

export const AWAY_SUMMARY_TOOL_NAME = 'AwaySummary'

/**
 * Compact transcript entry the model may pass when it wants the
 * recap to include text the active session doesn't have. Each entry
 * is lowered to a Message before being handed to the runner.
 *
 * `role` is loose — anything other than 'user'/'assistant' is
 * treated as 'user' since the recap prompt only renders user +
 * assistant content anyway.
 */
export type AwaySummaryToolMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type AwaySummaryToolInput = {
  /**
   * Optional explicit transcript. When omitted (or empty), the tool
   * uses `ctx.session?.messages`. Empty + no session → returns a
   * "no transcript available" line.
   */
  messages?: AwaySummaryToolMessage[]
}

function loweredMessage(m: AwaySummaryToolMessage): Message {
  if (m.role === 'assistant') {
    const a: AssistantMessage = emptyAssistant()
    a.content = [{ type: 'text', text: m.text }]
    return a
  }
  const u: UserMessage = {
    role: 'user',
    id: `awaysum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    content: [{ type: 'text', text: m.text }],
  }
  return u
}

function isRenderable(m: Message): m is UserMessage | AssistantMessage | ToolMessage | SystemMessage {
  return m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system'
}

/**
 * Factory — produces the agent-callable Tool bound to a specific
 * `AwaySummaryRunner`. The runner is what actually issues the model
 * call; this wrapper just packages context + handles fallback
 * messaging when the recap returns null.
 *
 * @example
 * ```ts
 * const runner = createAwaySummaryRunner({ provider })
 * tools.register(makeAwaySummaryTool(runner))
 * ```
 */
export function makeAwaySummaryTool(
  runner: AwaySummaryRunner,
): Tool<AwaySummaryToolInput> {
  return defineTool<AwaySummaryToolInput>({
    name: AWAY_SUMMARY_TOOL_NAME,
    description:
      'Generate a short "while you were away" recap (1-3 sentences) of the recent transcript. ' +
      'Use this when the user is returning after stepping away, when an /loop iter wakes from a long delay, ' +
      'or when you want a compressed view of recent activity without spending your own tokens. ' +
      'The recap is produced by a small/fast model and capped at ~400 characters. ' +
      'When `messages` is omitted, the tool summarizes the active session transcript.',
    parameters: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          description:
            'Optional explicit transcript window. Each entry is `{ role: "user"|"assistant", text: string }`. ' +
            'When omitted, the tool summarizes the active session messages.',
          items: {
            type: 'object',
            required: ['role', 'text'],
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              text: { type: 'string' },
            },
          },
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'recap'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['away', 'recap', 'summary', 'while', 'returned'],
    async run(
      input: AwaySummaryToolInput,
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const explicit = (input.messages ?? []).filter(
        (m) => typeof m.text === 'string' && m.text.length > 0,
      )
      const messages: Message[] =
        explicit.length > 0
          ? explicit.map(loweredMessage)
          : (ctx.session?.messages ?? []).filter(isRenderable)
      if (messages.length === 0) {
        return {
          isError: false,
          output: 'AwaySummary: no transcript available to summarize.',
        }
      }
      const started = Date.now()
      let result
      try {
        result = await runner({ messages, signal: ctx.signal })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          isError: true,
          output: `AwaySummary: runner failed — ${msg}`,
        }
      }
      const elapsedMs = Date.now() - started
      if (result === null) {
        return {
          isError: false,
          output:
            ctx.signal.aborted
              ? `AwaySummary: aborted after ${elapsedMs}ms (no recap).`
              : `AwaySummary: model returned no recap (${elapsedMs}ms).`,
        }
      }
      const lines = [
        result.text,
        `--`,
        `model=${result.modelUsed} tokens=${result.tokensUsed} elapsedMs=${elapsedMs}`,
      ]
      return { isError: false, output: lines.join('\n') }
    },
  })
}
