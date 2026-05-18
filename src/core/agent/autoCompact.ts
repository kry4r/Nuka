// src/core/agent/autoCompact.ts
//
// Auto-compact orchestrator. The pure planner that decides *whether* and
// *how* to shrink a transcript before the next provider call. Token budget
// triggers (estimated, not API-accurate), the in-process `beforeAutoCompact`
// hook can veto, and the actual rewriting is structural: preserve system
// messages + the trailing `preserveRecent` window, fold the older middle into
// a single summary message (placeholder or caller-supplied summarizer).
//
// Sibling to (but intentionally distinct from) `src/core/compact/auto.ts`:
//   - `compact/auto.ts` is *Session-aware* — reads `session.totalUsage`,
//     drives a provider stream for the summary, and mutates `session.messages`
//     in place. It is the live agent-loop consumer.
//   - This file is *pure*. No Session, no Provider, no I/O. Takes a
//     `Message[]` + a config and returns the new `Message[]` plus stats.
//     The agent loop integration is a separate iter — landing this without
//     wiring lets us test the algorithm in isolation and keeps the loop
//     diff minimal when we do wire it.
//
// The hook wiring matches the JJJ pattern: `fireBeforeAutoCompact` is the
// single source of truth for veto semantics. If any registered handler
// returns `{ skip: true }`, this orchestrator returns
// `{ compacted: false, reason: 'vetoed-by-hook' }` and the caller is
// expected to honour it.

import type { Message, SystemMessage } from '../message/types'
import { roughTokenCountEstimationForMessages } from '../tokens/estimate'
import { fireBeforeAutoCompact } from '../hooks/lifecycle'
import type { HookRegistry } from '../hooks/registry'

/**
 * Configuration for {@link maybeAutoCompact}.
 *
 * Token thresholds are estimates produced by
 * `roughTokenCountEstimationForMessages` — the same heuristic the rest of
 * the agent uses for budget gauges. The orchestrator never calls a provider
 * to get a true count; the caller can override the summarizer if they want
 * a higher-fidelity reduction.
 */
export interface AutoCompactConfig {
  /** Trigger compaction when estimated tokens exceed this value. */
  triggerTokens: number
  /** Target tokens after compaction. Iterative pruning stops once met. */
  targetTokens: number
  /**
   * Minimum number of trailing messages to always keep verbatim. The most
   * recent N messages are never folded into the summary, regardless of
   * token pressure. Default 6.
   */
  preserveRecent?: number
  /**
   * Pluggable summarizer for the dropped middle segment. Receives the
   * messages that are about to be folded and returns the text of a single
   * synthetic summary message inserted in their place. If omitted, a
   * deterministic placeholder is used (no I/O, safe for pure tests).
   */
  summarize?: (messages: Message[]) => Promise<string>
  /**
   * For the placeholder path only: optional session identifier used by the
   * agent loop for the hook payload. Default `'orchestrator'`. Unused when
   * `hookRegistry` is absent.
   */
  sessionId?: string
}

/**
 * Outcome of a single orchestrator pass.
 *
 * `compacted: false` is *not* an error — it's the normal answer below the
 * trigger threshold and when a hook vetoes the operation. `reason` is
 * always populated when `compacted` is false.
 */
export interface AutoCompactResult {
  /** Did the orchestrator rewrite the transcript? */
  compacted: boolean
  /** Why not, when `compacted` is false. */
  reason?: 'below-threshold' | 'vetoed-by-hook' | 'nothing-to-compact'
  /** Counts measured before any rewrite. */
  before: { messageCount: number; estimatedTokens: number }
  /** Counts measured against the returned `messages`. */
  after: { messageCount: number; estimatedTokens: number }
  /**
   * The resulting message list. Identical reference as the input when no
   * compaction happened; a new array otherwise. Callers can swap it in
   * directly: the orchestrator never mutates the input.
   */
  messages: Message[]
}

/**
 * Default trailing-message preservation window. Six is generous enough to
 * keep a couple of user/assistant pairs plus any in-flight tool exchange;
 * smaller windows risk dropping context the model is actively reasoning
 * about.
 */
export const DEFAULT_PRESERVE_RECENT = 6

const PLACEHOLDER_PREFIX = '[Compacted'

