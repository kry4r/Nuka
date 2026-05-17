// src/core/hooks/hookListTool.ts
//
// HookListTool — agent-facing introspection over the in-process
// HookRegistry. Surfaces read-only listing / counting so the model
// can troubleshoot hook-related behaviour (e.g. "which beforeToolCall
// handlers are installed?") without touching internal APIs. Also
// supports a deliberately-narrow `clearByEvent` action for debugging.
//
// Security posture (intentional omissions):
//   - DOES NOT expose `register`. Letting the agent install arbitrary
//     handlers would let it intercept every future tool call and
//     potentially veto / observe sensitive payloads. The registry
//     constructor and the `register` method stay host-only.
//   - DOES NOT expose `clear()` without an event argument. A blanket
//     wipe would silently disable infrastructure handlers like
//     `recentFiles-auto-touch` and any user-defined `hooks.config.{js,mjs}`
//     contributions. `clearByEvent` requires a specific event so the
//     blast radius is at least scoped to one lifecycle slot.
//   - DOES NOT include the handler function references in output.
//     They aren't JSON-serialisable and could leak source code via
//     `Function.prototype.toString`. Only `id` / `event` / `priority`
//     leave the tool.
//
// Construction follows the cron / recentFiles tool precedent:
// `makeHookListTool(registry)` takes the host-owned HookRegistry
// singleton and closes over it. cli.tsx owns the registry lifetime;
// this module owns the Tool surface only.
//
// Side-effects: `list` and `count` are read-only; `clearByEvent`
// mutates the registry but performs no IO. `annotations.readOnly`
// is false (coarse-grained — applies to the whole tool, including
// the clear action).

