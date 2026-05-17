// src/core/fileSearch/recentFilesHook.ts
//
// Auto-touch handler that wires the session-scoped `RecentFiles` MRU tracker
// into the in-process `HookRegistry`. Registering this as a `beforeToolCall`
// handler causes every Read / Edit / Write tool call to bump its target path
// in the tracker — no per-Tool modification required.
//
// Design:
//   - The handler is filtered by tool name (a small allow-list of file ops)
//     so it stays cheap and never touches non-fs tools.
//   - Path extraction is defensive: `wrapTool.ts` packs the tool's typed
//     `input` into `payload.input`, but the registry shape is opaque
//     (`Readonly<Record<string, unknown>>`). We narrow each field check
//     individually rather than asserting any shape, so the handler is
//     never load-bearing on the runtime types staying in lock-step.
//   - The handler returns `{}` (no skip, no additionalContext) — its only
//     side-effect is the `tracker.touch(path)` call. Failures from `touch`
//     would be unusual (it's a Map.set) but if one ever fires it would
//     bubble into the pipeline's per-handler try/catch and become an
//     `outcome: 'error'` entry without crashing the tool run.

import type { HookHandler } from '../hooks/events'
import type { RecentFiles } from './recentFiles'

/**
 * Tool names that operate on a single file path which should be tracked.
 * Mirrors the file-write/read tools registered in cli.tsx. MultiEdit does
 * not exist in Nuka; if/when it lands, add its `name` here.
 */
export const RECENT_FILES_TRACKED_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Edit',
  'Write',
])

/**
 * Extract a string path from an opaque tool-input payload. Returns `null`
 * if none of the known path field names are present as a string. The
 * field-name list mirrors the parameter schemas of the registered file
 * tools (Read/Edit/Write all use `path` today) plus the field names
 * upstream Nuka-Code uses (`file_path`, `filename`) so the handler keeps
 * working if a future port renames the schema field.
 */
function extractPath(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.path === 'string' && obj.path.length > 0) return obj.path
  if (typeof obj.file_path === 'string' && obj.file_path.length > 0) {
    return obj.file_path
  }
  if (typeof obj.filename === 'string' && obj.filename.length > 0) {
    return obj.filename
  }
  return null
}

/**
 * Build a `beforeToolCall` handler that bumps `tracker` on every Read /
 * Edit / Write call. The returned handler closes over `tracker`, so the
 * caller is responsible for keeping the tracker singleton alive (today
 * cli.tsx holds it for the lifetime of the process).
 */
export function createRecentFilesTouchHandler(
  tracker: RecentFiles,
): HookHandler {
  return (ctx) => {
    const toolName = ctx.toolName
    if (toolName === undefined) return {}
    if (!RECENT_FILES_TRACKED_TOOLS.has(toolName)) return {}
    // `wrapTool.ts` packs the typed Tool input as `payload.input`. Reach
    // through cautiously — the payload is `Readonly<Record<string, unknown>>`.
    const payload = ctx.payload
    if (payload === undefined) return {}
    const input = payload.input
    const path = extractPath(input)
    if (path !== null) tracker.touch(path)
    return {}
  }
}
