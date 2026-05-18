// src/core/cost/costHook.ts
//
// Cost "hook" surface. Mirrors the role of Nuka-Code's `costHook.ts` —
// it knows how to (a) format current cost for a HUD line and (b) flush
// session totals into a long-lived history file when the process exits.
//
// We deliberately do *not* expose a React hook here: Nuka's CostTracker is
// a per-process singleton injected via `props.costTracker`, so the TUI
// banner reads it directly. The React side lives in
// `src/tui/Status/CostBanner.tsx`; this module provides the pure helpers
// it (and the CLI) call.
//
// `flushHistoryNow` is idempotent in shape: empty tracker -> no-op write
// avoidance, non-empty -> read+fold+write the history file.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { CostTracker } from './tracker'
import {
  defaultCostHistoryPath,
  readCostHistory,
  writeCostHistory,
  foldEntriesIntoHistory,
  type CostHistory,
} from './costHistory'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/**
 * Render a one-line summary for the *current* session. Used by both the
 * exit-summary printer and the TUI banner. Empty string when the session
 * has no recorded turns yet.
 */
export function formatSessionCost(
  tracker: CostTracker,
  sessionId: string,
  model: string,
): string {
  const cur = tracker.current(sessionId)
  if (cur.turns === 0) return ''
  const usd = tracker.toUsd(model, cur)
  const tokens = `in ${fmtTokens(cur.inputTokens)} · out ${fmtTokens(cur.outputTokens)}`
  const cache = cur.cacheReadTokens > 0 || cur.cacheCreateTokens > 0
    ? ` · cache ${fmtTokens(cur.cacheReadTokens)}/${fmtTokens(cur.cacheCreateTokens)}`
    : ''
  if (usd === undefined) return `${tokens}${cache}`
  return `${tokens}${cache} · $${usd.toFixed(4)}`
}

/**
 * TUI banner-friendly version: prefixed with `cost ` for grepability in
 * logs and screenshots.
 */
export function formatBannerLine(
  tracker: CostTracker,
  sessionId: string,
  model: string,
): string {
  const body = formatSessionCost(tracker, sessionId, model)
  return body ? `cost ${body}` : ''
}

/**
 * Fold all tracker entries into the cost-history file. Safe to call
 * repeatedly — duplicates would double-count, so callers should fold at
 * shutdown only (or after explicit boundary events).
 */
export async function flushHistoryNow(
  tracker: CostTracker,
  filePath: string = defaultCostHistoryPath(),
): Promise<void> {
  const entries = tracker.snapshot()
  if (entries.length === 0) return
  const cur = await readCostHistory(filePath)
  const next = foldEntriesIntoHistory(cur, entries)
  await writeCostHistory(filePath, next)
}

/**
 * Synchronous read of the cost-history file used inside the exit handler
 * (where Promises don't resolve). Mirrors `readCostHistory` semantics:
 * missing/malformed/unknown-version => empty history.
 */
function readCostHistorySync(filePath: string): CostHistory {
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return { version: 1, days: {} }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { version?: unknown }).version === 1
    ) {
      return parsed as CostHistory
    }
  } catch {
    /* fall through to empty */
  }
  return { version: 1, days: {} }
}

/**
 * Install a synchronous exit listener that folds the tracker into the
 * history file on `process.on('exit')`. We pre-bind `filePath` so the
 * listener has no async I/O dependency — at exit time we have a single
 * synchronous tick to run before the event loop dies.
 *
 * Implementation note: `process.on('exit')` cannot await Promises, so we
 * use `writeFileSync` directly via a synchronous read-modify-write. This
 * is a narrow exception to "async fs everywhere"; the function is only
 * ever invoked once per process at shutdown.
 *
 * Returns an `uninstall` function for tests.
 */
export function installCostExitHook(
  tracker: CostTracker,
  filePath: string = defaultCostHistoryPath(),
): () => void {
  const handler = (): void => {
    const entries = tracker.snapshot()
    if (entries.length === 0) return
    try {
      const cur = readCostHistorySync(filePath)
      const next = foldEntriesIntoHistory(cur, entries)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(next), 'utf8')
    } catch {
      // Best-effort — never throw out of an exit handler.
    }
  }
  process.on('exit', handler)
  return () => {
    process.off('exit', handler)
  }
}
