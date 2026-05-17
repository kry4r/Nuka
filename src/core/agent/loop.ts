// src/core/agent/loop.ts
import { readFile } from 'node:fs/promises'
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
import { activeToolsForMany } from '../skill/activation'
import { createProgressPump } from './progressPump'
import type { AutoCompactOpts } from '../compact/auto'
import { maybeAutoCompact } from '../compact/auto'
import type { AutoCompactConfig as AutoCompactPureConfig } from './autoCompact'
import { maybeAutoCompact as maybeAutoCompactPure } from './autoCompact'
import { validateWithJsonSchema } from '../tools/validate'
import { serializeContentBlocks } from '../tools/content'
import type { HookEntry } from '../hooks/types'
import { runHooks } from '../hooks/runner'
import type { HookRegistry } from '../hooks/registry'
import {
  firePromptSubmit,
  fireAfterTurn,
  fireAfterAssistantMessage,
  fireBeforeAutoCompact,
  extractReplaceText,
  applyReplaceTextToAssistant,
} from '../hooks/lifecycle'
import { parallelBatch } from '../tools/concurrency'
import type { ToolResult } from '../tools/types'
import { getChannels } from '../notifications/channelRegistry'
import { dispatchToChannels } from '../notifications/channels'
import type { LspManager } from '../lsp/manager'
import type { CostTracker } from '../cost/tracker'
import type { CheckpointLog } from '../rewind/checkpoint'
import { captureFileSnapshot, filePathsFromToolInput } from '../rewind/checkpoint'
import type { EventBus } from '../events/bus'
import { isCoordinatorMode, COORDINATOR_INTERNAL_TOOLS } from './coordinatorMode'
import {
  CronPromptQueue,
  formatCronPrompt,
  isCronPromptInjectionEnabled,
} from '../session/cronPromptQueue'
import type { WorktreeStore } from '../worktree/store'
import { resolveToolCwd } from '../worktree/store'

/**
 * Apply coordinator-mode tool filtering.
 * - Coordinator lead (isWorker=false): only coordinator-internal tools.
 * - Coordinator worker (isWorker=true): strip coordinator-internal tools.
 * - Non-coordinator: identity (no filtering).
 */
export function applyCoordinatorFilter<T extends { name: string }>(tools: T[], session: { isWorker?: boolean }): T[] {
  if (!isCoordinatorMode()) return tools
  if (session.isWorker) return tools.filter(t => !COORDINATOR_INTERNAL_TOOLS.has(t.name))
  return tools.filter(t => COORDINATOR_INTERNAL_TOOLS.has(t.name))
}

/**
 * Iter VVV — gate for the pure auto-compact path.
 *
 * Pure mode is opt-in via either:
 *   1. `deps.autoCompactPure.mode === 'pure'` (explicit config), or
 *   2. `NUKA_AUTOCOMPACT_MODE=pure` in the environment (debugging /
 *      feature-flagged rollout).
 *
 * The legacy session-aware `deps.autoCompact` path is unaffected by this
 * gate — both paths can coexist in config, but only the pure path is
 * conditional. When `autoCompactPure` is absent, the gate is always
 * closed regardless of the env var, preserving backward compatibility.
 */
export function isPureAutoCompactEnabled(deps: Pick<RunAgentDeps, 'autoCompactPure'>): boolean {
  if (!deps.autoCompactPure) return false
  if (deps.autoCompactPure.mode === 'pure') return true
  if (process.env['NUKA_AUTOCOMPACT_MODE'] === 'pure') return true
  return false
}

