// src/core/cost/costHistory.ts
//
// Daily totals roll-up for the cost tracker.
//
// File layout: `~/.nuka/cost-history.json` (separate from the per-entry
// `cost.json`):
//   { "version": 1, "days": { "YYYY-MM-DD": DailyTotal, ... } }
//
// Why separate? The entry log (`cost.json`) is bounded by MAX_ENTRIES and
// can drop oldest rows; daily totals must persist indefinitely so the user
// can see "what did I spend last week / last month". Folding tracker
// entries into the history at exit time gives us crash-tolerant long-term
// stats without paying per-record write cost.
//
// Day keying is **local time** so the same wall-clock day on a user's
// machine maps to the same bucket as `CostTracker.today()`.
//
// Atomic writes: tmp+rename like recent-files.json and cost.json.
//
// Pricing fold: we resolve USD per entry at fold time using `findPricing`.
// Cost per *aggregated* row is stored per-model so price changes don't
// retroactively rewrite history (each entry was priced at fold time).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CostEntry } from './tracker'
import { findPricing } from './pricing'

const SCHEMA_VERSION = 1

/** Daily totals: pre-pricing tokens + per-model USD breakdown. */
export type DailyTotal = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  /** Number of recorded assistant turns folded into this day. */
  turns: number
  /** USD per model, computed at fold time. Unknown models => 0. */
  usdByModel: Record<string, number>
}

export type CostHistory = {
  version: 1
  days: Record<string, DailyTotal>
}

const EMPTY_HISTORY: CostHistory = { version: SCHEMA_VERSION, days: {} }

/** Default location: `~/.nuka/cost-history.json`. */
export function defaultCostHistoryPath(home: string = os.homedir()): string {
  return path.join(home, '.nuka', 'cost-history.json')
}

/** Format a timestamp as a `YYYY-MM-DD` key in local time. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyDay(): DailyTotal {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    turns: 0,
    usdByModel: {},
  }
}

function isDailyTotalShape(v: unknown): v is DailyTotal {
  if (!v || typeof v !== 'object') return false
  const o = v as Partial<DailyTotal>
  return (
    typeof o.inputTokens === 'number' &&
    typeof o.outputTokens === 'number' &&
    typeof o.cacheCreateTokens === 'number' &&
    typeof o.cacheReadTokens === 'number' &&
    typeof o.turns === 'number' &&
    !!o.usdByModel &&
    typeof o.usdByModel === 'object'
  )
}

/**
 * Read the history file. Returns an empty history if missing, malformed, or
 * a version we don't understand.
 */
export async function readCostHistory(filePath: string): Promise<CostHistory> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_HISTORY, days: {} }
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY_HISTORY, days: {} }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_HISTORY, days: {} }
  const obj = parsed as Partial<CostHistory>
  if (obj.version !== SCHEMA_VERSION) return { ...EMPTY_HISTORY, days: {} }
  if (!obj.days || typeof obj.days !== 'object') return { ...EMPTY_HISTORY, days: {} }
  const days: Record<string, DailyTotal> = {}
  for (const [key, val] of Object.entries(obj.days)) {
    if (!isDailyTotalShape(val)) continue
    // Clone usdByModel so callers can't mutate the source object via reference.
    days[key] = {
      inputTokens: val.inputTokens,
      outputTokens: val.outputTokens,
      cacheCreateTokens: val.cacheCreateTokens,
      cacheReadTokens: val.cacheReadTokens,
      turns: val.turns,
      usdByModel: { ...val.usdByModel },
    }
  }
  return { version: SCHEMA_VERSION, days }
}

/**
 * Atomically write the history to `filePath`. Creates the parent dir if it
 * doesn't exist. The tmp suffix carries pid+ts so concurrent writers don't
 * clobber each other's tmp file.
 */
export async function writeCostHistory(
  filePath: string,
  history: CostHistory,
): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(history), 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Fold a batch of tracker entries into an existing history. Returns a new
 * history (pure / immutable). Pricing is resolved per-entry via
 * {@link findPricing}; unknown models contribute `0` USD.
 */
export function foldEntriesIntoHistory(
  history: CostHistory,
  entries: readonly CostEntry[],
): CostHistory {
  if (entries.length === 0) return history
  // Deep-clone the days map so we never mutate the input.
  const days: Record<string, DailyTotal> = {}
  for (const [k, v] of Object.entries(history.days)) {
    days[k] = { ...v, usdByModel: { ...v.usdByModel } }
  }
  for (const e of entries) {
    const key = dayKey(e.ts)
    const cur = days[key] ?? emptyDay()
    cur.inputTokens += e.inputTokens
    cur.outputTokens += e.outputTokens
    cur.cacheCreateTokens += e.cacheCreateTokens
    cur.cacheReadTokens += e.cacheReadTokens
    cur.turns += 1
    const p = findPricing(e.model)
    let usd = 0
    if (p) {
      usd += (e.inputTokens  / 1_000_000) * p.input
      usd += (e.outputTokens / 1_000_000) * p.output
      if (p.cacheCreate) usd += (e.cacheCreateTokens / 1_000_000) * p.cacheCreate
      if (p.cacheRead)   usd += (e.cacheReadTokens   / 1_000_000) * p.cacheRead
    }
    cur.usdByModel[e.model] = (cur.usdByModel[e.model] ?? 0) + usd
    days[key] = cur
  }
  return { version: SCHEMA_VERSION, days }
}
