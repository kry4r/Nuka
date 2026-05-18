// src/core/tools/coordinator/coordinateAgentsTool.ts
//
// B5 — Public tool surface for the coordinator. Wraps runCoordinator
// into a `Tool` the main loop can call. The tool spec mirrors
// dispatch_agent's style: deterministic name, JSON schema parameters,
// recursion guard via ctx.session.allowedAgentDispatch.

import type { Tool, ToolResult, ToolContext } from '../types'
import { defineTool } from '../define'
import type { AgentRegistry } from '../../agents/registry'
import type { ToolRegistry } from '../registry'
import type { ProviderResolver } from '../../provider/resolver'
import type { PermissionChecker } from '../../permission/checker'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../agents/dispatch'
import { runCoordinator } from '../../agents/coordinator/coordinator'
import type { CoordinatorInput, CoordinatorResult } from '../../agents/coordinator/types'

export const COORDINATE_AGENTS_TOOL_NAME = 'coordinate_agents'

export type CoordinateAgentsInput = {
  goal: string
  agents: Array<{ name: string; task: string; context?: string }>
  maxIterations: number
}

function renderResult(r: CoordinatorResult): string {
  const lines: string[] = []
  lines.push(`Iterations: ${r.iterations}${r.hitCap ? ' (hit cap)' : ''}`)
  lines.push('')
  lines.push('Outcomes:')
  for (const o of r.outcomes) {
    lines.push(`- ${o.name} [${o.status}, ${o.turns} turns]${o.error ? ` error="${o.error}"` : ''}`)
    if (o.status === 'ok') {
      const head = o.summary.split('\n').slice(0, 3).join(' / ')
      lines.push(`  ${head}`)
    }
  }
  const keys = Object.keys(r.blackboard)
  if (keys.length > 0) {
    lines.push('')
    lines.push('Final blackboard:')
    for (const key of keys.sort()) {
      lines.push(`- ${key}: ${r.blackboard[key] ?? ''}`)
    }
  }
  return lines.join('\n')
}

export function makeCoordinateAgentsTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  /** Injectable for tests — defaults to the real dispatchAgent. */
  dispatch?: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>
}): Tool<CoordinateAgentsInput> {
  const listed = deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')
  const description =
    `Run multiple specialist agents in parallel toward a shared goal, with a coordinator-managed blackboard for cross-agent context. ` +
    `Each agent gets bb_read and bb_write tools to share findings with siblings. The coordinator re-spawns agents until every worker emits ` +
    `\`done: true\` or maxIterations is reached. Use this when independent investigation angles benefit from cross-pollination. ` +
    `Available agents: ${summary}.`

  return defineTool<CoordinateAgentsInput>({
    name: COORDINATE_AGENTS_TOOL_NAME,
    description,
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Shared high-level goal shown to every worker.' },
        agents: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Qualified agent name (`<plugin>:<name>`).' },
              task: { type: 'string', description: 'Concrete per-agent instruction.' },
              context: { type: 'string', description: 'Optional extra context appended to the task.' },
            },
            required: ['name', 'task'],
            additionalProperties: false,
          },
        },
        maxIterations: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Cap on coordinator iterations (re-spawns) before returning.',
        },
      },
      required: ['goal', 'agents', 'maxIterations'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: false, destructive: false, openWorld: true, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input: CoordinateAgentsInput, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.session?.allowedAgentDispatch === false) {
        return { output: 'Sub-agents cannot launch a coordinator.', isError: true }
      }
      if (input.agents.length === 0) {
        return { output: 'agents array must be non-empty.', isError: true }
      }
      if (input.maxIterations < 1 || input.maxIterations > 10) {
        return { output: 'maxIterations must be between 1 and 10.', isError: true }
      }
      const coordInput: CoordinatorInput = {
        goal: input.goal,
        agents: input.agents,
        maxIterations: input.maxIterations,
      }
      const result = await runCoordinator(
        coordInput,
        {
          agents: deps.agents,
          registry: deps.registry,
          providerResolver: deps.providerResolver,
          permission: deps.permission,
          ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
        },
        ctx.signal,
      )
      return {
        output: renderResult(result),
        isError: result.outcomes.some(o => o.status === 'error') || result.hitCap,
      }
    },
  })
}
