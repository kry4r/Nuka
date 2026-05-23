// src/core/agents/agentLifecycleTools.ts
//
// Public subagent lifecycle aliases. These intentionally delegate to the
// background task tools so task lookup, blocking, output rendering, and
// cancellation semantics stay in one place.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import type { TaskOutputToolInput } from '../tasks/outputTool'
import type { TaskStopToolInput } from '../tasks/stopTool'
import type { LocalAgentSpec, Task } from '../tasks/types'
import { cleanLookupId, findTaskByAgentId, type TaskLookupManagerLike } from '../tasks/lookup'
import { findLatestMetaByAgentId } from '../tasks/meta'
import type { AgentRegistry } from './registry'
import type { ToolRegistry } from '../tools/registry'
import type { ProviderResolver } from '../provider/resolver'
import type { PermissionChecker } from '../permission/checker'
import type { HookRegistry } from '../hooks/registry'
import type { WorktreeStore } from '../worktree/store'
import type { OutputStyle } from '../outputStyles/types'
import { dispatchAgent } from './dispatch'

export type WaitAgentInput = {
  agent_id?: string
  task_id?: string
  timeout_ms?: number
  lines?: number
}

export type CloseAgentInput = {
  agent_id?: string
  task_id?: string
}

export type ResumeAgentInput = {
  agent_id: string
  prompt: string
  context?: string
  description?: string
}

export type SendAgentInput = {
  agent_id: string
  message: string
  context?: string
  description?: string
}

export type ResumeAgentTaskManagerLike = TaskLookupManagerLike & {
  enqueue(spec: LocalAgentSpec): Task
}

export type ResumeAgentDeps = {
  taskManager: ResumeAgentTaskManagerLike
  home?: string
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  hookRegistry?: HookRegistry
  worktreeStore?: WorktreeStore
  outputStyle?: () => OutputStyle | null
}

export function makeWaitAgentTool(
  taskOutputTool: Tool<TaskOutputToolInput>,
): Tool<WaitAgentInput> {
  return defineTool<WaitAgentInput>({
    name: 'wait_agent',
    description:
      'Wait for a background subagent to finish, then return its final output and task metadata. Prefer agent_id from spawn_agent; task_id is accepted for compatibility.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'Stable subagent ID returned by spawn_agent.',
          minLength: 1,
        },
        task_id: {
          type: 'string',
          description:
            'Background task ID. Compatibility escape hatch; agent_id is preferred.',
          minLength: 1,
        },
        timeout_ms: {
          type: 'integer',
          description:
            'Max wait in milliseconds. Passed through to TaskOutput.',
          minimum: 0,
        },
        lines: {
          type: 'integer',
          description:
            'Max number of trailing output lines to return. Passed through to TaskOutput.',
          minimum: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'agent', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['agent', 'wait', 'background', 'task', 'output'],
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      const forwarded: TaskOutputToolInput = {
        ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
        ...(input.task_id !== undefined ? { task_id: input.task_id } : {}),
        block: true,
        ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {}),
        ...(input.lines !== undefined ? { lines: input.lines } : {}),
      }
      return taskOutputTool.run(forwarded, ctx)
    },
  })
}

export function makeCloseAgentTool(
  taskStopTool: Tool<TaskStopToolInput>,
): Tool<CloseAgentInput> {
  return defineTool<CloseAgentInput>({
    name: 'close_agent',
    description:
      'Stop a background subagent. Prefer agent_id from spawn_agent; task_id is accepted for compatibility.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'Stable subagent ID returned by spawn_agent.',
          minLength: 1,
        },
        task_id: {
          type: 'string',
          description:
            'Background task ID. Compatibility escape hatch; agent_id is preferred.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'agent', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, destructive: false },
    searchHint: ['agent', 'close', 'stop', 'kill', 'background', 'task'],
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      const forwarded: TaskStopToolInput = {
        ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
        ...(input.task_id !== undefined ? { task_id: input.task_id } : {}),
      }
      return taskStopTool.run(forwarded, ctx)
    },
  })
}

export function makeResumeAgentTool(
  deps: ResumeAgentDeps,
): Tool<ResumeAgentInput> {
  return defineTool<ResumeAgentInput>({
    name: 'resume_agent',
    description:
      'Start a new background execution for an existing logical subagent. Reuses the prior agent_id and task metadata; prompt is appended as the new instruction. This is a lightweight resume and does not yet reconstruct full transcript/worktree state.',
    parameters: {
      type: 'object',
      required: ['agent_id', 'prompt'],
      properties: {
        agent_id: {
          type: 'string',
          description: 'Stable subagent ID returned by spawn_agent.',
          minLength: 1,
        },
        prompt: {
          type: 'string',
          description: 'Follow-up instruction for the resumed subagent execution.',
          minLength: 1,
        },
        context: {
          type: 'string',
          description: 'Optional additional context to append after prior context.',
        },
        description: {
          type: 'string',
          description: 'Short label for the resumed background task.',
        },
      },
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, destructive: false, openWorld: true },
    searchHint: ['agent', 'resume', 'background', 'task'],
    async run(input): Promise<ToolResult> {
      return enqueueAgentFollowup(deps, {
        agentIdRaw: input.agent_id,
        promptRaw: input.prompt,
        context: input.context,
        description: input.description,
        emptyPromptMessage: 'prompt is required.',
        status: 'resumed',
        sourceLabel: 'resumed_from',
      })
    },
  })
}

