// src/core/awaySummary/summary.ts
//
// AwaySummary — generates a short "while you were away" recap for the user
// when they return after a quiet period. Mirrors upstream Nuka-Code's
// `services/awaySummary.ts` (generateAwaySummary), but adapted to Nuka's
// dependency-injection style: rather than reaching into a singleton model
// query helper, the caller supplies a `runFork` callable (matching the
// shape of `runForkedAgent` in src/core/agent/forkedAgent.ts) plus an
// optional `getSessionMemoryContent` accessor.
//
// Design notes (deviations from upstream):
//
//   1. Pure dependency-injection seam. Upstream calls
//      `queryModelWithoutStreaming` directly with a hard-coded
//      `getSmallFastModel()`. We don't have that singleton wired yet; this
//      port keeps the model choice and provider entirely on the caller
//      side. A follow-up wiring iter can plug `runForkedAgent` (or any
//      future small-fast-model helper) into the seam.
//
//   2. Returns null on empty transcript / abort / fork error — same
//      semantics as upstream, so callers can treat "no recap" uniformly.
//      A successful run returns `{ text, tokensUsed, modelUsed }`.
//
//   3. Recap window of 30 messages, same as upstream's
//      RECENT_MESSAGE_WINDOW. Tail-only (newest first) — Nuka's `Message`
//      union covers user/assistant/tool/system but the recap only renders
//      user + assistant text content; tool calls and system messages are
//      skipped to avoid spamming the recap prompt with serialized tool
//      output that the small model would just have to discard.
//
//   4. The recap output is hard-capped at 400 characters after trimming.
//      Upstream returns whatever the model produces; we hard-cap so
//      consumers don't need a second guard. (Earlier Phase 14c port
//      `src/core/recap/awaySummary.ts` shared this cap and has since
//      been merged into this file — see docs/plans/2026-05-17… P1 #7.)
//
// IMPORTANT: this module does NOT wire into the live REPL or notification
// pipeline. The caller decides when to invoke it (idle-watcher, returning
// session hook, missed-task surfacing, etc.) and supplies the deps.

import type { Message, TokenUsage } from '../message/types'

/** Number of trailing transcript messages forwarded to the small model. */
export const RECENT_MESSAGE_WINDOW = 30

/** Hard cap on the returned recap text, matching the existing recap port. */
export const AWAY_SUMMARY_MAX_CHARS = 400

const AWAY_SUMMARY_PROMPT_BASE =
  'The user stepped away and is coming back. Write exactly 1-3 short sentences. ' +
  'Start by stating the high-level task — what they are building or debugging, not implementation details. ' +
  'Next: the concrete next step. Skip status reports and commit recaps.'

export type RunForkResult = {
  text: string
  usage?: TokenUsage
  modelUsed?: string
}

/**
 * Fork callable. Accepts the recap prompt (already includes the
 * transcript window + optional session memory) and an abort signal,
 * returns the model's reply text plus usage/model metadata.
 */
export type RunForkFn = (
  prompt: string,
  signal: AbortSignal,
) => Promise<RunForkResult>

/**
 * Optional accessor for session memory (long-running context the user
 * has accumulated for this session). Returns null if no memory is
 * configured or readable.
 */
export type GetSessionMemoryFn = () => Promise<string | null>

export type AwaySummaryDeps = {
  runFork: RunForkFn
  getSessionMemoryContent?: GetSessionMemoryFn
}

export type AwaySummaryInput = {
  messages: readonly Message[]
  signal: AbortSignal
  deps: AwaySummaryDeps
}

export type AwaySummaryResult = {
  text: string
  tokensUsed: number
  modelUsed: string
}

/**
 * Render a single Message into a compact "[role] text" line for the
 * recap prompt. Skips tool / system messages and messages with no
 * usable text content. Returns null if the message contributes nothing.
 */
function renderMessageForPrompt(message: Message): string | null {
  if (message.role === 'system' || message.role === 'tool') return null
  const textParts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim().length > 0) {
      textParts.push(block.text)
    }
  }
  if (textParts.length === 0) return null
  return `[${message.role}] ${textParts.join(' ')}`
}

function buildPrompt(messages: readonly Message[], memory: string | null): string {
  const memoryBlock = memory && memory.trim().length > 0
    ? `Session memory (broader context):\n${memory.trim()}\n\n`
    : ''
  const rendered: string[] = []
  for (const m of messages) {
    const line = renderMessageForPrompt(m)
    if (line !== null) rendered.push(line)
  }
  const transcript = rendered.length > 0
    ? `Recent transcript:\n${rendered.join('\n')}\n\n`
    : ''
  return `${memoryBlock}${transcript}${AWAY_SUMMARY_PROMPT_BASE}`
}

/**
 * Generate a "while you were away" recap.
 *
 * Returns `null` when:
 *   - `messages` is empty (nothing to summarize),
 *   - the signal aborted before or during the fork,
 *   - the fork callable threw (error is swallowed; caller treats null
 *     as "no recap available" rather than a hard failure).
 *
 * Returns `{ text, tokensUsed, modelUsed }` on success. `text` is
 * trimmed and capped at `AWAY_SUMMARY_MAX_CHARS`.
 */
export async function generateAwaySummary(
  input: AwaySummaryInput,
): Promise<AwaySummaryResult | null> {
  const { messages, signal, deps } = input
  if (messages.length === 0) return null
  if (signal.aborted) return null

  let memory: string | null = null
  if (deps.getSessionMemoryContent) {
    try {
      memory = await deps.getSessionMemoryContent()
    } catch {
      // Memory failures are non-fatal — fall through with no memory.
      memory = null
    }
  }
  if (signal.aborted) return null

  const recent = messages.slice(-RECENT_MESSAGE_WINDOW)
  const prompt = buildPrompt(recent, memory)

  let forkResult: RunForkResult
  try {
    forkResult = await deps.runFork(prompt, signal)
  } catch {
    return null
  }
  if (signal.aborted) return null

  const trimmed = forkResult.text.trim()
  if (trimmed.length === 0) return null
  const text = trimmed.slice(0, AWAY_SUMMARY_MAX_CHARS)
  const tokensUsed =
    (forkResult.usage?.inputTokens ?? 0) +
    (forkResult.usage?.outputTokens ?? 0)
  const modelUsed = forkResult.modelUsed ?? 'unknown'

  return { text, tokensUsed, modelUsed }
}
