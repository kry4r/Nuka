// src/core/agents/coordinator/coordinator.ts
//
// B5 — Top-level orchestrator. Runs N workers per iteration via
// Promise.allSettled (so a thrown error in one worker does not abort
// siblings). Each worker receives a per-iteration prompt assembled by
// composeWorkerPrompt and a sub-registry that includes the shared
// bb_read / bb_write tools. The loop terminates when every worker
// emits a `done: true` marker or when maxIterations is reached.
//
// Layering: this module calls the existing `dispatchAgent` (injected
// via deps for testability). The dispatcher itself is NOT modified —
// the only addition to its sub-registry is the pair of blackboard tools,
// added by this coordinator before each dispatch.
//
// CAVEAT: workers whose `ResolvedAgentDef.allowedTools` is set will have
// the blackboard tools filtered out by `filterTools` inside dispatchAgent.
// That's a known limitation — agents that want to participate in
// coordinator runs must either omit `allowedTools` or explicitly include
// `bb_read` / `bb_write` in their allowed list.

import type { AgentRegistry } from '../registry'
import type { ToolRegistry } from '../../tools/registry'
import { ToolRegistry as ToolRegistryClass } from '../../tools/registry'
import type { Tool } from '../../tools/types'
import type { ProviderResolver } from '../../provider/resolver'
import type { PermissionChecker } from '../../permission/checker'
import type {
  DispatchAgentOpts,
  DispatchAgentResult,
} from '../dispatch'
import { dispatchAgent as defaultDispatch } from '../dispatch'
import { Blackboard } from './blackboard'
import { composeWorkerPrompt, isDone } from './prompt'
import type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  WorkerOutcome,
} from './types'
import { makeBlackboardTools } from '../../tools/coordinator/blackboardTool'

export type CoordinatorDeps = {
  /** Injectable for tests. Defaults to the real dispatchAgent. */
  dispatch?: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
}

const MAX_SUMMARY_BYTES = 4 * 1024

function truncateSummary(s: string | object): string {
  const text = typeof s === 'string' ? s : JSON.stringify(s)
  if (text.length <= MAX_SUMMARY_BYTES) return text
  return text.slice(0, MAX_SUMMARY_BYTES) + '\n…[truncated]'
}

function outcomeFromResult(name: string, res: DispatchAgentResult): WorkerOutcome {
  const text = typeof res.output === 'string'
    ? res.output
    : res.output.map(b => (b.type === 'text' ? b.text : '')).join('')
  return {
    name,
    status: res.isError ? 'error' : 'ok',
    summary: truncateSummary(text),
    turns: res.turns,
    error: res.isError ? truncateSummary(text) : undefined,
  }
}

function outcomeFromError(name: string, err: unknown): WorkerOutcome {
  return {
    name,
    status: 'error',
    summary: '',
    turns: 0,
    error: (err instanceof Error ? err.message : String(err)).slice(0, MAX_SUMMARY_BYTES),
  }
}

export async function runCoordinator(
  input: CoordinatorInput,
  deps: CoordinatorDeps,
  signal: AbortSignal,
): Promise<CoordinatorResult> {
  if (input.agents.length === 0) {
    return { iterations: 0, blackboard: {}, outcomes: [], hitCap: false }
  }
  const dispatch = deps.dispatch ?? defaultDispatch
  const blackboard = new Blackboard()
  const bbTools = makeBlackboardTools(blackboard)

  let outcomes: WorkerOutcome[] = []
  let iteration = 0
  let allDone = false

  while (iteration < input.maxIterations && !signal.aborted && !allDone) {
    iteration += 1
    const snapshot = blackboard.snapshot()
    const iterPromises = input.agents.map(async (spec: AgentSpec): Promise<WorkerOutcome> => {
      const resolved = deps.agents.find(spec.name)
      if (!resolved) {
        return {
          name: spec.name,
          status: 'error',
          summary: '',
          turns: 0,
          error: `Unknown agent: ${spec.name}`,
        }
      }
      // Per-worker sub-registry: parent tools + bb_read + bb_write.
      // Cast to the registry's generic-erased Tool — the registry stores
      // `Tool<unknown>`, but typed factories produce `Tool<I>` which is a
      // strict-variance mismatch on the `needsPermission(input: I)` arg.
      // The existing `dispatch_agent` registration in cli.tsx uses the
      // same widening pattern (`as any`); a `Tool`-typed cast is the
      // narrowest equivalent that keeps strict mode happy.
      const subReg = new ToolRegistryClass()
      for (const t of deps.registry.list()) subReg.register(t)
      subReg.register(bbTools.read as unknown as Tool)
      subReg.register(bbTools.write as unknown as Tool)

      const task = composeWorkerPrompt({
        goal: input.goal,
        task: spec.task,
        iteration,
        blackboard: snapshot,
      })
      try {
        const res = await dispatch({
          agent: resolved,
          task,
          ...(spec.context !== undefined ? { context: spec.context } : {}),
          registry: subReg,
          providerResolver: deps.providerResolver,
          permission: deps.permission,
          signal,
        })
        return outcomeFromResult(spec.name, res)
      } catch (err) {
        return outcomeFromError(spec.name, err)
      }
    })

    const settled = await Promise.allSettled(iterPromises)
    outcomes = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return outcomeFromError(input.agents[i]!.name, r.reason)
    })

    // Done when every OK worker emitted `done: true` and no errors blocked them.
    // Errors do NOT count as done — we re-spawn next iteration so they can retry.
    allDone = outcomes.every(o => o.status === 'ok' && isDone(o.summary))
    if (signal.aborted) break
  }

  return {
    iterations: iteration,
    blackboard: blackboard.snapshot(),
    outcomes,
    hitCap: !allDone && iteration >= input.maxIterations,
  }
}