import {
  type InProcessHookEvent,
  IN_PROCESS_HOOK_EVENTS,
  isInProcessHookEvent,
} from './events'
import type { HookRegistry } from './registry'
import type { Tool, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'

export const HOOK_LIST_TOOL_NAME = 'HookList'

/** Discrete actions the tool can perform. */
export type HookListAction = 'list' | 'count' | 'clearByEvent'

/**
 * Input schema (discriminated by `action`).
 *
 * - `list` / `count`: `event` is optional. When omitted, returns all
 *   events. When set to `'all'`, behaves like omitted for `list` and
 *   triggers the per-event breakdown for `count`. Otherwise filters
 *   to one event.
 * - `clearByEvent`: `event` is REQUIRED and MUST NOT be `'all'` —
 *   refusing the blanket-wipe avoids accidental nukes of registered
 *   infrastructure (recentFiles-auto-touch, plugin contributors, etc.).
 */
export type HookListInput = {
  action: HookListAction
  event?: InProcessHookEvent | 'all'
}

/** One row in a `list` response. Note: handler function is INTENTIONALLY
 *  not included — see file header for rationale. */
export type HookListItem = {
  id: string
  event: InProcessHookEvent
  priority: number
}

/** Structured payloads, tagged by `action` for consumers. */
export type HookListListResult = {
  action: 'list'
  hooks: HookListItem[]
  total: number
}
export type HookListCountResult = {
  action: 'count'
  count: number
  byEvent?: Record<string, number>
}
export type HookListClearResult = {
  action: 'clearByEvent'
  ok: true
  cleared: number
  event: InProcessHookEvent
}
export type HookListResult =
  | HookListListResult
  | HookListCountResult
  | HookListClearResult

const VALID_ACTIONS: ReadonlySet<HookListAction> = new Set([
  'list',
  'count',
  'clearByEvent',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `HookList: ${msg}` }
}

/**
 * Validate `input`, returning a human-readable error string or null on
 * success. Cross-field rules (clearByEvent must have a concrete event)
 * are enforced here rather than in JSON Schema, mirroring the
 * durationTool / recentFilesTool precedent.
 */
function validateInput(input: HookListInput): string | null {
  if (input == null || typeof input !== 'object') {
    return `input must be an object (got ${String(input)}).`
  }
  if (typeof input.action !== 'string') {
    return `'action' must be a string (got ${typeof input.action}).`
  }
  if (!VALID_ACTIONS.has(input.action as HookListAction)) {
    return `'action' must be one of list|count|clearByEvent (got '${input.action}').`
  }
  if (input.event !== undefined) {
    if (typeof input.event !== 'string') {
      return `'event' must be a string (got ${typeof input.event}).`
    }
    if (input.event !== 'all' && !isInProcessHookEvent(input.event)) {
      return `'event' must be 'all' or a valid in-process hook event (got '${input.event}').`
    }
  }
  if (input.action === 'clearByEvent') {
    if (input.event === undefined) {
      return (
        `action='clearByEvent' requires a non-'all' 'event' field — ` +
        `refusing to clear-all from the tool surface to avoid accidental nukes.`
      )
    }
    if (input.event === 'all') {
      return (
        `action='clearByEvent' refuses event='all' — clear one event at a time. ` +
        `Use the host wiring (HookRegistry.clear()) directly for a full reset.`
      )
    }
  }
  return null
}

/**
 * Build a Tool over `registry`. The registry is closed over by the
 * returned `run` so every call sees the same in-memory hook state.
 * cli.tsx is expected to construct the registry once at startup and
 * pass it here.
 */
export function makeHookListTool(
  registry: HookRegistry,
): Tool<HookListInput> {
  return defineTool<HookListInput>({
    name: HOOK_LIST_TOOL_NAME,
    description:
      "Inspect (and selectively reset) the in-process HookRegistry — the bus that fires " +
      "lifecycle events like beforeToolCall / afterTurn / sessionStart. " +
      "action='list' returns registered hooks with {id, event, priority}; pass `event` " +
      "to filter, or omit / pass 'all' to list across every event. " +
      "action='count' returns the total handler count; pass event='all' for a per-event breakdown. " +
      "action='clearByEvent' removes every handler registered for a specific `event` (REQUIRED, NOT 'all'). " +
      "This tool is read-only except for clearByEvent; it never exposes handler function references " +
      "or `register` (host-only) for security reasons.",
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'count', 'clearByEvent'],
          description:
            "One of 'list' | 'count' | 'clearByEvent'. " +
            "'clearByEvent' requires `event` (and refuses 'all').",
        },
        event: {
          type: 'string',
          enum: ['all', ...IN_PROCESS_HOOK_EVENTS],
          description:
            "Optional for 'list' / 'count' (omit or pass 'all' for cross-event view). " +
            "REQUIRED for 'clearByEvent' and must be a concrete event name (not 'all').",
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'hooks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, parallelSafe: false },
    searchHint: ['hook', 'hooks', 'registry', 'lifecycle', 'event'],
    aliases: ['hook_list', 'hookList', 'hooks'],
    async run(input: HookListInput): Promise<ToolResult> {
      const validation = validateInput(input)
      if (validation !== null) {
        return errorResult(validation)
      }

      const filterEvent =
        input.event !== undefined && input.event !== 'all'
          ? (input.event as InProcessHookEvent)
          : undefined

      switch (input.action) {
        case 'list': {
          const records = registry.list(filterEvent)
          const items: HookListItem[] = records.map(r => ({
            id: r.id,
            event: r.event,
            priority: r.priority,
          }))
          const payload: HookListListResult = {
            action: 'list',
            hooks: items,
            total: items.length,
          }
          return { isError: false, output: formatListResult(payload) }
        }
        case 'count': {
          if (input.event === 'all') {
            const byEvent: Record<string, number> = {}
            let total = 0
            for (const ev of IN_PROCESS_HOOK_EVENTS) {
              const n = registry.list(ev).length
              if (n > 0) byEvent[ev] = n
              total += n
            }
            const payload: HookListCountResult = {
              action: 'count',
              count: total,
              byEvent,
            }
            return { isError: false, output: formatCountResult(payload) }
          }
          const count = registry.list(filterEvent).length
          const payload: HookListCountResult = {
            action: 'count',
            count,
          }
          return { isError: false, output: formatCountResult(payload) }
        }
        case 'clearByEvent': {
          // validateInput already guaranteed event is set and not 'all'.
          const ev = input.event as InProcessHookEvent
          const before = registry.list(ev).length
          registry.clear(ev)
          const payload: HookListClearResult = {
            action: 'clearByEvent',
            ok: true,
            cleared: before,
            event: ev,
          }
          return { isError: false, output: formatClearResult(payload) }
        }
        default: {
          // Exhaustive: TypeScript-level guarantee plus a runtime
          // fallback in case validateInput is bypassed somehow.
          const exhaustive: never = input.action
          return errorResult(`unhandled action '${String(exhaustive)}'.`)
        }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatListResult(r: HookListListResult): string {
  const header =
    r.total === 0
      ? 'HookList: no hooks registered.'
      : `HookList: ${r.total} hook${r.total === 1 ? '' : 's'} registered:`
  const rows = r.hooks.map(
    h => `  ${h.id}  (event=${h.event}, priority=${h.priority})`,
  )
  return [header, ...rows, '', JSON.stringify(r)].join('\n')
}

function formatCountResult(r: HookListCountResult): string {
  const lines: string[] = [
    `HookList: ${r.count} hook${r.count === 1 ? '' : 's'} registered.`,
  ]
  if (r.byEvent !== undefined) {
    const entries = Object.entries(r.byEvent).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )
    if (entries.length > 0) {
      lines.push('Per event:')
      for (const [ev, n] of entries) lines.push(`  ${ev}: ${n}`)
    }
  }
  return [...lines, '', JSON.stringify(r)].join('\n')
}

function formatClearResult(r: HookListClearResult): string {
  return [
    `HookList: cleared ${r.cleared} hook${r.cleared === 1 ? '' : 's'} ` +
      `for event '${r.event}'.`,
    '',
    JSON.stringify(r),
  ].join('\n')
}