export type RunAgentDeps = {
  provider: ProviderResolver
  tools: ToolRegistry
  permission: PermissionChecker
  systemPromptInput?: () => Parameters<typeof buildSystemPrompt>[0]
  skills?: Skill[]
  persist?: (session: Session, msg: Message) => void
  autoCompact?: AutoCompactOpts
  /**
   * Iter VVV — opt-in pure-orchestrator auto-compact path. Sibling to
   * `autoCompact` (the legacy session-aware path). When provided AND
   * pure-mode is enabled, the loop calls `maybeAutoCompactPure` after the
   * legacy path on turn-end and swaps `session.messages` if the
   * orchestrator returns a compacted transcript.
   *
   * Pure-mode is enabled when either:
   *   - this `autoCompactPure` field is set, AND
   *   - `mode === 'pure'` (default 'session', which is a no-op for this
   *     new path) OR `NUKA_AUTOCOMPACT_MODE=pure` is set in the environment.
   *
   * The pure path is fully additive: the legacy `autoCompact` path runs
   * unchanged when configured, and the new path is only consulted when
   * explicitly opted into. The two are intentionally independent — pick
   * one or the other depending on whether you want the provider-driven
   * summary (legacy) or the deterministic structural fold (pure).
   */
  autoCompactPure?: {
    mode?: 'session' | 'pure'
    config: AutoCompactPureConfig
  }
  hooks?: HookEntry[]
  /**
   * Practical Iter JJJ — in-process HookRegistry. When provided, the agent
   * loop fires the broader lifecycle events (`promptSubmit`, `afterTurn`,
   * `beforeAutoCompact`) on it. The shell-hook variant in `hooks` is
   * unchanged; the two systems fire side-by-side so existing config-driven
   * hooks keep working while in-process handlers can do their own thing.
   */
  hookRegistry?: HookRegistry
  /** Optional LSP manager for didChange notifications after Write/Edit. */
  lsp?: LspManager
  /**
   * Optional cost tracker. When present, every assistant turn's usage is
   * recorded against `(model, sessionId)` after the message is appended.
   */
  costTracker?: CostTracker
  /**
   * Phase 8 §4.3 — when provided AND `rewind.fileCheckpointing` is enabled
   * in config, file snapshots are captured after each successful
   * Write/Edit tool run. Absent → feature is a no-op (default OFF).
   */
  checkpoint?: {
    log: CheckpointLog
    enabled: boolean
    /**
     * Turn id used to group snapshots. Defaults to the last user message
     * id when not supplied.
     */
    turnId?: () => string
  }
  /** Phase 14 §6.2 — when provided, the loop emits AgentBusEvent
   *  (agent.tool.start / agent.tool.end / agent.usage) for every tool
   *  call and turn-end usage update. */
  bus?: EventBus
  /** Reasoning effort hint forwarded to provider.stream() each turn. */
  effort?: 'low' | 'medium' | 'high'
  /**
   * Practical Iter JJJJ — process-wide cron prompt queue. When provided
   * AND `NUKA_CRON_INJECT_PROMPTS=1` is in the environment, the loop
   * drains the queue at the start of each `runAgent` call and synthesises
   * a user message for every pending cron fire. The prompts land BEFORE
   * the user's `input.text` so the model sees the cron context first,
   * then the user's actual prompt.
   *
   * Drain semantics: at start-of-runAgent only. A cron fire that lands
   * mid-turn waits for the current turn to complete; the next `runAgent`
   * call picks it up. We never inject into a running turn, which keeps
   * the existing provider/tool plumbing untouched.
   *
   * Skill matching and `promptSubmit` hooks fire on the user's input
   * text only (cron prompts are NOT user-typed and don't trigger skills
   * or hooks). The synthesised cron messages are plain `makeUserMessage`
   * entries prefixed with `[CRON ${taskId}]` so any transcript dump can
   * distinguish them without a new message role.
   */
  cronPromptQueue?: CronPromptQueue
  /**
   * P1 #6 — when provided, the loop resolves each tool call's `ctx.cwd`
   * through `resolveToolCwd(worktreeStore, process.cwd())`. EnterWorktree
   * sets the store's active record on success, so subsequent tool calls
   * run inside the worktree dir. ExitWorktree clears the active record
   * (via `remove`) and the cwd reverts to `process.cwd()`.
   *
   * Optional / additive: when absent, behaviour is unchanged (all tool
   * calls see `ctx.cwd === process.cwd()`).
   */
  worktreeStore?: WorktreeStore
}

