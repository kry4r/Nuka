// src/core/agents/spawnTool.ts
//
// Background subagent entrypoint. This is intentionally a thin wrapper
// around dispatchAgent + TaskManager.local_agent so the first public async
// API shares the same isolation, tool filtering, hooks, and output style
// behavior as the existing synchronous dispatch_agent tool.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import type { ProviderResolver } from '../provider/resolver'
import type { PermissionChecker } from '../permission/checker'
import type { HookRegistry } from '../hooks/registry'
import type { WorktreeStore } from '../worktree/store'
import type { OutputStyle } from '../outputStyles/types'
import type { LocalAgentSpec, Task } from '../tasks/types'
import type { AgentRegistry } from './registry'
import { defineTool } from '../tools/define'
import { dispatchAgent } from './dispatch'

export type SpawnAgentTaskManagerLike = {
  enqueue(spec: LocalAgentSpec): Task
}

export type SpawnAgentInput = {
  agent: string
  task: string
  context?: string
  description?: string
  fork_context?: boolean
}

export function makeSpawnAgentTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  taskManager: SpawnAgentTaskManagerLike
  hookRegistry?: HookRegistry
  worktreeStore?: WorktreeStore
  outputStyle?: () => OutputStyle | null
}): Tool<SpawnAgentInput> {
  const listed = deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')

  return defineTool<SpawnAgentInput>({
    name: 'spawn_agent',
    description:
      'Start a specialist agent in the background. Returns task_id and agent_id; use TaskOutput with agent_id to read progress/output and TaskStop with agent_id to stop it. ' +
      `Available: ${summary}.`,
    parameters: {
      type: 'object',
      required: ['agent', 'task'],
      properties: {
        agent: {
          type: 'string',
          description:
            'Qualified agent name `<plugin>:<name>` as listed in this tool\'s description.',
          minLength: 1,
        },
        task: {
          type: 'string',
          description: 'Concrete instruction for the specialist agent to execute.',
          minLength: 1,
        },
        context: {
          type: 'string',
          description:
            'Optional background context — included verbatim after the task in the sub-agent\'s first user message.',
        },
        description: {
          type: 'string',
          description:
            'Short label for the background task. Defaults to the selected agent and task preview.',
        },
        fork_context: {
          type: 'boolean',
          description:
            'Reserved for true forked-context subagents. Currently returns a clear unsupported error when true.',
        },
      },
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, destructive: false, openWorld: true },
    searchHint: ['agent', 'subagent', 'spawn', 'background', 'task'],
    async run(input: SpawnAgentInput, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.session?.allowedAgentDispatch === false) {
        return {
          output: 'Sub-agents cannot spawn further sub-agents.',
          isError: true,
        }
      }
      if (input.fork_context === true) {
        return {
          output:
            'fork_context is not supported yet: Nuka must persist parent transcripts before true forked-context subagents can inherit them.',
          isError: true,
        }
      }

      const resolved = deps.agents.find(input.agent)
      if (!resolved) {
        const available = deps.agents.list().map(a => a.name).join(', ') || '(none)'
        return {
          output: `Unknown agent '${input.agent}'. Available: ${available}`,
          isError: true,
        }
      }

      const parentSession = ctx.session
        ? { providerId: ctx.session.providerId, model: ctx.session.model }
        : undefined
      const description = normalizeDescription(input.description)
        ?? `${resolved.name}: ${input.task.slice(0, 80)}`
      const activeStyle = deps.outputStyle ? deps.outputStyle() : null

      const task = deps.taskManager.enqueue({
        kind: 'local_agent',
        description,
        agentName: resolved.name,
        task: input.task,
        ...(input.context !== undefined ? { context: input.context } : {}),
        providerId: parentSession?.providerId,
        model: resolved.model ?? parentSession?.model,
        agentRunner: async function* (signal) {
          const result = await dispatchAgent({
            agent: resolved,
            task: input.task,
            ...(input.context !== undefined ? { context: input.context } : {}),
            registry: deps.registry,
            providerResolver: deps.providerResolver,
            permission: deps.permission,
            signal,
            ...(parentSession ? { parentSession } : {}),
            ...(deps.hookRegistry ? { hookRegistry: deps.hookRegistry } : {}),
            ...(deps.worktreeStore ? { worktreeStore: deps.worktreeStore } : {}),
            ...(activeStyle ? { outputStyle: activeStyle } : {}),
          })
          yield { text: stringifyOutput(result.output) }
        },
      })

      return {
        isError: false,
        output: [
          'status=spawned',
          `task_id=${task.id}`,
          `agent_id=${task.agentId ?? `agent-${task.id}`}`,
          `agent=${resolved.name}`,
          `description=${task.description}`,
          `output_file=${task.outputFile}`,
          'Use TaskOutput with agent_id to read output; use TaskStop with agent_id to stop it.',
        ].join('\n'),
      }
    },
  })
}

function normalizeDescription(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function stringifyOutput(output: ToolResult['output']): string {
  if (typeof output === 'string') return output
  return output.map(block => {
    if (block.type === 'text') return block.text
    return JSON.stringify(block)
  }).join('\n')
}
