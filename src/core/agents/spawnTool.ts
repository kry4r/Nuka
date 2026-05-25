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
import { resolveToolCwd } from '../worktree/store'
import {
  createWorktree,
  defaultGitRunner,
  findGitRoot,
  type GitRunner,
} from '../worktree/git'
import { normalizeWorktreeName } from '../worktree/tools'
import type { OutputStyle } from '../outputStyles/types'
import type { Effort } from '../provider/types'
import type { Skill } from '../skill/types'
import type { Message } from '../message/types'
import type { LocalAgentSpec, LocalAgentWorktreeSpec, Task } from '../tasks/types'
import type { AgentRegistry } from './registry'
import { defineTool } from '../tools/define'
import { dispatchAgent } from './dispatch'
import { formatWriteScopeContext, normalizeWriteScope, type WriteScopeInput } from './writeScope'

export type SpawnAgentTaskManagerLike = {
  enqueue(spec: LocalAgentSpec): Task
}

export type SpawnAgentInput = {
  agent: string
  task: string
  context?: string
  description?: string
  fork_context?: boolean
  isolation?: 'inherit' | 'worktree'
  worktree_name?: string
  write_scope?: WriteScopeInput
}

export function makeSpawnAgentTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  taskManager: SpawnAgentTaskManagerLike
  hookRegistry?: HookRegistry
  worktreeStore?: WorktreeStore
  gitRunner?: GitRunner
  outputStyle?: () => OutputStyle | null
  /** Skill catalog available to sub-agents for agent.skills preloading. */
  skills?: Skill[]
  /** Optional final provider/model capability filter before each sub-agent request. */
  resolveEffort?: (
    effort: Effort | undefined,
    providerId: string,
    model: string,
  ) => Effort | undefined
}): Tool<SpawnAgentInput> {
  const listed = deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')

  return defineTool<SpawnAgentInput>({
    name: 'spawn_agent',
    description: `Start a background agent. Available: ${summary}.`,
    parameters: {
      type: 'object',
      required: ['agent', 'task'],
      properties: {
        agent: {
          type: 'string',
          description: 'Qualified agent name.',
          minLength: 1,
        },
        task: {
          type: 'string',
          description: 'Instruction.',
          minLength: 1,
        },
        context: {
          type: 'string',
          description: 'Context.',
        },
        description: {
          type: 'string',
          description: 'Task label.',
        },
        fork_context: {
          type: 'boolean',
          description:
            'Inject a summarized transcript fork from the parent session; not a byte-identical tool-result placeholder fork.',
        },
        isolation: {
          type: 'string',
          enum: ['inherit', 'worktree'],
          description: 'Cwd isolation.',
        },
        worktree_name: {
          type: 'string',
          description: 'Worktree name.',
          minLength: 1,
        },
        write_scope: {
          type: 'object',
          description: 'Descriptive write ownership boundary.',
          properties: {
            allow: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              description: 'Paths this agent may edit.',
            },
            deny: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              description: 'Paths this agent should avoid.',
            },
            note: {
              type: 'string',
              description: 'Scope note.',
            },
          },
          additionalProperties: false,
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
      const writeScope = normalizeWriteScope(input.write_scope)
      if (!writeScope.ok) {
        return { isError: true, output: writeScope.error }
      }
      const context = mergeContext(
        input.fork_context === true
          ? formatForkContext(ctx.session?.messages ?? [])
          : undefined,
        formatWriteScopeContext(writeScope.value),
        input.context,
      )
      const effectiveInput: SpawnAgentInput = {
        ...input,
        isolation: input.isolation ?? resolved.isolation,
      }
      const cwdResolution = resolveSpawnCwd(effectiveInput, ctx.cwd, deps)
      if (cwdResolution.isError) return cwdResolution.result
      const { cwd, worktreePath, worktree } = cwdResolution

      const task = deps.taskManager.enqueue({
        kind: 'local_agent',
        description,
        agentName: resolved.name,
        task: input.task,
        ...(context !== undefined ? { context } : {}),
        ...(writeScope.value !== undefined ? { writeScope: writeScope.value } : {}),
        providerId: parentSession?.providerId,
        model: resolved.model ?? parentSession?.model,
        cwd,
        ...(worktree ? { worktree, gitRunner: deps.gitRunner ?? defaultGitRunner } : {}),
        agentRunner: async function* (signal) {
          const result = await dispatchAgent({
            agent: resolved,
            task: input.task,
            ...(context !== undefined ? { context } : {}),
            registry: deps.registry,
            providerResolver: deps.providerResolver,
            permission: deps.permission,
            signal,
            cwd,
            ...(parentSession ? { parentSession } : {}),
            ...(deps.hookRegistry ? { hookRegistry: deps.hookRegistry } : {}),
            ...(deps.worktreeStore ? { worktreeStore: deps.worktreeStore } : {}),
            ...(activeStyle ? { outputStyle: activeStyle } : {}),
            ...(deps.skills ? { skills: deps.skills } : {}),
            ...(deps.resolveEffort ? { resolveEffort: deps.resolveEffort } : {}),
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
          ...(worktreePath ? [`worktree=${worktreePath}`] : []),
          ...(input.fork_context === true
            ? [
                'fork_context=summarized_transcript',
                'fork_context_note=summary-only; not a byte-identical tool-result placeholder fork',
              ]
            : []),
          `output_file=${task.outputFile}`,
          'Use TaskOutput with agent_id to read output; use TaskStop with agent_id to stop it.',
        ].join('\n'),
      }
    },
  })
}

function resolveSpawnCwd(
  input: SpawnAgentInput,
  parentCwd: string,
  deps: {
    worktreeStore?: WorktreeStore
    gitRunner?: GitRunner
  },
): { isError: false; cwd: string; worktreePath?: string; worktree?: LocalAgentWorktreeSpec } | { isError: true; result: ToolResult } {
  if (input.isolation !== 'worktree') {
    return {
      isError: false,
      cwd: resolveToolCwd(deps.worktreeStore, process.cwd()),
    }
  }
  if (!deps.worktreeStore) {
    return {
      isError: true,
      result: {
        isError: true,
        output: 'spawn_agent isolation=worktree requires a worktree store.',
      },
    }
  }
  const rawName = input.worktree_name?.trim() || input.task.slice(0, 64)
  const slug = normalizeWorktreeName(rawName)
  const runner = deps.gitRunner ?? defaultGitRunner
  const repoRoot = findGitRoot(runner, parentCwd)
  if (!repoRoot) {
    return {
      isError: true,
      result: {
        isError: true,
        output: `Not inside a git repository (cwd=${parentCwd}). spawn_agent isolation=worktree requires a git repo.`,
      },
    }
  }
  const created = createWorktree(runner, { repoRoot, slug })
  if (!created.ok) {
    return { isError: true, result: { isError: true, output: created.message } }
  }
  deps.worktreeStore.add({
    path: created.worktreePath,
    branch: created.branch,
    originalCwd: parentCwd,
  })
  return {
    isError: false,
    cwd: created.worktreePath,
    worktreePath: created.worktreePath,
    worktree: [created.worktreePath, repoRoot],
  }
}

function normalizeDescription(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function mergeContext(...values: Array<string | undefined>): string | undefined {
  const parts = values
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function formatForkContext(messages: readonly Message[]): string | undefined {
  const lines = messages
    .flatMap(messageToContextLines)
    .filter(line => line.trim().length > 0)
  return lines.length > 0
    ? ['Forked parent context:', ...lines].join('\n')
    : undefined
}

function messageToContextLines(message: Message): string[] {
  if (message.role === 'system') return [`system: ${message.content}`]
  if (message.role === 'tool') {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')
    return [`tool(${message.toolUseId}): ${content}`]
  }
  if (message.role === 'responses_compaction') {
    return [`context_compaction: ${JSON.stringify(message.output)}`]
  }
  const text = message.content
    .map(block => {
      if (block.type === 'text') return block.text
      if (block.type === 'tool_use') return `tool_use ${block.name}(${block.id}) ${JSON.stringify(block.input)}`
      if (block.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
  return text ? [`${message.role}: ${text}`] : []
}

function stringifyOutput(output: ToolResult['output']): string {
  if (typeof output === 'string') return output
  return output.map(block => {
    if (block.type === 'text') return block.text
    return JSON.stringify(block)
  }).join('\n')
}
