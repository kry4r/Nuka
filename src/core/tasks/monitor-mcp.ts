// src/core/tasks/monitor-mcp.ts
//
// Phase 10 §4.3 — `monitor_mcp` task runner.
//
// Subscribes to a long-running MCP tool's progress events. The spec's
// `eventStream` is injected so the runner doesn't need to know about
// `McpManager` internals (production wires the manager's progress API
// into `eventStream` at task-creation time).
//
// Resolution rules:
//   - Iteration ends naturally  → resolves `{}` (no error).
//   - Final event has `done: true`, no `error` → resolves `{}`.
//   - Final event has `done: true` AND `error` → resolves `{ error }`.
//   - Signal aborted mid-stream → resolves `{}` (manager already marked
//     the task `killed`; runner exits cleanly).

import { appendOutputSync } from './persist'
import type { MonitorMcpSpec } from './types'

export type RunMonitorOpts = {
  spec: MonitorMcpSpec
  outputFile: string
  signal: AbortSignal
}

export type RunMonitorResult = { error?: string }

export async function runMonitorMcp(opts: RunMonitorOpts): Promise<RunMonitorResult> {
  const { spec, outputFile, signal } = opts
  if (signal.aborted) return {}
  const iter = spec.eventStream(signal)
  let lastError: string | undefined
  for await (const ev of iter) {
    if (signal.aborted) return {}
    try {
      const line = ev.error
        ? `[error] ${ev.message}: ${ev.error}\n`
        : `${ev.message}\n`
      appendOutputSync(outputFile, line)
    } catch {
      // best-effort persistence
    }
    if (ev.done) {
      lastError = ev.error
      break
    }
  }
  return lastError !== undefined ? { error: lastError } : {}
}
