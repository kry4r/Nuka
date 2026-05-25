// src/core/compact/compact.ts
import type { Session } from '../session/types'
import type { LLMProvider } from '../provider/types'
import type { AssistantMessage, Message, ResponsesCompactionMessage } from '../message/types'
import { microcompactToolResults, type MicrocompactToolResultsOptions } from './microCompact'
import { isContextWindowError } from './contextWindowError'
import { roughTokenCountEstimationForMessage } from '../tokens/estimate'
import { ulid } from 'ulid'

export const COMPACT_SUMMARY_MARKER = '[[compact-summary]]'

const COMPACT_SYSTEM = `You are a session summarizer for an AI coding assistant.
Produce a tight summary of the conversation so far. Cover:
  - User goals and any constraints
  - Decisions made
  - File paths touched and their current state
  - Tool calls and their outcomes
  - Open questions and pending TODOs
Keep it factual, under ~500 tokens. No preamble. No apologies.`

export type CompactOpts = {
  provider: LLMProvider
  model: string
  keepTurns?: number
  retainedMessageBudget?: number
  postCompactMicroCompact?: MicrocompactToolResultsOptions
  maxShrinkRetries?: number
}

function turnBoundaries(messages: Message[]): number[] {
  // Each user message starts a turn
  const idx: number[] = []
  messages.forEach((m, i) => { if (m.role === 'user') idx.push(i) })
  return idx
}

export async function compactSession(session: Session, opts: CompactOpts): Promise<void> {
  const keepTurns = opts.keepTurns ?? 3
  const cutBoundaryIndex = compactCutIndex(session.messages, keepTurns, opts.retainedMessageBudget)
  if (cutBoundaryIndex <= 0) return

  const older = session.messages.slice(0, cutBoundaryIndex)
  const kept = session.messages.slice(cutBoundaryIndex)

  if (opts.provider.compact) {
    const compacted = await compactWithShrinkRetry(older, opts)
    if (compacted.output.length > 0) {
      const summary: ResponsesCompactionMessage = {
        role: 'responses_compaction',
        provider: 'openai',
        output: compacted.output,
        id: ulid(),
        ts: Date.now(),
      }
      session.messages = applyPostCompactCleanup([summary, ...kept], opts)
      return
    }
  }

  const summaryText = await summarizeWithShrinkRetry(older, opts)

  const summary: AssistantMessage = {
    role: 'assistant',
    id: ulid(),
    ts: Date.now(),
    content: [
      {
        type: 'text',
        text: `${COMPACT_SUMMARY_MARKER}\n${formatCompactSummaryText(summaryText)}`,
      },
    ],
  }

  session.messages = applyPostCompactCleanup([summary, ...kept], opts)
}

function compactCutIndex(
  messages: Message[],
  keepTurns: number,
  retainedMessageBudget?: number,
): number {
  const boundaries = turnBoundaries(messages)
  const turnCut =
    boundaries.length > keepTurns
      ? boundaries[boundaries.length - keepTurns]!
      : 0
  if (retainedMessageBudget === undefined) return turnCut

  const budgetCut = cutForRetainedTokenBudget(messages, retainedMessageBudget)
  return adjustCutForToolPairs(messages, Math.max(turnCut, budgetCut))
}

function cutForRetainedTokenBudget(messages: Message[], retainedMessageBudget: number): number {
  let remaining = Math.max(0, Math.floor(retainedMessageBudget))
  let cut = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    const cost = Math.max(1, roughTokenCountEstimationForMessage(message))
    if (cost > remaining) break
    remaining -= cost
    cut = i
  }

  return cut
}

function adjustCutForToolPairs(messages: Message[], initialCut: number): number {
  let cut = initialCut
  let changed = true
  while (changed && cut > 0) {
    changed = false
    const tailToolResults = toolResultIds(messages.slice(cut))
    if (tailToolResults.size === 0) break

    for (let i = cut - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message || message.role !== 'assistant') continue
      if (assistantUsesAnyTool(message, tailToolResults)) {
        cut = i
        changed = true
        break
      }
    }
  }
  return cut
}

function toolResultIds(messages: Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') ids.add(message.toolUseId)
  }
  return ids
}

function assistantUsesAnyTool(message: Message, ids: ReadonlySet<string>): boolean {
  if (message.role !== 'assistant') return false
  return message.content.some(block => block.type === 'tool_use' && ids.has(block.id))
}

async function compactWithShrinkRetry(
  older: Message[],
  opts: CompactOpts,
) {
  let attemptMessages = older
  let lastContextError: unknown
  const maxRetries = Math.max(0, opts.maxShrinkRetries ?? 2)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await opts.provider.compact!(
        compactRequest(opts, attemptMessages),
        new AbortController().signal,
      )
    } catch (error) {
      if (!isContextWindowError(error)) throw error
      lastContextError = error
      const shrunk = shrinkMessagesForRetry(attemptMessages)
      if (shrunk.length >= attemptMessages.length) throw error
      attemptMessages = shrunk
    }
  }

  throw lastContextError
}

function compactRequest(opts: CompactOpts, messages: Message[]) {
  return {
    model: opts.model,
    system: COMPACT_SYSTEM,
    messages,
    tools: [],
    maxTokens: 800,
  }
}

async function summarizeWithShrinkRetry(
  older: Message[],
  opts: CompactOpts,
): Promise<string> {
  let attemptMessages = older
  let lastContextError: unknown
  const maxRetries = Math.max(0, opts.maxShrinkRetries ?? 2)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await summarizeOnce(attemptMessages, opts)
    } catch (error) {
      if (!isContextWindowError(error)) throw error
      lastContextError = error
      const shrunk = shrinkMessagesForRetry(attemptMessages)
      if (shrunk.length >= attemptMessages.length) throw error
      attemptMessages = shrunk
    }
  }

  throw lastContextError
}

async function summarizeOnce(messages: Message[], opts: CompactOpts): Promise<string> {
  let summaryText = ''
  const stream = opts.provider.stream(
    compactRequest(opts, messages),
    new AbortController().signal,
  )
  for await (const ev of stream) {
    if (ev.type === 'text_delta') summaryText += ev.text
  }
  return summaryText
}

function formatCompactSummaryText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length === 0 ? '' : `${trimmed}\n`
}

function shrinkMessagesForRetry(messages: Message[]): Message[] {
  if (messages.length <= 1) return messages
  return messages.slice(Math.floor(messages.length / 2))
}

function applyPostCompactCleanup(messages: Message[], opts: CompactOpts): Message[] {
  if (!opts.postCompactMicroCompact) return messages
  return microcompactToolResults(messages, opts.postCompactMicroCompact).messages
}
