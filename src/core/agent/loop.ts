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
import type { AutoCompactOpts } from '../compact/auto'
import { maybeAutoCompact } from '../compact/auto'
import { validateWithJsonSchema } from '../tools/validate'
import { serializeContentBlocks } from '../tools/content'
import type { HookEntry } from '../hooks/types'
import { runHooks } from '../hooks/runner'
import { parallelBatch } from '../tools/concurrency'
import type { ToolResult } from '../tools/types'

export type RunAgentDeps = {
  provider: ProviderResolver
  tools: ToolRegistry
  permission: PermissionChecker
  systemPromptInput?: () => Parameters<typeof buildSystemPrompt>[0]
  skills?: Skill[]
  persist?: (session: Session, msg: Message) => void
  autoCompact?: AutoCompactOpts
  hooks?: HookEntry[]
}

/**
 * Returns true when ALL calls in the batch can safely run in parallel:
 * - At least 2 calls
 * - Every resolved tool has annotations.readOnly === true
 * - No duplicate tool names
 * - Every tool name is found in the registry
 */
function canParallelize(
  calls: Array<{ id: string; name: string; input: unknown }>,
  registry: ToolRegistry,
): boolean {
  if (calls.length < 2) return false
  const seen = new Set<string>()
  for (const call of calls) {
    const tool = registry.find(call.name)
    if (!tool) return false
    if (!tool.annotations?.readOnly) return false
    if (seen.has(call.name)) return false
    seen.add(call.name)
  }
  return true
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

  // M2.9: Un-defer tools whose searchHint keywords appear in the first user message.
  // Matching happens once (on this message) and the result persists for the session.
  for (const tool of deps.tools.list()) {
    if (tool.searchHint && tool.searchHint.length > 0) {
      const lowerText = input.text.toLowerCase()
      const matches = tool.searchHint.some(hint => lowerText.includes(hint.toLowerCase()))
      if (matches) {
        session.unDeferredToolNames.add(tool.name)
      }
    }
  }

  while (!signal.aborted) {
    const { provider, model } = deps.provider.resolveFor(session)
    const system = deps.systemPromptInput
      ? buildSystemPrompt(deps.systemPromptInput())
      : ''

    // M2.9: Filter tool specs: alwaysLoad tools always included; shouldDefer
    // tools excluded unless already un-deferred via searchHint or manual unlock.
    const toolSpecs = deps.tools.list().flatMap(tool => {
      if (tool.alwaysLoad) return [{ name: tool.name, description: tool.description, parameters: tool.parameters }]
      if (tool.shouldDefer?.(input)) {
        if (!session.unDeferredToolNames.has(tool.name)) return []
      }
      return [{ name: tool.name, description: tool.description, parameters: tool.parameters }]
    })

    const stream = provider.stream(
      {
        model,
        system,
        messages: session.messages,
        tools: toolSpecs,
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
      // afterTurn hook — non-cancelable, swallow failures
      if (deps.hooks && deps.hooks.length > 0) {
        await runHooks(deps.hooks, 'afterTurn', { event: 'afterTurn', stopReason: assistant.stopReason ?? 'end_turn' })
      }
      if (deps.autoCompact) {
        // beforeAutoCompact hook — veto cancels compaction
        let skipCompact = false
        if (deps.hooks && deps.hooks.length > 0) {
          const beforeTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
          const veto = await runHooks(deps.hooks, 'beforeAutoCompact', { event: 'beforeAutoCompact', tokensBefore: beforeTokens })
          if (veto.cancel) skipCompact = true
        }
        if (!skipCompact) {
          const result = await maybeAutoCompact(session, deps.autoCompact)
          if (result.compacted) {
            yield { type: 'auto_compacted', before: result.before, after: result.after }
          }
        }
      }
      break
    }

    if (canParallelize(calls, deps.tools)) {
      // ── Parallel path ─────────────────────────────────────────────────────
      // Strategy: resolve permissions SERIALLY before dispatch (no stacking
      // dialogs), run approved calls in parallel (max 4), buffer per-call
      // progress events, emit everything in INPUT ORDER after all complete.

      type PreflightSlot =
        | { kind: 'invalid'; result: ToolResult }
        | { kind: 'vetoed'; result: ToolResult }
        | { kind: 'denied'; result: ToolResult }
        | { kind: 'approved'; tool: ReturnType<ToolRegistry['find']> & object }

      const preflight: PreflightSlot[] = []

      for (const call of calls) {
        // Tools are guaranteed to exist (canParallelize verified them)
        const tool = deps.tools.find(call.name)!

        // Validate input
        const validation = tool.validateInput
          ? tool.validateInput(call.input)
          : validateWithJsonSchema(call.input, tool.parameters)
        if (!validation.ok) {
          preflight.push({ kind: 'invalid', result: { output: `invalid input: ${validation.error}`, isError: true } })
          continue
        }

        // beforeToolCall hook (serial)
        let hookVetoed = false
        let hookVetoReason: string | undefined
        if (deps.hooks && deps.hooks.length > 0) {
          const veto = await runHooks(deps.hooks, 'beforeToolCall', { event: 'beforeToolCall', tool: call.name, input: call.input }, { tool: call.name })
          if (veto.cancel) {
            hookVetoed = true
            hookVetoReason = veto.reason
          }
        }
        if (hookVetoed) {
          preflight.push({ kind: 'vetoed', result: { output: `Cancelled by hook: ${hookVetoReason ?? 'hook returned cancel=true'}`, isError: true } })
          continue
        }

        // Permission check (serial)
        const decision = await deps.permission.check({
          toolName: tool.name,
          hint: tool.needsPermission(call.input),
          input: call.input,
          annotations: tool.annotations,
        })
        if (!decision.allowed) {
          preflight.push({ kind: 'denied', result: { output: `Rejected: ${decision.reason ?? 'user denied'}`, isError: true } })
          continue
        }

        preflight.push({ kind: 'approved', tool })
      }

      // Collect progress + result for each approved slot in parallel
      type SlotOutcome = { result: ToolResult; progress: string[] }
      const outcomes: SlotOutcome[] = new Array(calls.length)

      // Map approved indices for parallelBatch
      const approvedIndices: number[] = []
      for (let i = 0; i < preflight.length; i++) {
        if (preflight[i]!.kind === 'approved') approvedIndices.push(i)
      }

      if (approvedIndices.length > 0) {
        await parallelBatch(
          approvedIndices,
          async (idx) => {
            const call = calls[idx]!
            const slot = preflight[idx] as { kind: 'approved'; tool: NonNullable<ReturnType<ToolRegistry['find']>> }
            const tool = slot.tool
            const progressLines: string[] = []
            const pump = createProgressPump()
            const toolPromise = tool.run(call.input, {
              signal,
              cwd: process.cwd(),
              onProgress: pump.onProgress,
            }).finally(pump.finish)
            // Drain pump into local buffer concurrently with tool execution
            const drainPromise = (async () => {
              for await (const msg of pump.drain()) progressLines.push(msg)
            })()
            let result = await toolPromise
            await drainPromise
            // Apply per-tool result size cap
            if (
              tool.maxResultSizeChars !== undefined &&
              typeof result.output === 'string' &&
              result.output.length > tool.maxResultSizeChars
            ) {
              const truncated = result.output.length - tool.maxResultSizeChars
              result = {
                output: result.output.slice(0, tool.maxResultSizeChars) + `...[truncated ${truncated} chars]...`,
                isError: result.isError,
              }
            }
            outcomes[idx] = { result, progress: progressLines }
          },
          4, // max concurrency
        )
      }

      // Fill non-approved slots with their error results
      for (let i = 0; i < calls.length; i++) {
        const slot = preflight[i]!
        if (slot.kind !== 'approved') {
          outcomes[i] = { result: slot.result, progress: [] }
        }
      }

      // Emit all events in INPUT ORDER
      for (let i = 0; i < calls.length; i++) {
        if (signal.aborted) break
        const call = calls[i]!
        const slot = preflight[i]!
        const outcome = outcomes[i]!

        // Emit tool_call for all (including invalids/denials? No — match serial behavior)
        // Serial path emits tool_call only for valid+approved calls. Invalids skip it.
        if (slot.kind !== 'invalid') {
          yield { type: 'tool_call', id: call.id, name: call.name, input: call.input }
        }

        // Progress events (only for approved, run calls)
        for (const msg of outcome.progress) {
          yield { type: 'tool_progress', id: call.id, text: msg }
        }

        appendMessage(session, makeToolMessage(call.id, outcome.result), deps.persist)
        const outputStr = typeof outcome.result.output === 'string'
          ? outcome.result.output
          : serializeContentBlocks(outcome.result.output)
        yield { type: 'tool_result', id: call.id, output: outputStr, isError: outcome.result.isError }

        // afterToolCall hook (serial, in input order)
        if (slot.kind === 'approved' && deps.hooks && deps.hooks.length > 0) {
          await runHooks(deps.hooks, 'afterToolCall', { event: 'afterToolCall', tool: call.name, input: call.input, output: outputStr, isError: outcome.result.isError }, { tool: call.name })
        }
      }
    } else {
      // ── Serial path (original) ─────────────────────────────────────────────
      for (const call of calls) {
        if (signal.aborted) break
        const tool = deps.tools.find(call.name)
        if (!tool) {
          yield { type: 'tool_result', id: call.id, output: `Unknown tool: ${call.name}`, isError: true }
          appendMessage(session, makeToolMessage(call.id, { output: `Unknown tool: ${call.name}`, isError: true }), deps.persist)
          continue
        }
        // Validate input before permission prompt
        const validation = tool.validateInput
          ? tool.validateInput(call.input)
          : validateWithJsonSchema(call.input, tool.parameters)
        if (!validation.ok) {
          const result = { output: `invalid input: ${validation.error}`, isError: true }
          appendMessage(session, makeToolMessage(call.id, result), deps.persist)
          yield { type: 'tool_result', id: call.id, output: result.output, isError: true }
          continue
        }

        yield { type: 'tool_call', id: call.id, name: call.name, input: call.input }
        // beforeToolCall hook — veto skips tool execution
        let hookVetoed = false
        let hookVetoReason: string | undefined
        if (deps.hooks && deps.hooks.length > 0) {
          const veto = await runHooks(deps.hooks, 'beforeToolCall', { event: 'beforeToolCall', tool: call.name, input: call.input }, { tool: call.name })
          if (veto.cancel) {
            hookVetoed = true
            hookVetoReason = veto.reason
          }
        }
        const decision = await deps.permission.check({
          toolName: tool.name,
          hint: tool.needsPermission(call.input),
          input: call.input,
          annotations: tool.annotations,
        })
        let result: ToolResult
        if (hookVetoed) {
          result = { output: `Cancelled by hook: ${hookVetoReason ?? 'hook returned cancel=true'}`, isError: true }
        } else if (!decision.allowed) {
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
          // Apply per-tool result size cap (string output only; ContentBlock[] left alone)
          if (
            tool.maxResultSizeChars !== undefined &&
            typeof result.output === 'string' &&
            result.output.length > tool.maxResultSizeChars
          ) {
            const truncated = result.output.length - tool.maxResultSizeChars
            result = {
              output: result.output.slice(0, tool.maxResultSizeChars) + `...[truncated ${truncated} chars]...`,
              isError: result.isError,
            }
          }
        }
        appendMessage(session, makeToolMessage(call.id, result), deps.persist)
        // tool_result event payload must be string (UI requirement)
        const outputStr = typeof result.output === 'string'
          ? result.output
          : serializeContentBlocks(result.output)
        yield { type: 'tool_result', id: call.id, output: outputStr, isError: result.isError }
        // afterToolCall hook — non-cancelable, swallow failures
        if (deps.hooks && deps.hooks.length > 0) {
          await runHooks(deps.hooks, 'afterToolCall', { event: 'afterToolCall', tool: call.name, input: call.input, output: outputStr, isError: result.isError }, { tool: call.name })
        }
      }
    }

    const drained = session.queue.drain()
    if (drained.length > 0) {
      appendMessage(session, makeUserMessage({ text: drained.join('\n\n') }), deps.persist)
      yield { type: 'queued_message_flushed', count: drained.length }
    }
  }
}
