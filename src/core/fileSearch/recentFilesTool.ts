// src/core/fileSearch/recentFilesTool.ts
//
// RecentFilesTool — agent-facing wrapper around the in-memory MRU
// tracker in `recentFiles.ts`. Lets the model inspect and manage the
// session's recent-file history via tool-use:
//
//   action='list'   — read freshest-first MRU snapshot
//   action='touch'  — record (or refresh) an access for a path
//   action='forget' — drop a single path from history
//   action='clear'  — wipe history entirely
//
// The tracker is shared across calls within a session, so successive
// `touch` calls accumulate — same shape as `palette / typeahead`
// already use. Construction follows the cron / task tool precedent:
// `makeRecentFilesTool(tracker)` takes the session-scoped instance
// and returns a Tool. cli.tsx owns the tracker lifetime; this module
// owns the Tool surface only.
//
// What this Tool intentionally does NOT do:
//   - Walk the filesystem (use FileSearch / Glob for that)
//   - Persist to disk on every call (cli.tsx wires persistence
//     separately via `createPersistentRecentFiles` when desired)
//   - Hook into Read/Edit/Bash to auto-touch — that's a separate
//     deferred follow-up so the agent can drive history explicitly
//     during this iter.
//
// Output shape: every action returns the documented structured payload
// as a trailing JSON line in `output`, preceded by a one-line human
// summary. Mirrors FileSearchTool's convention so consumers that want
// the typed object can `JSON.parse` the last line.
//
// Side-effects: none beyond in-memory mutation of the supplied
// tracker. `readOnly` is true for `list`, false for the mutating
// actions; we report a single coarse-grained annotation
// (`readOnly: false`) so the registry treats the whole tool as
// non-readonly. The model still sees `needsPermission: 'none'`
// because no fs/network/exec is involved.

import type {
  RecentFileEntry,
  RecentFiles,
} from './recentFiles.js'
import type { Tool, ToolResult } from '../tools/types.js'
import { defineTool } from '../tools/define.js'

export const RECENT_FILES_TOOL_NAME = 'RecentFiles'

/** Cap on `list` results so a long-running session doesn't dump
 *  hundreds of entries into the transcript by accident. */
export const RECENT_FILES_DEFAULT_LIMIT = 20
export const RECENT_FILES_HARD_LIMIT = 200

/** The four discrete actions the tool can perform. */
export type RecentFilesAction = 'list' | 'touch' | 'forget' | 'clear'

export type RecentFilesInput = {
  action: RecentFilesAction
  path?: string
  timestamp?: number
  maxResults?: number
}

/** One row in a `list` response. Mirrors `RecentFileEntry` plus the
 *  computed recency boost in [0, 1] from the tracker. */
export type RecentFilesListItem = {
  path: string
  lastTouched: number
  hitCount: number
  boost: number
}

/** Structured payload, discriminated by the input `action`. */
export type RecentFilesListResult = {
  action: 'list'
  items: RecentFilesListItem[]
  total: number
}
export type RecentFilesTouchResult = {
  action: 'touch'
  ok: true
  path: string
  lastTouched: number
  hitCount: number
}
export type RecentFilesForgetResult = {
  action: 'forget'
  ok: true
  removed: boolean
  path: string
}
export type RecentFilesClearResult = {
  action: 'clear'
  ok: true
  removedCount: number
}
export type RecentFilesResult =
  | RecentFilesListResult
  | RecentFilesTouchResult
  | RecentFilesForgetResult
  | RecentFilesClearResult

const VALID_ACTIONS: ReadonlySet<RecentFilesAction> = new Set([
  'list',
  'touch',
  'forget',
  'clear',
])

/**
 * Build a Tool over `tracker`. The tracker is closed over by the
 * returned `run` so every call sees the same in-memory MRU state.
 * cli.tsx is expected to construct the tracker once at startup and
 * pass it here.
 */