/**
 * Plan and (if appropriate) execute a compaction pass.
 *
 * Decision tree:
 *  1. Estimate tokens. If `<= triggerTokens`, return below-threshold.
 *  2. Fire `beforeAutoCompact` (if a registry is provided). If any handler
 *     vetoes, return vetoed-by-hook.
 *  3. Compute the foldable middle: everything that is *not* a system message
 *     and *not* among the last `preserveRecent` messages.
 *  4. If the middle is empty (e.g. only system messages + trailing window),
 *     return nothing-to-compact.
 *  5. Produce a single synthetic summary message via `config.summarize` (if
 *     provided) or the placeholder. Insert it where the middle started.
 *  6. If still over `targetTokens`, drop additional non-system messages from
 *     the front of the preserved tail until either we're under target or
 *     only the system messages + the absolute most-recent message remain.
 *
 * The orchestrator never throws on user-data errors: a summarizer that
 * rejects propagates (caller decides), but malformed messages are silently
 * passed through token estimation.
 */
export async function maybeAutoCompact(
  messages: readonly Message[],
  config: AutoCompactConfig,
  deps: { hookRegistry?: HookRegistry; signal?: AbortSignal } = {},
): Promise<AutoCompactResult> {
  const beforeTokens = roughTokenCountEstimationForMessages(messages)
  const beforeStats = {
    messageCount: messages.length,
    estimatedTokens: beforeTokens,
  }

  // Step 1 — threshold gate.
  if (beforeTokens <= config.triggerTokens) {
    return {
      compacted: false,
      reason: 'below-threshold',
      before: beforeStats,
      after: beforeStats,
      messages: [...messages],
    }
  }

  // Step 2 — hook veto. Pure when no registry is supplied.
  if (deps.hookRegistry) {
    const veto = await fireBeforeAutoCompact(
      deps.hookRegistry,
      {
        sessionId: config.sessionId ?? 'orchestrator',
        tokensBefore: beforeTokens,
        threshold: config.triggerTokens,
        contextWindow: config.targetTokens,
      },
      { signal: deps.signal },
    )
    if (veto.skipped) {
      return {
        compacted: false,
        reason: 'vetoed-by-hook',
        before: beforeStats,
        after: beforeStats,
        messages: [...messages],
      }
    }
  }

  // Honour abort signals raised between the hook fire and the rewrite.
  if (deps.signal?.aborted) {
    return {
      compacted: false,
      reason: 'vetoed-by-hook',
      before: beforeStats,
      after: beforeStats,
      messages: [...messages],
    }
  }

  // Step 3 — partition into [system | middle | tail].
  const preserveRecent = Math.max(0, config.preserveRecent ?? DEFAULT_PRESERVE_RECENT)
  const partition = partitionForCompaction(messages, preserveRecent)

  // Step 4 — nothing to fold? Bail honestly.
  if (partition.middle.length === 0) {
    return {
      compacted: false,
      reason: 'nothing-to-compact',
      before: beforeStats,
      after: beforeStats,
      messages: [...messages],
    }
  }

  // Step 5 — produce the summary and assemble the new transcript.
  const summaryText = await produceSummaryText(partition.middle, config)
  // Abort can land between the summarizer awaiting and us applying the result.
  if (deps.signal?.aborted) {
    return {
      compacted: false,
      reason: 'vetoed-by-hook',
      before: beforeStats,
      after: beforeStats,
      messages: [...messages],
    }
  }
  const summary: SystemMessage = {
    role: 'system',
    content: summaryText,
  }

  let next: Message[] = [...partition.systems, summary, ...partition.tail]

  // Step 6 — iterative pruning if we're still over budget. Drop from the
  // front of `tail` (oldest non-preserved message first) until either we
  // meet the target or the tail collapses to a single message. We never
  // touch the system messages or the synthetic summary in this loop.
  let afterTokens = roughTokenCountEstimationForMessages(next)
  while (afterTokens > config.targetTokens && partition.tail.length > 1) {
    if (deps.signal?.aborted) break
    partition.tail.shift()
    next = [...partition.systems, summary, ...partition.tail]
    afterTokens = roughTokenCountEstimationForMessages(next)
  }

  return {
    compacted: true,
    before: beforeStats,
    after: {
      messageCount: next.length,
      estimatedTokens: afterTokens,
    },
    messages: next,
  }
}

import type { Session } from '../session/types'

/**
 * Session-aware options that mirror the legacy `AutoCompactOpts` shape so
 * call sites can migrate with a one-line type swap. Internally this is
 * folded down to the pure `AutoCompactConfig`.
 *
 * - `autoThreshold` * `contextWindow` defines the trigger boundary
 *   measured against `session.totalUsage.inputTokens + outputTokens`.
 *   Below the boundary, no compaction happens.
 * - `targetTokens` is the pure-orchestrator's iterative-prune target
 *   AFTER the fold. Defaults to `contextWindow * (autoThreshold * 0.5)`
 *   when omitted — half of the trigger, matching the legacy "keepTurns"
 *   intuition of "shrink well below threshold so we don't immediately
 *   re-compact on the next turn".
 */
