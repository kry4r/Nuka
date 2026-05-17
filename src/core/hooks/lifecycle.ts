// src/core/hooks/lifecycle.ts
//
// Lifecycle hook fire helpers. Thin wrappers over `HookRegistry.invoke` for
// the broader-than-tool events: sessionStart / sessionEnd / promptSubmit /
// afterTurn / beforeAutoCompact.
//
// Why a separate helper file rather than inlining `registry.invoke(...)` at
// every call site:
//   - The same payload shape and signal-default policy applies to every
//     lifecycle fire. Centralising it keeps the agent loop / cli.tsx call
//     sites short and prevents drift (e.g. one site forgetting to set a
//     timeout signal).
//   - Tests for the wiring can target these helpers directly without
//     spinning up the full agent loop — the deep call sites just thread
//     the helper through.
//
// All helpers are best-effort: they never throw. The underlying
// `HookRegistry.invoke` already isolates per-handler errors into the
// returned `InvocationResult[]`; we catch any registry-level throw too
// (shouldn't happen, but cheap insurance) so a buggy registry can never
// crash the lifecycle path.

import type { HookRegistry } from './registry'
import type { InvocationResult } from './events'
import type { AssistantMessage, ContentBlock } from '../message/types'

/** Hard default timeout for any lifecycle fire. Generous because handlers
 *  may do non-trivial work (memory sync, telemetry flush, etc.). */
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 5000

type FireOptions = {
  /** Optional caller-supplied signal. Combined with the lifecycle timeout. */
  signal?: AbortSignal
  /** Override the default 5s timeout. Pass 0 to disable the timeout entirely. */
  timeoutMs?: number
}

/**
 * Compose the caller's signal (if any) with a fresh timeout signal. Returns
 * `undefined` when both are absent so the registry treats it as no signal.
 */
function withTimeout(opts: FireOptions | undefined): AbortSignal | undefined {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS
  const callerSignal = opts?.signal
  if (timeoutMs <= 0) return callerSignal
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!callerSignal) return timeoutSignal
  // Node 20+ has AbortSignal.any; fall back to a manual race if absent.
  type AbortSignalCtor = typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }
  const ctor = AbortSignal as AbortSignalCtor
  if (typeof ctor.any === 'function') return ctor.any([callerSignal, timeoutSignal])
  const composite = new AbortController()
  const abort = (): void => composite.abort()
  callerSignal.addEventListener('abort', abort, { once: true })
  timeoutSignal.addEventListener('abort', abort, { once: true })
  return composite.signal
}

async function safeInvoke(
  registry: HookRegistry,
  event: Parameters<HookRegistry['invoke']>[0],
  payload: Readonly<Record<string, unknown>>,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  try {
    return await registry.invoke(event, { payload }, { signal: withTimeout(opts) })
  } catch {
    return []
  }
}

/**
 * Identifies the execution context the lifecycle event fired from.
 *
 * - `'main'`     — the primary interactive agent loop (cli.tsx / loop.ts).
 *                  Default when the field is omitted, for backward
 *                  compatibility with the JJJ wiring that did not populate it.
 * - `'subagent'` — fired from inside `dispatchAgent` (an isolated
 *                  sub-session). Handlers can filter on this to skip work
 *                  that only makes sense for the user-facing session
 *                  (e.g. UI banners, away-summary reminders).
 * - `'task'`     — reserved for the background `local_agent` task path.
 *                  Not yet wired; included so future iters don't have to
 *                  re-shape the type.
 */
export type LifecycleContext = 'main' | 'subagent' | 'task'

export type SessionStartPayload = Readonly<{
  sessionId: string
  providerId: string
  model: string
  cwd: string
  resumed: boolean
  /** Execution context. Omitted = `'main'` (legacy JJJ behaviour). */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type SessionEndPayload = Readonly<{
  sessionId: string
  reason: 'sigint' | 'exit' | 'manual' | 'completed' | 'aborted'
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type PromptSubmitPayload = Readonly<{
  sessionId: string
  text: string
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type AfterTurnPayload = Readonly<{
  sessionId: string
  stopReason: string
  toolCalls: number
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type BeforeAutoCompactPayload = Readonly<{
  sessionId: string
  tokensBefore: number
  threshold: number
  contextWindow: number
}>

/**
 * Payload for `afterAssistantMessage` (P0 #2).
 *
 * Fires once per assistant message BEFORE it is appended to
 * `session.messages`. `text` is the concatenated text content of the
 * assembled assistant message (text blocks only — tool_use blocks are
 * skipped); when the model emitted no text content, `text === ''`.
 *
 * Mutable: a handler returning `{ data: { replaceText: '<new>' } }`
 * (where the value is a string) instructs the fire site to rewrite
 * the assistant text blocks before persistence. See the
 * `afterAssistantMessage` block in `events.ts` for the exact rules
 * (last-write-wins, empty-string semantics, content-block rewrite).
 */
export type AfterAssistantMessagePayload = Readonly<{
  sessionId: string
  text: string
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

/**
 * Fire `sessionStart` once the host wiring (registry, tools, plugins) is
 * settled and a session has been created. Called from cli.tsx after
 * `applyHookConfig` so user-defined handlers have a chance to register
 * before the event fires.
 */
export function fireSessionStart(
  registry: HookRegistry,
  payload: SessionStartPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'sessionStart', payload, opts)
}

/**
 * Fire `sessionEnd` on graceful or forced session disposal. The agent loop
 * does not own this — it's the host's responsibility (SIGINT / explicit
 * exit). Handlers should be brief: the fire is awaited inside the SIGINT
 * cleanup path with the rest of the flush work.
 */
export function fireSessionEnd(
  registry: HookRegistry,
  payload: SessionEndPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'sessionEnd', payload, opts)
}

/**
 * Fire `promptSubmit` immediately before the user's text is appended to
 * session.messages. Handlers can observe (and in future iters, mutate via
 * additionalContext) the prompt.
 */
export function firePromptSubmit(
  registry: HookRegistry,
  payload: PromptSubmitPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'promptSubmit', payload, opts)
}

/**
 * Fire `afterTurn` when the model emits a stop reason that ends the turn
 * (no further tool calls pending). Mirrors the shell-hook `afterTurn` event.
 */
export function fireAfterTurn(
  registry: HookRegistry,
  payload: AfterTurnPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'afterTurn', payload, opts)
}

/**
 * Fire `afterAssistantMessage` immediately BEFORE an assistant message is
 * appended to `session.messages`. Fires once per model turn (an assistant
 * message may contain text + tool_use blocks; this event sees the
 * assembled message, not per stream delta).
 *
 * Mutable contract: a handler returning `{ data: { replaceText: '<new>' } }`
 * with a string value asks the fire site to rewrite the assistant text
 * blocks before persistence. Multi-handler resolution is
 * LAST-WRITE-WINS (each handler sees the original `payload.text`, not
 * a previous handler's replacement). Use {@link extractReplaceText}
 * on the returned `InvocationResult[]` to obtain the resolved value
 * (or `undefined` when no handler requested a rewrite).
 *
 * The fire helper itself does NOT mutate any caller state — it merely
 * surfaces the invocation results. The agent loop / dispatch wrapper
 * decides whether to apply the rewrite to the assembled message.
 */
export function fireAfterAssistantMessage(
  registry: HookRegistry,
  payload: AfterAssistantMessagePayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'afterAssistantMessage', payload, opts)
}

