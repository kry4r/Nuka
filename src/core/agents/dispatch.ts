// src/core/agents/dispatch.ts
import type { ResolvedAgentDef } from './types'
import type { ToolRegistry } from '../tools/registry'
import type { ProviderResolver } from '../provider/resolver'
import type { PermissionChecker } from '../permission/checker'
import type { Tool, ToolResult } from '../tools/types'
import type { AssistantMessage, TokenUsage } from '../message/types'
import type { ContentBlock as ToolContentBlock } from '../tools/content'
import { ToolRegistry as ToolRegistryClass } from '../tools/registry'
import { filterTools } from './toolFilter'
import { createSession, appendMessage } from '../session/session'
import {
  makeUserMessage,
  emptyAssistant,
  makeToolMessage,
} from '../message/factories'
import { addUsage } from '../session/telemetry'
import { validateWithJsonSchema } from '../tools/validate'
import { serializeContentBlocks } from '../tools/content'

export type DispatchAgentOpts = {
  agent: ResolvedAgentDef
  task: string
  context?: string
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  signal: AbortSignal
  /** Parent session — used to inherit providerId/model when agent.model is unset. */
  parentSession?: { providerId: string; model: string }
  /** Override agent.maxTurns (falls back to agent.maxTurns which defaults to 20). */
  maxTurns?: number
}

export type DispatchAgentResult = {
  output: string | ToolContentBlock[]
  isError: boolean
  turns: number
  usage: TokenUsage
}

/**
 * Run an isolated sub-session for the given agent.
 *
 * Isolation:
 * - fresh Session (no parent messages, no parent usage, empty queue,
 *   empty permission cache).
 * - `session.allowedAgentDispatch = false` prevents recursive dispatch.
 * - a fresh `ToolRegistry` is built from the parent registry filtered
 *   through `filterTools(registry.list(), agent)`.
 *
 * Returns a structured result rather than throwing. Provider errors
 * are captured as `isError: true` with the error message.
 */
export async function dispatchAgent(opts: DispatchAgentOpts): Promise<DispatchAgentResult> {
  const {
    agent,
    task,
    context,
    registry,
    providerResolver,
    permission,
    signal,
    parentSession,
  } = opts
  const maxTurns = opts.maxTurns ?? agent.maxTurns ?? 20

  // Build filtered tool registry for the sub-session.
  const filtered: Tool[] = filterTools(registry.list(), {
    allowedTools: agent.allowedTools,
    deniedTools: agent.deniedTools,
  })
  const subRegistry = new ToolRegistryClass()
  for (const t of filtered) subRegistry.register(t)

  // Fresh session: provider/model inherited unless overridden by agent.model.
  const providerId = parentSession?.providerId ?? providerResolver.listProviders()[0]?.id ?? ''
  const model = agent.model ?? parentSession?.model ?? ''
  const session = createSession({ providerId, model })
  session.allowedAgentDispatch = false
  session.allowedTeamCreate = false

  // Seed with the first user message; include optional context.
  const firstText = context !== undefined && context.length > 0
    ? `${task}\n\n--- context ---\n${context}`
    : task
  appendMessage(session, makeUserMessage({ text: firstText }))

  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  let turns = 0
  let lastAssistant: AssistantMessage | undefined

  try {
    while (!signal.aborted && turns < maxTurns) {
      const { provider, model: resolvedModel } = providerResolver.resolveFor(session)
      turns++

      const toolSpecs = subRegistry.list().map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))

      const stream = provider.stream(
        {
          model: resolvedModel,
          system: agent.systemPrompt,
          messages: session.messages,
          tools: toolSpecs,
          ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
          ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
        },
        signal,
      )

      const assistant = emptyAssistant()
      for await (const ev of stream) {
        if (ev.type === 'text_delta') {
          const last = assistant.content[assistant.content.length - 1]
          if (last && last.type === 'text') last.text += ev.text
          else assistant.content.push({ type: 'text', text: ev.text })
        } else if (ev.type === 'tool_use_start') {
          assistant.content.push({ type: 'tool_use', id: ev.id, name: ev.name, input: {} })
        } else if (ev.type === 'tool_use_stop') {
          for (let i = assistant.content.length - 1; i >= 0; i--) {
            const b = assistant.content[i]
            if (b && b.type === 'tool_use' && b.id === ev.id) {
              b.input = ev.input
              break
            }
          }
        } else if (ev.type === 'message_stop') {
          assistant.usage = ev.usage
          assistant.stopReason = ev.stopReason
        }
      }
      appendMessage(session, assistant)
      lastAssistant = assistant
      if (assistant.usage) totalUsage = addUsage(totalUsage, assistant.usage)

      const calls = assistant.content.flatMap(b =>
        b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
      )
      if (calls.length === 0) {
        // Turn ended naturally — extract final text.
        return {
          output: finalOutput(assistant),
          isError: false,
          turns,
          usage: totalUsage,
        }
      }

      // Run tool calls serially (sub-agents don't need parallelism for a first cut).
      for (const call of calls) {
        if (signal.aborted) break
        const tool = subRegistry.find(call.name)
        if (!tool) {
          const msg = `Unknown tool: ${call.name} (not in agent's allowed set)`
          appendMessage(session, makeToolMessage(call.id, { output: msg, isError: true }))
          continue
        }
        const validation = tool.validateInput
          ? tool.validateInput(call.input)
          : validateWithJsonSchema(call.input, tool.parameters)
        if (!validation.ok) {
          appendMessage(
            session,
            makeToolMessage(call.id, { output: `invalid input: ${validation.error}`, isError: true }),
          )
          continue
        }
        const decision = await permission.check({
          toolName: tool.name,
          hint: tool.needsPermission(call.input),
          input: call.input,
          annotations: tool.annotations,
        })
        let result: ToolResult
        if (!decision.allowed) {
          result = { output: `Rejected: ${decision.reason ?? 'user denied'}`, isError: true }
        } else {
          try {
            result = await tool.run(call.input, {
              signal,
              cwd: process.cwd(),
              session,
            })
          } catch (err) {
            result = { output: `tool error: ${(err as Error).message}`, isError: true }
          }
        }
        appendMessage(session, makeToolMessage(call.id, result))
      }
    }

    // Exited loop: either aborted or maxTurns reached.
    if (turns >= maxTurns) {
      return {
        output: lastAssistant ? finalOutput(lastAssistant) : `Sub-agent reached maxTurns=${maxTurns} with no response`,
        isError: true,
        turns,
        usage: totalUsage,
      }
    }
    return {
      output: 'Sub-agent aborted',
      isError: true,
      turns,
      usage: totalUsage,
    }
  } catch (err) {
    return {
      output: `Sub-agent error: ${(err as Error).message}`,
      isError: true,
      turns,
      usage: totalUsage,
    }
  }
}

function finalOutput(assistant: AssistantMessage): string | ToolContentBlock[] {
  // Collect text blocks. message/types.ContentBlock (text|tool_use) is not the
  // same union as tools/content.ContentBlock (text|image|resource), so we map
  // into the tool-result shape: text → text block; any tool_use remnants are
  // stringified to preserve information without importing unrelated fields.
  const allText = assistant.content.every(b => b.type === 'text')
  if (allText) {
    return assistant.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
  }
  const blocks: ToolContentBlock[] = []
  for (const b of assistant.content) {
    if (b.type === 'text') blocks.push({ type: 'text', text: b.text })
    else if (b.type === 'tool_use') {
      blocks.push({ type: 'text', text: `[unfinished tool_use: ${b.name}]` })
    }
  }
  return blocks
}