export interface AutoCompactSessionAwareOpts {
  autoThreshold: number
  contextWindow: number
  targetTokens?: number
  preserveRecent?: number
  summarize?: (messages: Message[]) => Promise<string>
}

/** Result of a session-aware compaction pass. */
export interface CompactSessionAwareResult {
  compacted: boolean
  before: number
  after: number
  reason?: 'below-threshold' | 'vetoed-by-hook' | 'nothing-to-compact'
}

/**
 * Session-aware wrapper around {@link maybeAutoCompact}. The single
 * production entry point for auto-compaction after the 2026-05-18
 * unification. Reads the trigger from `session.totalUsage`, delegates
 * the structural fold to the pure orchestrator, and writes the
 * resulting `messages` + `updatedAt` back onto the session in place.
 *
 * Mutates `session.messages` and `session.updatedAt` only when the
 * orchestrator returns `compacted: true`. `session.totalUsage` is left
 * unchanged on purpose: the StatusBar / CostBar reads cumulative usage
 * from it, and the next provider call's `inputTokens` will reflect the
 * shorter prompt automatically (this matches the legacy
 * `compact/auto.ts` semantics, which were correct).
 */
export async function compactSessionAware(
  session: Session,
  opts: AutoCompactSessionAwareOpts,
  deps: { hookRegistry?: HookRegistry; signal?: AbortSignal } = {},
): Promise<CompactSessionAwareResult> {
  const usageTokens = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const trigger = Math.floor(opts.contextWindow * opts.autoThreshold)
  if (usageTokens <= trigger) {
    return {
      compacted: false,
      reason: 'below-threshold',
      before: usageTokens,
      after: usageTokens,
    }
  }

  const target = opts.targetTokens ?? Math.floor(opts.contextWindow * opts.autoThreshold * 0.5)
  const config: AutoCompactConfig = {
    // Set triggerTokens to 0 so the pure orchestrator always proceeds —
    // the usage-based threshold check above already made the "should compact"
    // decision. The pure orchestrator still guards via hook veto, abort
    // signal, and nothing-to-compact, but not the threshold gate again.
    triggerTokens: 0,
    targetTokens: target,
    sessionId: session.id,
  }
  if (opts.preserveRecent !== undefined) config.preserveRecent = opts.preserveRecent
  if (opts.summarize) config.summarize = opts.summarize

  const result = await maybeAutoCompact(session.messages, config, deps)
  if (!result.compacted) {
    return {
      compacted: false,
      reason: result.reason,
      before: usageTokens,
      after: usageTokens,
    }
  }

  // Swap the transcript in place. `appendMessage` replaces the array
  // reference on every append, so assigning here keeps React/Ink
  // consumers consistent with the rest of the loop.
  session.messages = result.messages
  session.updatedAt = Date.now()

  return {
    compacted: true,
    before: result.before.estimatedTokens,
    after: result.after.estimatedTokens,
  }
}

type CompactionPartition = {
  systems: Message[]
  middle: Message[]
  tail: Message[]
}

/**
 * Split the transcript into the three buckets the algorithm operates on.
 *
 * - `systems` — every `role: 'system'` message, in original order. These
 *   are *always* preserved regardless of position; system prompts are too
 *   load-bearing to fold.
 * - `tail` — the last `preserveRecent` non-system messages.
 * - `middle` — everything else (older non-system messages eligible for
 *   folding).
 *
 * The implementation does a single pass + a slice so the cost is O(n).
 */
function partitionForCompaction(
  messages: readonly Message[],
  preserveRecent: number,
): CompactionPartition {
  const systems: Message[] = []
  const nonSystem: Message[] = []
  for (const m of messages) {
    if (m.role === 'system') systems.push(m)
    else nonSystem.push(m)
  }
  const cut = Math.max(0, nonSystem.length - preserveRecent)
  const middle = nonSystem.slice(0, cut)
  const tail = nonSystem.slice(cut)
  return { systems, middle, tail }
}

/**
 * Run the caller's summarizer (if any) or fall back to the placeholder.
 *
 * The placeholder includes the count of folded messages and the estimated
 * token cost — enough for downstream rendering or telemetry to surface the
 * compaction without re-walking the original transcript.
 */
async function produceSummaryText(
  middle: Message[],
  config: AutoCompactConfig,
): Promise<string> {
  if (config.summarize) {
    return config.summarize(middle)
  }
  const droppedTokens = roughTokenCountEstimationForMessages(middle)
  return `${PLACEHOLDER_PREFIX} ${middle.length} messages, ~${droppedTokens} tokens]`
}