/**
 * Last-write-wins extraction of `data.replaceText` from an
 * `afterAssistantMessage` fire's invocation results. Walks the
 * results in order, keeping the LAST `replaceText` value where the
 * handler succeeded AND the value is a string. Non-string values
 * (`undefined` / `null` / numbers / objects) are ignored. Empty
 * string is a VALID replacement and will be returned as `''`.
 *
 * Returns `undefined` when no handler requested a rewrite.
 *
 * Lives next to `fireAfterAssistantMessage` so call sites do not
 * reinvent the extraction shape. Pure on the `results` array — no
 * side effects, no throws.
 */
export function extractReplaceText(
  results: readonly InvocationResult[],
): string | undefined {
  let resolved: string | undefined
  for (const r of results) {
    if (r.outcome !== 'success') continue
    const v = r.result?.data?.['replaceText']
    if (typeof v === 'string') resolved = v
  }
  return resolved
}

/**
 * Apply a resolved `replaceText` to an in-memory `AssistantMessage`,
 * mutating its `content` per the rewrite rule documented on the
 * `afterAssistantMessage` event in `events.ts`:
 *
 *   - All text blocks are replaced with a SINGLE text block carrying
 *     `replaceText`. The replacement sits at the index of the first
 *     pre-existing text block (preserves the relative position of
 *     interleaved tool_use blocks around it).
 *   - tool_use blocks are preserved verbatim in their original order
 *     (the model's tool calls are not the assistant's prose).
 *   - When the message had NO text block, a single text block carrying
 *     `replaceText` is PREPENDED to `content`.
 *
 * `replaceText === ''` is a valid replacement: the resulting block
 * carries an empty string but still exists, preserving the
 * "assistant emitted at least one text block" invariant relied on by
 * downstream consumers.
 *
 * Mutates `message` in place; returns nothing. Safe to call before
 * `appendMessage` since the message is still owned by the loop.
 */
export function applyReplaceTextToAssistant(
  message: AssistantMessage,
  replaceText: string,
): void {
  let firstTextIdx = -1
  for (let i = 0; i < message.content.length; i++) {
    const b = message.content[i]
    if (b && b.type === 'text') {
      firstTextIdx = i
      break
    }
  }
  const newTextBlock: ContentBlock = { type: 'text', text: replaceText }
  if (firstTextIdx === -1) {
    // No text block — prepend a fresh one in front of any tool_use blocks.
    message.content = [newTextBlock, ...message.content]
    return
  }
  // Strip ALL text blocks; keep tool_use blocks in order; insert the
  // replacement at the original first-text-block position. Walk once
  // building the new array.
  const next: ContentBlock[] = []
  let inserted = false
  for (let i = 0; i < message.content.length; i++) {
    const b = message.content[i]!
    if (b.type === 'text') {
      if (i === firstTextIdx && !inserted) {
        next.push(newTextBlock)
        inserted = true
      }
      // skip every text block (including the one we just replaced)
      continue
    }
    next.push(b)
  }
  // `inserted` is guaranteed true (firstTextIdx points at a text block
  // we walked past), but defensively prepend if a future refactor
  // breaks the invariant.
  if (!inserted) next.unshift(newTextBlock)
  message.content = next
}

/**
 * Fire `beforeAutoCompact` immediately before the agent loop decides to run
 * a compaction. A handler returning `{ skip: true }` vetoes the compaction
 * (mirrors `{ cancel: true }` from the shell-hook variant).
 *
 * Returns a digest the caller can act on directly.
 */
export async function fireBeforeAutoCompact(
  registry: HookRegistry,
  payload: BeforeAutoCompactPayload,
  opts?: FireOptions,
): Promise<{ skipped: boolean; reason?: string }> {
  const results = await safeInvoke(registry, 'beforeAutoCompact', payload, opts)
  for (const r of results) {
    if (r.outcome === 'success' && r.result?.skip === true) {
      return { skipped: true, reason: r.result.reason }
    }
  }
  return { skipped: false }
}