export function makeSendAgentTool(
  deps: ResumeAgentDeps,
): Tool<SendAgentInput> {
  return defineTool<SendAgentInput>({
    name: 'send_agent',
    description:
      'Send a follow-up instruction to an existing background subagent. Reuses the same stable agent_id and starts a new background execution. This is currently equivalent to resume_agent with message instead of prompt.',
    parameters: {
      type: 'object',
      required: ['agent_id', 'message'],
      properties: {
        agent_id: {
          type: 'string',
          description: 'Stable subagent ID returned by spawn_agent.',
          minLength: 1,
        },
        message: {
          type: 'string',
          description: 'Follow-up instruction to send to the subagent.',
          minLength: 1,
        },
        context: {
          type: 'string',
          description: 'Optional additional context to append after prior context.',
        },
        description: {
          type: 'string',
          description: 'Short label for the follow-up background task.',
        },
      },
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false, destructive: false, openWorld: true },
    searchHint: ['agent', 'send', 'message', 'background', 'task'],
    async run(input): Promise<ToolResult> {
      return enqueueAgentFollowup(deps, {
        agentIdRaw: input.agent_id,
        promptRaw: input.message,
        context: input.context,
        description: input.description,
        emptyPromptMessage: 'message is required.',
        status: 'sent',
        sourceLabel: 'sent_to',
      })
    },
  })
}

type AgentFollowupOpts = {
  agentIdRaw: string
  promptRaw: string
  context?: string
  description?: string
  emptyPromptMessage: string
  status: 'resumed' | 'sent'
  sourceLabel: 'resumed_from' | 'sent_to'
}

async function enqueueAgentFollowup(
  deps: ResumeAgentDeps,
  opts: AgentFollowupOpts,
): Promise<ToolResult> {
  const agentId = cleanLookupId(opts.agentIdRaw)
  if (!agentId) {
    return { isError: true, output: 'agent_id is required.' }
  }
  const prompt = opts.promptRaw.trim()
  if (!prompt) {
    return { isError: true, output: opts.emptyPromptMessage }
  }

  const seed = findResumeSeed(deps, agentId)
  if (seed.error) return seed.error

  const { agentName } = seed
  const resolved = deps.agents.find(agentName)
  if (!resolved) {
    const available = deps.agents.list().map(a => a.name).join(', ') || '(none)'
    return {
      isError: true,
      output: `Cannot resume agent '${agentName}': definition is not registered. Available: ${available}`,
    }
  }
  const context = mergeContext(seed.context, opts.context)
  const description = normalizeDescription(opts.description)
    ?? `${agentName}: ${prompt.slice(0, 80)}`
  const providerId = seed.providerId
  const model = resolved.model ?? seed.model
  const parentSession = providerId && model ? { providerId, model } : undefined
  const activeStyle = deps.outputStyle ? deps.outputStyle() : null
  const task = deps.taskManager.enqueue({
    kind: 'local_agent',
    description,
    agentId,
    agentName,
    task: prompt,
    ...(context !== undefined ? { context } : {}),
    resumed: true,
    providerId,
    model,
    ...(seed.hookRegistry ? { hookRegistry: seed.hookRegistry } : {}),
    ...(seed.taskSessionId ? { taskSessionId: seed.taskSessionId } : {}),
    agentRunner: async function* (signal) {
      const result = await dispatchAgent({
        agent: resolved,
        task: prompt,
        ...(context !== undefined ? { context } : {}),
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
      `status=${opts.status}`,
      `task_id=${task.id}`,
      `agent_id=${task.agentId ?? agentId}`,
      `agent=${agentName}`,
      `description=${task.description}`,
      `${opts.sourceLabel}=${seed.sourceId}`,
      `output_file=${task.outputFile}`,
      'Use wait_agent with agent_id to read final output; use close_agent with agent_id to stop it.',
    ].join('\n'),
  }
}

type ResumeSeed =
  | {
      error: undefined
      sourceId: string
      agentName: string
      context?: string
      providerId?: string
      model?: string
      hookRegistry?: HookRegistry
      taskSessionId?: string
    }
  | {
      error: ToolResult
    }

function findResumeSeed(deps: ResumeAgentDeps, agentId: string): ResumeSeed {
  const previous = findTaskByAgentId(deps.taskManager, agentId)
  if (previous) {
    if (previous.kind !== 'local_agent' || previous.spec.kind !== 'local_agent') {
      return {
        error: {
          isError: true,
          output: `Task ${previous.id} is not a local subagent execution.`,
        },
      }
    }
    const prior = previous.spec
    return {
      error: undefined,
      sourceId: previous.id,
      agentName: prior.agentName ?? previous.agentName ?? agentId,
      context: prior.context,
      providerId: prior.providerId,
      model: prior.model,
      hookRegistry: prior.hookRegistry,
      taskSessionId: prior.taskSessionId,
    }
  }

  const persisted = deps.home ? findLatestMetaByAgentId(deps.home, agentId) : undefined
  if (!persisted) {
    return {
      error: {
        isError: true,
        output: `No background task with agent id '${agentId}'.`,
      },
    }
  }
  if (persisted.kind !== 'local_agent') {
    return {
      error: {
        isError: true,
        output: `Task ${persisted.id} is not a local subagent execution.`,
      },
    }
  }
  return {
    error: undefined,
    sourceId: persisted.id,
    agentName: persisted.agentName ?? agentId,
    context: persisted.agentContext,
    providerId: persisted.providerId,
    model: persisted.model,
  }
}

function normalizeDescription(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function mergeContext(
  prior: string | undefined,
  next: string | undefined,
): string | undefined {
  const parts = [prior, next]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function stringifyOutput(output: ToolResult['output']): string {
  if (typeof output === 'string') return output
  return output.map(block => {
    if (block.type === 'text') return block.text
    return JSON.stringify(block)
  }).join('\n')
}