export function makeRecentFilesTool(
  tracker: RecentFiles,
): Tool<RecentFilesInput> {
  return defineTool<RecentFilesInput>({
    name: RECENT_FILES_TOOL_NAME,
    description:
      "Inspect or manage the session's recent-file MRU history. " +
      "action='list' returns the freshest-first list of touched paths " +
      "(default 20, hard cap 200). action='touch' records (or refreshes) " +
      "a path access — pass an explicit `timestamp` (epoch ms) to override the clock. " +
      "action='forget' removes one path; action='clear' wipes all history. " +
      'Touches accumulate across calls within the session — useful for boosting ' +
      'FileSearch / palette ranking. No filesystem IO; pure in-memory state.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'touch', 'forget', 'clear'],
          description:
            "One of 'list' | 'touch' | 'forget' | 'clear'. " +
            "'touch' and 'forget' require `path`.",
        },
        path: {
          type: 'string',
          description:
            "File path to touch/forget. Required for action='touch' and action='forget'. " +
            'Pass forward-slash paths (relative or absolute — caller decides; the ' +
            'tracker treats them as opaque strings).',
          minLength: 1,
        },
        timestamp: {
          type: 'number',
          description:
            "Optional epoch-ms timestamp for action='touch'. Defaults to the " +
            'tracker clock (Date.now). Useful for replaying or seeding history.',
        },
        maxResults: {
          type: 'number',
          description: `Max items to return for action='list' (default ${RECENT_FILES_DEFAULT_LIMIT}, hard cap ${RECENT_FILES_HARD_LIMIT}).`,
          minimum: 1,
          maximum: RECENT_FILES_HARD_LIMIT,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'fs.read', 'file-search'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, parallelSafe: false },
    searchHint: ['recent', 'mru', 'history', 'file', 'recently'],
    aliases: ['recent_files', 'recentFiles'],
    async run(input: RecentFilesInput): Promise<ToolResult> {
      const validation = validateInput(input)
      if (validation !== null) {
        return { isError: true, output: `RecentFiles: ${validation}` }
      }

      switch (input.action) {
        case 'list': {
          const limit = clampLimit(input.maxResults)
          const snapshot = tracker.entriesSnapshot() // freshest first
          const total = snapshot.length
          const items: RecentFilesListItem[] = snapshot
            .slice(0, limit)
            .map((e: RecentFileEntry) => ({
              path: e.path,
              lastTouched: e.timestamp,
              hitCount: e.hits,
              boost: tracker.boost(e.path),
            }))
          const payload: RecentFilesListResult = {
            action: 'list',
            items,
            total,
          }
          return { isError: false, output: formatListResult(payload) }
        }
        case 'touch': {
          // `path` non-empty was already enforced by validateInput.
          const path = input.path as string
          tracker.touch(path, input.timestamp)
          const snap = tracker.entriesSnapshot()
          const entry = snap.find(e => e.path === path)
          if (entry === undefined) {
            // Defensive: tracker can drop empty-path touches silently,
            // but validateInput rejects empty paths so this is truly
            // unreachable. Keep a coherent error rather than asserting.
            return {
              isError: true,
              output: `RecentFiles: touch did not record path '${path}' (unexpected).`,
            }
          }
          const payload: RecentFilesTouchResult = {
            action: 'touch',
            ok: true,
            path: entry.path,
            lastTouched: entry.timestamp,
            hitCount: entry.hits,
          }
          return { isError: false, output: formatTouchResult(payload) }
        }
        case 'forget': {
          const path = input.path as string
          const sizeBefore = tracker.size
          tracker.forget(path)
          const removed = tracker.size < sizeBefore
          const payload: RecentFilesForgetResult = {
            action: 'forget',
            ok: true,
            removed,
            path,
          }
          return { isError: false, output: formatForgetResult(payload) }
        }
        case 'clear': {
          const removedCount = tracker.size
          tracker.clear()
          const payload: RecentFilesClearResult = {
            action: 'clear',
            ok: true,
            removedCount,
          }
          return { isError: false, output: formatClearResult(payload) }
        }
        default: {
          // Exhaustive: TypeScript-level guarantee plus a runtime
          // fallback in case validateInput is bypassed somehow.
          const exhaustive: never = input.action
          return {
            isError: true,
            output: `RecentFiles: unhandled action '${String(exhaustive)}'.`,
          }
        }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateInput(input: RecentFilesInput): string | null {
  if (typeof input.action !== 'string') {
    return `'action' must be a string (got ${typeof input.action}).`
  }
  if (!VALID_ACTIONS.has(input.action as RecentFilesAction)) {
    return `'action' must be one of list|touch|forget|clear (got '${input.action}').`
  }
  if (input.action === 'touch' || input.action === 'forget') {
    if (typeof input.path !== 'string' || input.path.length === 0) {
      return `action='${input.action}' requires a non-empty 'path' string.`
    }
  }
  if (input.action === 'touch' && input.timestamp !== undefined) {
    if (
      typeof input.timestamp !== 'number' ||
      !Number.isFinite(input.timestamp)
    ) {
      return `'timestamp' must be a finite number (got ${String(input.timestamp)}).`
    }
  }
  if (input.action === 'list' && input.maxResults !== undefined) {
    if (
      typeof input.maxResults !== 'number' ||
      !Number.isFinite(input.maxResults) ||
      input.maxResults < 1
    ) {
      return `'maxResults' must be a positive number (got ${String(input.maxResults)}).`
    }
  }
  return null
}

function clampLimit(raw: number | undefined): number {
  const n = raw ?? RECENT_FILES_DEFAULT_LIMIT
  return Math.max(1, Math.min(RECENT_FILES_HARD_LIMIT, Math.floor(n)))
}

function formatListResult(r: RecentFilesListResult): string {
  const header =
    r.total === 0
      ? 'RecentFiles: no paths tracked yet.'
      : `RecentFiles: ${r.items.length} of ${r.total} entries (freshest first):`
  const rows = r.items.map(
    item =>
      `  ${item.path}  (hits=${item.hitCount}, boost=${item.boost.toFixed(3)}, ts=${item.lastTouched})`,
  )
  return [header, ...rows, '', JSON.stringify(r)].join('\n')
}

function formatTouchResult(r: RecentFilesTouchResult): string {
  return [
    `RecentFiles: touched '${r.path}' (hits=${r.hitCount}, ts=${r.lastTouched}).`,
    '',
    JSON.stringify(r),
  ].join('\n')
}

function formatForgetResult(r: RecentFilesForgetResult): string {
  const summary = r.removed
    ? `RecentFiles: forgot '${r.path}'.`
    : `RecentFiles: '${r.path}' was not tracked (no-op).`
  return [summary, '', JSON.stringify(r)].join('\n')
}

function formatClearResult(r: RecentFilesClearResult): string {
  return [
    `RecentFiles: cleared ${r.removedCount} entr${r.removedCount === 1 ? 'y' : 'ies'}.`,
    '',
    JSON.stringify(r),
  ].join('\n')
}
