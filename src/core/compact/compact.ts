// src/core/compact/compact.ts
import type { Session } from '../session/types'
import type { LLMProvider } from '../provider/types'
import type { AssistantMessage, Message, ResponsesCompactionMessage } from '../message/types'
import { microcompactToolResults, type MicrocompactToolResultsOptions } from './microCompact'
import { isContextWindowError } from './contextWindowError'
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
  const boundaries = turnBoundaries(session.messages)
  if (boundaries.length <= keepTurns) return

  const cutBoundaryIndex = boundaries[boundaries.length - keepTurns]!
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
        text: `${COMPACT_SUMMARY_MARKER}\n${summaryText.trim()}`,
      },
    ],
  }

  session.messages = applyPostCompactCleanup([summary, ...kept], opts)
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

function shrinkMessagesForRetry(messages: Message[]): Message[] {
  if (messages.length <= 1) return messages
  return messages.slice(Math.floor(messages.length / 2))
}

function applyPostCompactCleanup(messages: Message[], opts: CompactOpts): Message[] {
  if (!opts.postCompactMicroCompact) return messages
  return microcompactToolResults(messages, opts.postCompactMicroCompact).messages
}
