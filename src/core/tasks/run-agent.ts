// src/core/tasks/run-agent.ts
//
// Phase 10 §4.3 — `local_agent` task runner.
//
// Consumes the spec's `agentRunner` async-iterable, persisting each
// chunk's `text` to the task's outputFile. The signal is forwarded so
// the iterable can short-circuit on cancel.
//
// Production code wires `dispatchAgent({...})` (Phase 5) into the
// `agentRunner` injection at task-creation time. This runner stays
// agnostic of agent internals so it remains trivially testable.

import { appendOutputSync } from './persist'
import type { LocalAgentSpec } from './types'

export type RunAgentOpts = {
  spec: LocalAgentSpec
  outputFile: string
  signal: AbortSignal
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { spec, outputFile, signal } = opts
  if (signal.aborted) return
  const iter = spec.agentRunner(signal)
  for await (const chunk of iter) {
    if (signal.aborted) return
    if (chunk.text.length === 0) continue
    try {
      const ends = chunk.text.endsWith('\n')
      appendOutputSync(outputFile, ends ? chunk.text : chunk.text + '\n')
    } catch {
      // Persistence failures are non-fatal; the agent loop continues
      // and the manager will record completion regardless.
    }
  }
}
