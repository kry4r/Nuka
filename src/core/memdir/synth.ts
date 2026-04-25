// src/core/memdir/synth.ts
//
// Phase 7 §5.3 — synthesize a MemoryEntry from a session's message
// transcript by asking the provider to extract durable facts.
//
// Design choices:
// - Caller supplies the provider + model so we never hard-code a route
//   here. Tests mock with a stub provider.
// - 5-second timeout per spec — synth runs after `runAgentLoop` returns,
//   we don't want to block exit on a slow provider.
// - Returns `null` on any failure (timeout, stream error, malformed
//   YAML). The caller treats null as "skip — don't grow MEMORY.md".

import type { LLMProvider } from '../provider/types'
import type { Message } from '../message/types'
import { parse as parseYaml } from 'yaml'
import type { MemoryEntry } from './parser'

const SYSTEM_PROMPT = `You distill durable facts from a coding-assistant session.
Extract preferences, project conventions, and gotchas the next session
should remember. Ignore one-off task details.

Return YAML frontmatter followed by a markdown body. Body must be a single
paragraph, no more than 200 characters. Format exactly:

---
keywords: [keyword1, keyword2, ...]
score: 0.0-1.0
---

<body, 1 paragraph, ≤200 chars>

If there is nothing durable to remember, output exactly: NONE`

const SYNTH_TIMEOUT_MS = 5000

export type SynthOpts = {
  /** How many trailing messages to feed in. Default 20 turns × 2 ≈ 40. */
  maxMessages?: number
  /** Override the default 5s timeout (used by tests). */
  timeoutMs?: number
}

/**
 * Pull last N messages, ask `provider` to summarize them, parse the YAML
 * frontmatter + body. Returns null on any failure.
 */
export async function synthMemoryEntry(
  turns: readonly Message[],
  provider: LLMProvider,
  model: string,
  sessionId: string,
  opts: SynthOpts = {},
): Promise<MemoryEntry | null> {
  if (turns.length === 0) return null
  const max = opts.maxMessages ?? 40
  const tail = turns.slice(Math.max(0, turns.length - max))

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? SYNTH_TIMEOUT_MS)

  let raw = ''
  try {
    const stream = provider.stream(
      {
        model,
        system: SYSTEM_PROMPT,
        messages: tail,
        tools: [],
        maxTokens: 400,
      },
      ac.signal,
    )
    for await (const ev of stream) {
      if (ev.type === 'text_delta') raw += ev.text
      if (ac.signal.aborted) break
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }

  const text = raw.trim()
  if (!text || text === 'NONE') return null

  // Parse: ---\n<yaml>\n---\n<body>
  if (!text.startsWith('---')) return null
  const afterFirst = text.slice(3).replace(/^\s*\n/, '')
  const closeIdx = afterFirst.indexOf('\n---')
  if (closeIdx < 0) return null
  const yamlText = afterFirst.slice(0, closeIdx)
  const body = afterFirst.slice(closeIdx + 4).replace(/^\s*\n/, '').trim()
  if (!body) return null

  let fm: unknown
  try {
    fm = parseYaml(yamlText)
  } catch {
    return null
  }
  if (!fm || typeof fm !== 'object') return null
  const obj = fm as Record<string, unknown>
  const keywords = Array.isArray(obj['keywords'])
    ? (obj['keywords'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const score = typeof obj['score'] === 'number' ? obj['score'] : undefined

  return {
    ts: new Date().toISOString(),
    sessionId,
    keywords,
    score,
    body: body.length > 400 ? body.slice(0, 400) : body,
  }
}
