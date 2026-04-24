// src/core/agents/dispatchTool.ts
import type { Tool, ToolResult, ToolContext } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import type { ProviderResolver } from '../provider/resolver'
import type { PermissionChecker } from '../permission/checker'
import type { AgentRegistry } from './registry'
import { dispatchAgent } from './dispatch'

export const DISPATCH_AGENT_TOOL_NAME = 'dispatch_agent'

export type DispatchAgentInput = {
  agent: string
  task: string
  context?: string
}

/**
 * Build a `dispatch_agent` Tool. The description is a snapshot computed
 * from the current `AgentRegistry`; register this tool AFTER all plugins
 * have been wired so all declared agents are listed in the description.
 *
 * Recursion guard: when invoked from a dispatched sub-session (detected
 * via `ctx.session.allowedAgentDispatch === false`), the tool refuses
 * immediately with a structured error (no throw, no provider call).
 */
export function makeDispatchAgentTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
}): Tool<DispatchAgentInput> {
  const listed = deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')
  const description =
    `Dispatch a task to a specialist agent that runs in an isolated sub-session with its own filtered tool set. ` +
    `Use when a narrower expertise or tighter tool scope is more appropriate than handling the task yourself. ` +
    `Available: ${summary}.`

  return {
    name: DISPATCH_AGENT_TOOL_NAME,
    description,
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description:
            'Qualified agent name `<plugin>:<name>` as listed in this tool\'s description.',
        },
        task: {
          type: 'string',
          description: 'Concrete instruction for the specialist agent to execute.',
        },
        context: {
          type: 'string',
          description:
            'Optional background context — included verbatim after the task in the sub-agent\'s first user message.',
        },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
    source: 'builtin',
    // readOnly + parallelSafe so the main loop dispatches sibling sub-agents
    // concurrently even when both calls are to dispatch_agent itself. Each
    // sub-session has its own state (messages, permission cache, tool
    // registry), so concurrent execution is safe. The sub-agent's own write
    // tools still gate through the shared PermissionChecker.
    annotations: { readOnly: true, destructive: false, openWorld: true, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input: DispatchAgentInput, ctx: ToolContext): Promise<ToolResult> {
      // Recursion guard — a sub-agent's session has allowedAgentDispatch=false.
      if (ctx.session?.allowedAgentDispatch === false) {
        return {
          output: 'Sub-agents cannot dispatch further sub-agents.',
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
      const result = await dispatchAgent({
        agent: resolved,
        task: input.task,
        ...(input.context !== undefined ? { context: input.context } : {}),
        registry: deps.registry,
        providerResolver: deps.providerResolver,
        permission: deps.permission,
        signal: ctx.signal,
        ...(parentSession ? { parentSession } : {}),
      })
      return { output: result.output, isError: result.isError }
    },
  }
}
