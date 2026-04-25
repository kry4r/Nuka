// src/core/stats/aggregate.ts
// Phase 8 §4.2 — stats aggregator.
//
// Reads from:
//   • `~/.nuka/cost.json` (CostEntry[]) for tokens + USD
//   • `~/.nuka/sessions/*.meta.json` for session count, active days, streakDays, peakHour
//
// Returns a summary object used by the /stats view.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { readCostFile, defaultCostPath } from '../cost/persist'
import type { CostEntry } from '../cost/tracker'
import { findPricing } from '../cost/pricing'

export type StatsRange = 'all' | '30d' | '7d'

export type ModelStats = {
  tokens: number
  usd: number
}

export type StatsResult = {
  sessions: number
  tokens: number
  costUsd: number
  byModel: Map<string, ModelStats>
  activeDays: number
  streakDays: number
  peakHour: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rangeStart(range: StatsRange, now: number): number {
  if (range === 'all') return 0
  if (range === '7d') return now - 7 * 24 * 3600 * 1000
  if (range === '30d') return now - 30 * 24 * 3600 * 1000
  return 0
}

function toUsd(model: string, tokens: number): number {
  // Approximate: treat all tokens as output tokens for simplicity when there
  // is no per-entry split available. Callers that have per-entry splits should
  // call this with the actual input/output token sums.
  const p = findPricing(model)
  if (!p) return 0
  return (tokens / 1_000_000) * p.output
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeStreakDays(activeDayKeys: Set<string>, now: number): number {
  if (activeDayKeys.size === 0) return 0
  let streak = 0
  const d = new Date(now)
  for (let i = 0; i < 365; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!activeDayKeys.has(key)) break
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

function peakHourFrom(entries: CostEntry[]): number | null {
  if (entries.length === 0) return null
  const counts = new Array<number>(24).fill(0)
  for (const e of entries) {
    const h = new Date(e.ts).getHours()
    counts[h]!++
  }
  let peak = 0
  let peakH = 0
  for (let h = 0; h < 24; h++) {
    if (counts[h]! > peak) { peak = counts[h]!; peakH = h }
  }
  return peak > 0 ? peakH : null
}

// ---------------------------------------------------------------------------
// Session meta reader (best-effort)
// ---------------------------------------------------------------------------

async function readSessionMetas(sessionsDir: string, start: number): Promise<number> {
  let count = 0
  try {
    const entries = await fs.readdir(sessionsDir)
    for (const e of entries) {
      if (!e.endsWith('.meta.json')) continue
      try {
        const raw = await fs.readFile(path.join(sessionsDir, e), 'utf8')
        const meta = JSON.parse(raw) as { updatedAt?: number; createdAt?: number }
        const ts = meta.updatedAt ?? meta.createdAt ?? 0
        if (ts >= start) count++
      } catch { /* skip */ }
    }
  } catch { /* sessionsDir not found */ }
  return count
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

export type AggregateOptions = {
  range?: StatsRange
  /** Override $HOME for testing. */
  home?: string
  /** Override current timestamp for testing. */
  now?: number
}

export async function aggregate(opts: AggregateOptions = {}): Promise<StatsResult> {
  const home = opts.home ?? os.homedir()
  const now = opts.now ?? Date.now()
  const range = opts.range ?? 'all'
  const start = rangeStart(range, now)

  const costPath = defaultCostPath(home)
  const sessionsDir = path.join(home, '.nuka', 'sessions')

  const allEntries = await readCostFile(costPath)
  const entries = allEntries.filter(e => e.ts >= start)

  // Aggregate by model
  const byModel = new Map<string, ModelStats>()
  let totalTokens = 0
  let totalUsd = 0
  const activeDaySet = new Set<string>()

  for (const e of entries) {
    const tok = (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
    const p = findPricing(e.model)
    let usd = 0
    if (p) {
      usd += ((e.inputTokens ?? 0) / 1_000_000) * p.input
      usd += ((e.outputTokens ?? 0) / 1_000_000) * p.output
      if (p.cacheRead) usd += ((e.cacheReadTokens ?? 0) / 1_000_000) * p.cacheRead
      if (p.cacheCreate) usd += ((e.cacheCreateTokens ?? 0) / 1_000_000) * p.cacheCreate
    }
    const existing = byModel.get(e.model)
    if (existing) {
      existing.tokens += tok
      existing.usd += usd
    } else {
      byModel.set(e.model, { tokens: tok, usd })
    }
    totalTokens += tok
    totalUsd += usd
    activeDaySet.add(localDayKey(e.ts))
  }

  const sessions = await readSessionMetas(sessionsDir, start)
  const streakDays = computeStreakDays(activeDaySet, now)
  const peakHour = peakHourFrom(entries)

  return {
    sessions,
    tokens: totalTokens,
    costUsd: totalUsd,
    byModel,
    activeDays: activeDaySet.size,
    streakDays,
    peakHour,
  }
}
