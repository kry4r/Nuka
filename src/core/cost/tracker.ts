// src/core/cost/tracker.ts
//
// Phase 7 §5.2 — in-memory cost tracker.
//
// `record(model, sessionId, usage, ts?)` appends an entry. Aggregates are
// computed on demand from the entry list rather than maintained eagerly so
// the same data structure can drive `current(sessionId)`, `today()`,
// `allTime()`, and arbitrary windowed views in the HUD without bookkeeping
// drift.
//
// USD conversion lives in {@link toUsd}. Unknown models return `undefined`
// (the spec wants tokens-only fallback in that case — UI decides how to
// render the missing field).

import { findPricing } from './pricing'

export type Usage = {
  input: number
  output: number
  cacheCreate?: number
  cacheRead?: number
}

export type CostEntry = {
  model: string
  sessionId: string
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  ts: number
}

export type Aggregate = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  /** Number of recorded turns folded into this aggregate. */
  turns: number
}

const EMPTY: Aggregate = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
  turns: 0,
}

function add(into: Aggregate, e: CostEntry): void {
  into.inputTokens += e.inputTokens
  into.outputTokens += e.outputTokens
  into.cacheCreateTokens += e.cacheCreateTokens
  into.cacheReadTokens += e.cacheReadTokens
  into.turns += 1
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export class CostTracker {
  private entries: CostEntry[] = []

  /** Record one assistant turn's usage. `ts` defaults to `Date.now()`. */
  record(model: string, sessionId: string, usage: Usage, ts?: number): CostEntry {
    const entry: CostEntry = {
      model,
      sessionId,
      inputTokens: Math.max(0, usage.input | 0),
      outputTokens: Math.max(0, usage.output | 0),
      cacheCreateTokens: Math.max(0, (usage.cacheCreate ?? 0) | 0),
      cacheReadTokens: Math.max(0, (usage.cacheRead ?? 0) | 0),
      ts: ts ?? Date.now(),
    }
    this.entries.push(entry)
    return entry
  }

  /** Aggregate for one session id (matches what `/cost` calls "this session"). */
  current(sessionId: string): Aggregate {
    const out: Aggregate = { ...EMPTY }
    for (const e of this.entries) if (e.sessionId === sessionId) add(out, e)
    return out
  }

  /** Aggregate of all entries with `ts` in today's local-time window. */
  today(now: number = Date.now()): Aggregate {
    const start = startOfDay(now)
    const end = start + 24 * 3600 * 1000
    const out: Aggregate = { ...EMPTY }
    for (const e of this.entries) if (e.ts >= start && e.ts < end) add(out, e)
    return out
  }

  /** Aggregate of every recorded entry. */
  allTime(): Aggregate {
    const out: Aggregate = { ...EMPTY }
    for (const e of this.entries) add(out, e)
    return out
  }

  /**
   * Convert an aggregate to USD using the model's pricing row.
   * Returns `undefined` when the model isn't in the pricing table — callers
   * should fall back to "tokens only" rendering in that case.
   */
  toUsd(model: string, agg: Aggregate): number | undefined {
    const p = findPricing(model)
    if (!p) return undefined
    const input = (agg.inputTokens / 1_000_000) * p.input
    const output = (agg.outputTokens / 1_000_000) * p.output
    const cacheCreate = p.cacheCreate
      ? (agg.cacheCreateTokens / 1_000_000) * p.cacheCreate
      : 0
    const cacheRead = p.cacheRead
      ? (agg.cacheReadTokens / 1_000_000) * p.cacheRead
      : 0
    return input + output + cacheCreate + cacheRead
  }

  /** Read-only view of recorded entries (for persistence layer). */
  snapshot(): readonly CostEntry[] {
    return this.entries
  }

  /** Replace the in-memory entry list (used when restoring from disk). */
  hydrate(entries: readonly CostEntry[]): void {
    this.entries = entries.slice()
  }
}
