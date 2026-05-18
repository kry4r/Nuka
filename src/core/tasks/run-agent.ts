// src/core/tasks/run-agent.ts
//
// Phase 10 §4.3 — `local_agent` task runner.
//
// Consumes the spec's `agentRunner` async-iterable, persisting each
// chunk's `text` to the task's outputFile. The signal is forwarded so
// the iterable can short-circuit on cancel.
//
// 2026-05-18 lifecycle wiring: when `spec.hookRegistry` is present,
// fires `sessionStart` BEFORE the first chunk, `afterTurn` AFTER the
// iterable completes successfully, and `sessionEnd` on EVERY exit path
// (success, abort, throw). All payloads carry `context: 'task'` so
// handlers can filter on origin. Errors raised inside the registry are
// already swallowed by the fire helpers (`safeInvoke`).

import { appendOutputSync } from './persist'
import {
  fireSessionStart,
  fireSessionEnd,
  fireAfterTurn,
} from '../hooks/lifecycle'
import type { LocalAgentSpec } from './types'

export type RunAgentOpts = {
  spec: LocalAgentSpec
  outputFile: string
  signal: AbortSignal
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { spec, outputFile, signal } = opts
  const registry = spec.hookRegistry
  const sessionId = spec.taskSessionId ?? 'task-unknown'
  const providerId = spec.providerId ?? 'unknown'
  const model = spec.model ?? 'unknown'

  // sessionStart fires BEFORE the abort check so handlers that need to
  // record "task started" see the event even when the caller pre-aborts.
  if (registry) {
    await fireSessionStart(
      registry,
      {
        sessionId,
        providerId,
        model,
        cwd: process.cwd(),
        resumed: false,
        context: 'task',
      },
      { signal },
    )
  }

  let exitReason: 'completed' | 'aborted' | 'error' = 'completed'

  try {
    if (signal.aborted) {
      exitReason = 'aborted'
      return
    }
    const iter = spec.agentRunner(signal)
    for await (const chunk of iter) {
      if (signal.aborted) {
        exitReason = 'aborted'
        return
      }
      if (chunk.text.length === 0) continue
      try {
        const ends = chunk.text.endsWith('\n')
        appendOutputSync(outputFile, ends ? chunk.text : chunk.text + '\n')
      } catch {
        // Persistence failures are non-fatal; the agent loop continues
        // and the manager will record completion regardless.
      }
    }
    if (signal.aborted) exitReason = 'aborted'
  } catch (err) {
    exitReason = signal.aborted ? 'aborted' : 'error'
    if (!signal.aborted) throw err
  } finally {
    if (registry) {
      // afterTurn only fires on a clean completion. Aborts / errors skip
      // it because the turn never finished — sessionEnd is the
      // authoritative "task done" signal.
      //
      // IMPORTANT: do NOT forward an already-aborted signal into the
      // lifecycle fires — the pipeline would see signal.aborted===true and
      // skip every handler. We only forward the signal when the run ended
      // cleanly so the timeout gate still applies; on abort/error paths we
      // fire with no caller signal so the 5s default timeout governs.
      if (exitReason === 'completed') {
        await fireAfterTurn(
          registry,
          {
            sessionId,
            stopReason: 'end_turn',
            toolCalls: 0,
            context: 'task',
          },
          { signal },
        )
      }
      await fireSessionEnd(
        registry,
        {
          sessionId,
          reason: exitReason === 'completed' ? 'completed' : 'aborted',
          context: 'task',
        },
        // Do not pass the caller signal here: if the task was aborted,
        // signal.aborted===true and the pipeline would skip all handlers.
        // sessionEnd must always fire regardless of abort state.
        {},
      )
    }
  }
}