/**
 * Best-effort snapshot capture for one tool call. Non-blocking from the
 * caller's POV: failures are swallowed so the agent loop is never
 * affected by filesystem hiccups.
 */
function maybeCaptureCheckpoint(
  toolName: string,
  input: unknown,
  isError: boolean,
  session: Session,
  cp: RunAgentDeps['checkpoint'],
): void {
  if (!cp || !cp.enabled) return
  if (isError) return
  const paths = filePathsFromToolInput(toolName, input)
  if (paths.length === 0) return
  const turnId = cp.turnId ? cp.turnId() : lastUserMsgId(session) ?? 'turn'
  for (const p of paths) {
    void captureFileSnapshot(p).then(snap => cp.log.record(turnId, snap), () => {
      /* swallow */
    })
  }
}

function lastUserMsgId(session: Session): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i]
    if (m && m.role === 'user') return m.id
  }
  return undefined
}

/** Tools that modify files and should trigger LSP didChange notifications. */
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit'])

/**
 * After a successful Write or Edit tool run, notify any open LSP trackers
 * about the changed file content. Non-blocking — failures are swallowed.
 */
function maybeNotifyLspChange(
  toolName: string,
  input: unknown,
  isError: boolean,
  lsp: LspManager | undefined,
): void {
  if (!lsp) return
  if (isError) return
  if (!FILE_WRITE_TOOLS.has(toolName)) return

  const inp = input as Record<string, unknown>
  const filePath = typeof inp['path'] === 'string' ? inp['path'] : undefined
  if (!filePath) return

  // For Write, the new content is available in the input directly.
  // For Edit (and others), read the updated file from disk.
  const inlineContent = typeof inp['content'] === 'string' ? inp['content'] : undefined
  if (inlineContent !== undefined) {
    lsp.notifyFileChanged(filePath, inlineContent)
    return
  }

  // Read the file and notify — fire-and-forget
  void readFile(filePath, 'utf8').then(
    newText => lsp.notifyFileChanged(filePath, newText),
    () => { /* file might not exist or not be readable — ignore */ },
  )
}

