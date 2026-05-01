import type { Triage } from '../harness/types'
import { decomposeTask } from './decompose'
import { TaskGraph } from './taskGraph'

export type ExecutionPlan =
  | { kind: 'inline' }
  | { kind: 'graph'; graph: TaskGraph; listening: boolean }

export type PlanOpts = {
  triage: Triage
  rootMessage: string
  runFork: (prompt: string) => Promise<{ text: string }>
}

/**
 * Decide the execution shape for a freshly-triaged user message.
 *
 * - simple/medium → run inline in the main agent (no DAG)
 * - hard         → decompose + DAG, no a2a listening
 * - hell         → decompose + DAG + every sub-task auto-registers a2a subscription
 */
export async function planExecution(opts: PlanOpts): Promise<ExecutionPlan> {
  const { difficulty, profile } = opts.triage
  if (difficulty === 'simple' || difficulty === 'medium') {
    return { kind: 'inline' }
  }
  const graph = await decomposeTask({
    rootMessage: opts.rootMessage,
    profile,
    difficulty,
    runFork: opts.runFork,
  })
  return { kind: 'graph', graph, listening: difficulty === 'hell' }
}
