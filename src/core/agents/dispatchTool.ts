// src/core/agents/dispatchTool.ts
import type { Tool, ToolResult, ToolContext } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import type { ProviderResolver } from '../provider/resolver'
import type { PermissionChecker } from '../permission/checker'
import type { HookRegistry } from '../hooks/registry'
import type { WorktreeStore } from '../worktree/store'
import type { OutputStyle } from '../outputStyles/types'
import type { Effort } from '../provider/types'
import type { Skill } from '../skill/types'
import type { AgentRegistry } from './registry'
import { dispatchAgent } from './dispatch'
import { defineTool } from '../tools/define'

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
 *
 * Iter RRR: optional `hookRegistry` is threaded into the inner
 * `dispatchAgent` call so that lifecycle events (sessionStart /
 * promptSubmit / afterTurn / sessionEnd) fire inside the sub-session
 * with `context: 'subagent'`. The parent registry is reused, matching
 * Option A from the iter spec — one hook config sees everything.
 */
export function makeDispatchAgentTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  /** Optional — when omitted, sub-agents simply skip lifecycle fires. */
  hookRegistry?: HookRegistry
  /**
   * P1 #6 — optional WorktreeStore forwarded to the inner `dispatchAgent`
   * call so sub-agent tools resolve their cwd through the same active
   * worktree as the parent loop (inherit-by-default). When omitted,
   * sub-agents fall back to `process.cwd()`.
   */
  worktreeStore?: WorktreeStore
  /**
   * Resolver for the active user output style. Evaluated per dispatch
   * (not captured at `makeDispatchAgentTool` time) so the main loop and
   * sub-agents pick up `NUKA_OUTPUT_STYLE` changes between turns. Return
   * `null` (or omit the dep entirely) to skip the merge — sub-agents
   * then see their declared `systemPrompt` byte-for-byte, matching the
   * pre-output-styles behaviour.
   */
  outputStyle?: () => OutputStyle | null
  /** Skill catalog available to sub-agents for agent.skills preloading. */
  skills?: Skill[]
  /** Optional final provider/model capability filter before each sub-agent request. */
  resolveEffort?: (
    effort: Effort | undefined,
    providerId: string,
    model: string,
  ) => Effort | undefined
  /** Available MCP server names used to hide agents with unmet requirements. */
  availableMcpServers?: () => readonly string[]
}): Tool<DispatchAgentInput> {
  const visibleMcpServers = deps.availableMcpServers?.()
  const listed = visibleMcpServers
    ? deps.agents.listAvailable(visibleMcpServers)
    : deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')
  const description =
    `Dispatch a task to a specialist agent that runs in an isolated sub-session with its own filtered tool set. ` +
    `Use when a narrower expertise or tighter tool scope is more appropriate than handling the task yourself. ` +
    `Available: ${summary}.`

  return defineTool<DispatchAgentInput>({
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
    tags: ['core', 'agent'],
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
      const availableMcpServers = deps.availableMcpServers?.()
      const resolved = availableMcpServers
        ? deps.agents.findAvailable(input.agent, availableMcpServers)
        : deps.agents.find(input.agent)
      if (!resolved) {
        const unavailable = deps.agents.find(input.agent)
        if (availableMcpServers && unavailable && unavailable.requiredMcpServers?.length) {
          return {
            output:
              `Unavailable agent '${input.agent}' requires MCP servers: ` +
              unavailable.requiredMcpServers.join(', '),
            isError: true,
          }
        }
        const availableList = availableMcpServers
          ? deps.agents.listAvailable(availableMcpServers).map(a => a.name)
          : deps.agents.list().map(a => a.name)
        const available = availableList.join(', ') || '(none)'
        return {
          output: `Unknown agent '${input.agent}'. Available: ${available}`,
          isError: true,
        }
      }
      if (resolved.background === true) {
        return {
          output:
            `Agent '${resolved.name}' is configured with background=true. ` +
            `Use spawn_agent with agent='${resolved.name}' to launch it asynchronously.`,
          isError: true,
        }
      }
      const parentSession = ctx.session
        ? { providerId: ctx.session.providerId, model: ctx.session.model }
        : undefined
      // Resolve the active output style per-dispatch so env-var changes
      // between turns are picked up. The resolver is intentionally
      // synchronous — styles were loaded once at boot and live in
      // memory; per-call cost is a Map lookup.
      const activeStyle = deps.outputStyle ? deps.outputStyle() : null
      const result = await dispatchAgent({
        agent: resolved,
        task: input.task,
        ...(input.context !== undefined ? { context: input.context } : {}),
        registry: deps.registry,
        providerResolver: deps.providerResolver,
        permission: deps.permission,
        signal: ctx.signal,
        ...(parentSession ? { parentSession } : {}),
        ...(deps.hookRegistry ? { hookRegistry: deps.hookRegistry } : {}),
        ...(deps.worktreeStore ? { worktreeStore: deps.worktreeStore } : {}),
        ...(activeStyle ? { outputStyle: activeStyle } : {}),
        ...(deps.skills ? { skills: deps.skills } : {}),
        ...(deps.resolveEffort ? { resolveEffort: deps.resolveEffort } : {}),
      })
      return { output: result.output, isError: result.isError }
    },
  })
}
