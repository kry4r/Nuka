// src/core/agent/loop.ts
import type { Session } from '../session/types'
import type { AgentEvent } from './events'
import type { ProviderEvent } from '../provider/types'
import type { ProviderResolver } from '../provider/resolver'
import type { ToolRegistry } from '../tools/registry'
import type { PermissionChecker } from '../permission/checker'
import { makeUserMessage, makeToolMessage, emptyAssistant, makeSystemMessage } from '../message/factories'
import { buildSystemPrompt } from './systemPrompt'
import { addUsage } from '../session/telemetry'
import { appendMessage } from '../session/session'
import type { AssistantMessage, ContentBlock, Message } from '../message/types'
import type { Skill } from '../skill/types'
import { matchKeywordSkills } from '../skill/activator'
import { createProgressPump } from './progressPump'

export type RunAgentDeps = {
  provider: ProviderResolver
  tools: ToolRegistry
  permission: PermissionChecker
  systemPromptInput?: () => Parameters<typeof buildSystemPrompt>[0]
  skills?: Skill[]
  persist?: (session: Session, msg: Message) => void
}

function extractToolCalls(m: AssistantMessage): Array<{ id: string; name: string; input: unknown }> {
  return m.content.flatMap(b =>
    b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
  )
}

function applyToAssistant(m: AssistantMessage, ev: ProviderEvent): void {
  if (ev.type === 'text_delta') {
    const last = m.content[m.content.length - 1]
    if (last && last.type === 'text') last.text += ev.text
    else m.content.push({ type: 'text', text: ev.text } as ContentBlock)
  } else if (ev.type === 'tool_use_start') {
    m.content.push({ type: 'tool_use', id: ev.id, name: ev.name, input: {} })
  } else if (ev.type === 'tool_use_stop') {
    for (let i = m.content.length - 1; i >= 0; i--) {
      const b = m.content[i]
      if (!b) continue
      if (b.type === 'tool_use' && b.id === ev.id) { b.input = ev.input; break }
    }
  } else if (ev.type === 'message_stop') {
    m.usage = ev.usage
    m.stopReason = ev.stopReason
  }
}

export async function* runAgent(
  input: { text: string },
  session: Session,
  deps: RunAgentDeps,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  if (deps.skills && deps.skills.length > 0) {
    const matched = matchKeywordSkills(deps.skills, input.text)
    for (const skill of matched) {
      appendMessage(session, makeSystemMessage(`[Skill: ${skill.name}]\n\n${skill.body}`), deps.persist)
    }
  }
  appendMessage(session, makeUserMessage(input), deps.persist)

  while (!signal.aborted) {
    const { provider, model } = deps.provider.resolveFor(session)
    const system = deps.systemPromptInput
      ? buildSystemPrompt(deps.systemPromptInput())
      : ''
    const stream = provider.stream(
      {
        model,
        system,
        messages: session.messages,
        tools: deps.tools.listSpecs(),
      },
      signal,
    )

    const assistant = emptyAssistant()
    for await (const ev of stream) {
      if (ev.type === 'text_delta') yield { type: 'text_delta', text: ev.text }
      applyToAssistant(assistant, ev)
    }
    appendMessage(session, assistant, deps.persist)
    if (assistant.usage) session.totalUsage = addUsage(session.totalUsage, assistant.usage)

    const calls = extractToolCalls(assistant)
    if (calls.length === 0) {
      yield {
        type: 'turn_end',
        stopReason: assistant.stopReason ?? 'end_turn',
        usage: assistant.usage ?? { inputTokens: 0, outputTokens: 0 },
      }
      break
    }

    for (const call of calls) {
      if (signal.aborted) break
      const tool = deps.tools.find(call.name)
      if (!tool) {
        yield { type: 'tool_result', id: call.id, output: `Unknown tool: ${call.name}`, isError: true }
        appendMessage(session, makeToolMessage(call.id, { output: `Unknown tool: ${call.name}`, isError: true }), deps.persist)
        continue
      }
      yield { type: 'tool_call', id: call.id, name: call.name, input: call.input }
      const decision = await deps.permission.check({
        toolName: tool.name,
        hint: tool.needsPermission(call.input),
        input: call.input,
      })
      let result: { output: string; isError: boolean }
      if (!decision.allowed) {
        result = { output: `Rejected: ${decision.reason ?? 'user denied'}`, isError: true }
      } else {
        const pump = createProgressPump()
        const toolPromise = tool.run(call.input, {
          signal,
          cwd: process.cwd(),
          onProgress: pump.onProgress,
        }).finally(pump.finish)
        for await (const msg of pump.drain()) {
          yield { type: 'tool_progress', id: call.id, text: msg }
        }
        result = await toolPromise
      }
      appendMessage(session, makeToolMessage(call.id, result), deps.persist)
      yield { type: 'tool_result', id: call.id, output: result.output, isError: result.isError }
    }

    const drained = session.queue.drain()
    if (drained.length > 0) {
      appendMessage(session, makeUserMessage({ text: drained.join('\n\n') }), deps.persist)
      yield { type: 'queued_message_flushed', count: drained.length }
    }
  }
}