/**
 * Returns true when ALL calls in the batch can safely run in parallel:
 * - At least 2 calls
 * - Every resolved tool has annotations.readOnly === true
 * - No duplicate tool names UNLESS the tool declares
 *   annotations.parallelSafe === true (e.g. `dispatch_agent`, whose
 *   invocations hold fully isolated sub-sessions)
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
    if (seen.has(call.name) && !tool.annotations.parallelSafe) return false
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
  // Compute matched skills once per runAgent call; used both for system-message
  // injection below and for per-turn tool narrowing inside the while loop.
  const matchedSkills: Skill[] = (deps.skills && deps.skills.length > 0)
    ? matchKeywordSkills(deps.skills, input.text)
    : []

  for (const skill of matchedSkills) {
    appendMessage(session, makeSystemMessage(`[Skill: ${skill.name}]\n\n${skill.body}`), deps.persist)
  }
  // Practical Iter JJJ — fire promptSubmit BEFORE the user message lands on
  // the transcript so handlers can observe the raw input. We don't await
  // mutations yet; future iters may inline `additionalContext` here.
  if (deps.hookRegistry) {
    await firePromptSubmit(
      deps.hookRegistry,
      { sessionId: session.id, text: input.text },
      { signal },
    )
  }
  // Practical Iter JJJJ — drain any pending cron fires BEFORE the user's
  // input lands on the transcript. The cron prompts become synthetic user
  // messages prefixed with `[CRON ${taskId}]` so the model sees them as
  // context before the user's actual input.
  //
  // Opt-in via `NUKA_CRON_INJECT_PROMPTS=1`: when off, the queue is
  // untouched (cron fires still log to stderr but never reach the model).
  // When on, drain is unconditional regardless of queue size — an empty
  // queue is a cheap no-op, and draining ONLY when non-empty would force
  // every caller to peek first.
  //
  // The drain order matches enqueue order (FIFO), so multiple fires in
  // the same tick land in the transcript in the order the scheduler
  // saw them. Skills and the `promptSubmit` hook fire on the user's
  // input only — cron prompts are not user-typed and intentionally do
  // not trigger skill activation, hook handlers, or `unDeferredToolNames`
  // bookkeeping (those concerns belong to the user's prompt).
  if (deps.cronPromptQueue && isCronPromptInjectionEnabled()) {
    const cronEntries = deps.cronPromptQueue.drain()
    for (const entry of cronEntries) {
      appendMessage(
        session,
        makeUserMessage({ text: formatCronPrompt(entry) }),
        deps.persist,
      )
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

    // M2.9 / Phase 11 M2: Filter tool specs by matched skills (activeToolsForMany
    // returns full registry when no skills matched, preserving existing behaviour).
    // On top of narrowing, alwaysLoad tools always pass through; shouldDefer tools
    // are excluded unless already un-deferred via searchHint or manual unlock.
    // Phase 14a: apply coordinator-mode filter (lead vs worker).
    const narrowed = applyCoordinatorFilter(activeToolsForMany(matchedSkills, deps.tools), session)
    const toolSpecs = narrowed.flatMap(tool => {
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
        effort: deps.effort,
      },
      signal,
    )

    const assistant = emptyAssistant()
    for await (const ev of stream) {
      if (ev.type === 'text_delta') yield { type: 'text_delta', text: ev.text }
      applyToAssistant(assistant, ev)
    }
    // P0 #2 — fire afterAssistantMessage BEFORE the message lands on
    // the transcript so handlers may rewrite the text via
    // `{ data: { replaceText: '<new>' } }`. Multi-handler resolution
    // is last-write-wins (each handler reads the ORIGINAL `text`,
    // not a previous handler's replacement). When no handler asks
    // for a rewrite, `extractReplaceText` returns `undefined` and we
    // append the original assembled message untouched.
    //
    // Text is the concatenation of text blocks; tool_use blocks are
    // skipped (handlers care about the model's prose, not the tool
    // argument JSON). The rewrite, when applied, preserves
    // tool_use blocks in place — see `applyReplaceTextToAssistant`.
    if (deps.hookRegistry) {
      const text = assistant.content
        .flatMap(b => (b.type === 'text' ? [b.text] : []))
        .join('')
      const results = await fireAfterAssistantMessage(
        deps.hookRegistry,
        { sessionId: session.id, text },
        { signal },
      )
      const replaceText = extractReplaceText(results)
      if (replaceText !== undefined) {
        applyReplaceTextToAssistant(assistant, replaceText)
      }
    }
    appendMessage(session, assistant, deps.persist)
    if (assistant.usage) {
      session.totalUsage = addUsage(session.totalUsage, assistant.usage)
      // Phase 7 §5.2 — fold this turn's usage into the per-process cost
      // tracker. Cache fields are optional in TokenUsage but must map onto
      // the tracker's Usage shape.
      if (deps.costTracker) {
        deps.costTracker.record(model, session.id, {
          input: assistant.usage.inputTokens,
          output: assistant.usage.outputTokens,
          cacheCreate: assistant.usage.cacheWriteTokens,
          cacheRead: assistant.usage.cacheReadTokens,
        })
      }
      deps.bus?.emit('agent', {
        type: 'agent.usage',
        sessionId: session.id,
        inputTokens: assistant.usage.inputTokens ?? 0,
        outputTokens: assistant.usage.outputTokens ?? 0,
      })
    }

    const calls = extractToolCalls(assistant)
    if (calls.length === 0) {
      yield {
        type: 'turn_end',
        stopReason: assistant.stopReason ?? 'end_turn',
        usage: assistant.usage ?? { inputTokens: 0, outputTokens: 0 },
      }
      // Dispatch turn_end to channels (non-blocking — don't await)
      void dispatchToChannels(getChannels() as import('../notifications/channels').ChannelDef[], {
        type: 'turn_end',
        payload: { stopReason: assistant.stopReason ?? 'end_turn' },
      })
      // afterTurn hook — non-cancelable, swallow failures
      if (deps.hooks && deps.hooks.length > 0) {
        await runHooks(deps.hooks, 'afterTurn', { event: 'afterTurn', stopReason: assistant.stopReason ?? 'end_turn' }, { registry: deps.hookRegistry })
      }
      if (deps.hookRegistry) {
        await fireAfterTurn(
          deps.hookRegistry,
          {
            sessionId: session.id,
            stopReason: assistant.stopReason ?? 'end_turn',
            toolCalls: 0,
          },
          { signal },
        )
      }
      if (deps.autoCompact) {
        // beforeAutoCompact hook — veto cancels compaction
        let skipCompact = false
        if (deps.hooks && deps.hooks.length > 0) {
          const beforeTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
          const veto = await runHooks(deps.hooks, 'beforeAutoCompact', { event: 'beforeAutoCompact', tokensBefore: beforeTokens }, { registry: deps.hookRegistry })
          if (veto.cancel) skipCompact = true
        }
        if (!skipCompact && deps.hookRegistry) {
          const beforeTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
          const veto = await fireBeforeAutoCompact(
            deps.hookRegistry,
            {
              sessionId: session.id,
              tokensBefore: beforeTokens,
              threshold: deps.autoCompact.autoThreshold,
              contextWindow: deps.autoCompact.contextWindow,
            },
            { signal },
          )
          if (veto.skipped) skipCompact = true
        }
        if (!skipCompact) {
          const result = await maybeAutoCompact(session, deps.autoCompact)
          if (result.compacted) {
            yield { type: 'auto_compacted', before: result.before, after: result.after }
          }
        }
      }
      // Iter VVV — pure-orchestrator path. Sibling to the legacy
      // session-aware compaction above. Runs only when explicitly opted
      // into via `deps.autoCompactPure` AND either `mode === 'pure'` is set
      // or `NUKA_AUTOCOMPACT_MODE=pure` is in the environment. Otherwise
      // this block is inert (backward-compat for the legacy session path).
      //
      // The orchestrator handles its own threshold gate, hook veto, and
      // signal abort — we just thread the registry/signal through and
      // swap the transcript in place when it actually compacts. The
      // `hookRegistry` here is the SAME one used by the legacy path's
      // `fireBeforeAutoCompact` call above, so a single user handler
      // covers both code paths (deduplication is the consumer's problem
      // since both modes are opt-in and never run simultaneously in
      // production).
      if (isPureAutoCompactEnabled(deps)) {
        const pure = deps.autoCompactPure!
        const result = await maybeAutoCompactPure(
          session.messages,
          { ...pure.config, sessionId: pure.config.sessionId ?? session.id },
          { hookRegistry: deps.hookRegistry, signal },
        )
        if (result.compacted) {
          // Swap the transcript in place. `appendMessage` replaces the
          // array reference on every append, so reassigning here keeps
          // React/Ink consumers consistent with the rest of the loop.
          session.messages = result.messages
          session.updatedAt = Date.now()
          yield {
            type: 'auto_compacted',
            before: result.before.estimatedTokens,
            after: result.after.estimatedTokens,
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
          const veto = await runHooks(deps.hooks, 'beforeToolCall', { event: 'beforeToolCall', tool: call.name, input: call.input }, { tool: call.name, registry: deps.hookRegistry })
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
          mode: session.mode,
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
            const onProgressTyped = tool.progressType === 'object'
              ? (payload: Record<string, unknown>) => pump.onProgress(JSON.stringify(payload))
              : undefined
            const toolStartedAt = Date.now()
            deps.bus?.emit('agent', {
              type: 'agent.tool.start',
              sessionId: session.id,
              toolName: tool.name,
              input: call.input,
            })
            let toolOk = true
            const toolPromise = tool.run(call.input, {
              signal,
              cwd: resolveToolCwd(deps.worktreeStore, process.cwd()),
              onProgress: pump.onProgress,
              onProgressTyped,
              session,
            }).catch((err: unknown) => {
              toolOk = false
              throw err
            }).finally(() => {
              pump.finish()
              deps.bus?.emit('agent', {
                type: 'agent.tool.end',
                sessionId: session.id,
                toolName: tool.name,
                ok: toolOk,
                durationMs: Date.now() - toolStartedAt,
              })
            })
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
        // Dispatch tool_result to channels (non-blocking)
        void dispatchToChannels(getChannels() as import('../notifications/channels').ChannelDef[], {
          type: 'tool_result',
          payload: { id: call.id, name: call.name, output: outputStr, isError: outcome.result.isError },
        })

        // afterToolCall hook (serial, in input order)
        if (slot.kind === 'approved' && deps.hooks && deps.hooks.length > 0) {
          await runHooks(deps.hooks, 'afterToolCall', { event: 'afterToolCall', tool: call.name, input: call.input, output: outputStr, isError: outcome.result.isError }, { tool: call.name, registry: deps.hookRegistry })
        }

        // LSP didChange notification after Write/Edit (non-blocking)
        if (slot.kind === 'approved') {
          maybeNotifyLspChange(call.name, call.input, outcome.result.isError, deps.lsp)
          maybeCaptureCheckpoint(call.name, call.input, outcome.result.isError, session, deps.checkpoint)
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
          const veto = await runHooks(deps.hooks, 'beforeToolCall', { event: 'beforeToolCall', tool: call.name, input: call.input }, { tool: call.name, registry: deps.hookRegistry })
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
          mode: session.mode,
        })
        let result: ToolResult
        if (hookVetoed) {
          result = { output: `Cancelled by hook: ${hookVetoReason ?? 'hook returned cancel=true'}`, isError: true }
        } else if (!decision.allowed) {
          result = { output: `Rejected: ${decision.reason ?? 'user denied'}`, isError: true }
        } else {
          const pump = createProgressPump()
          const onProgressTyped = tool.progressType === 'object'
            ? (payload: Record<string, unknown>) => pump.onProgress(JSON.stringify(payload))
            : undefined
          const serialToolStartedAt = Date.now()
          deps.bus?.emit('agent', {
            type: 'agent.tool.start',
            sessionId: session.id,
            toolName: tool.name,
            input: call.input,
          })
          let serialToolOk = true
          const toolPromise = tool.run(call.input, {
            signal,
            cwd: resolveToolCwd(deps.worktreeStore, process.cwd()),
            onProgress: pump.onProgress,
            onProgressTyped,
            session,
          }).catch((err: unknown) => {
            serialToolOk = false
            throw err
          }).finally(() => {
            pump.finish()
            deps.bus?.emit('agent', {
              type: 'agent.tool.end',
              sessionId: session.id,
              toolName: tool.name,
              ok: serialToolOk,
              durationMs: Date.now() - serialToolStartedAt,
            })
          })
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
        // Dispatch tool_result to channels (non-blocking)
        void dispatchToChannels(getChannels() as import('../notifications/channels').ChannelDef[], {
          type: 'tool_result',
          payload: { id: call.id, name: call.name, output: outputStr, isError: result.isError },
        })
        // afterToolCall hook — non-cancelable, swallow failures
        if (deps.hooks && deps.hooks.length > 0) {
          await runHooks(deps.hooks, 'afterToolCall', { event: 'afterToolCall', tool: call.name, input: call.input, output: outputStr, isError: result.isError }, { tool: call.name, registry: deps.hookRegistry })
        }

        // LSP didChange notification after Write/Edit (non-blocking)
        if (!hookVetoed && decision.allowed) {
          maybeNotifyLspChange(call.name, call.input, result.isError, deps.lsp)
          maybeCaptureCheckpoint(call.name, call.input, result.isError, session, deps.checkpoint)
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
