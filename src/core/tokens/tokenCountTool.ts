// src/core/tokens/tokenCountTool.ts
//
// TokenCountTool — agent-facing tool wrapping the pure `estimate.ts`
// helpers into a single discriminated-action surface for self-monitoring
// of token usage and context budget.
//
// Why a tool? `estimate.ts` is pure library code (string/messages →
// integer token estimate). The existing `EstimateTokensTool` already
// covers single-string sizing, but the agent also needs:
//
//   1. A "count this transcript" surface that walks `Message[]` and
//      gets the same number the auto-compact path uses.
//   2. A "given used/total, what's my budget" surface, so the agent
//      can self-decide whether to summarise / spawn a subagent /
//      offload work, without having to hand-roll percentages.
//
// One Tool with `action`, not three narrow ones: same trade-off as
// TextStatsTool / WhitespaceTool. The three actions share the same
// domain (token integers) and a stable output channel (JSON-stringified
// payloads the agent can re-parse).
//
// Important: this tool is **heuristic-only**. The library underneath is
// a byte-ratio estimator (~4 chars/token, 2 for JSON). It does not call
// a real tokenizer or hit any API. The estimate matches what the
// harness internally believes for its budget gauge, so an explicit call
// here will not disagree with the harness about size. For provider-
// accurate counts the caller must use the provider's countTokens
// endpoint directly — out of scope for this tool.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'count'    requires `text`              optional `fileExtension`
//   action: 'estimate' requires `messages`
//   action: 'budget'   requires `used`, `total`
//
// Output: each action returns a tagged structured payload (see
// TokenCountToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import type { Message } from '../message/types'
import {
  DEFAULT_BYTES_PER_TOKEN,
  bytesPerTokenForFileType,
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from './estimate'

export const TOKEN_COUNT_TOOL_NAME = 'TokenCount'

/** Allowed `action` discriminator values. */
export type TokenCountAction = 'count' | 'estimate' | 'budget'

export type TokenCountToolInput = {
  action: TokenCountAction
  /** Required for action='count'. */
  text?: string
  /**
   * action='count': optional file extension (with or without a leading
   * dot). When supplied, swaps in the higher-density ratio for known
   * formats (json/jsonl/jsonc → 2 bytes/token).
   */
  fileExtension?: string
  /** Required for action='estimate'. */
  messages?: readonly Message[]
  /** Required for action='budget'. Tokens already consumed. */
  used?: number
  /** Required for action='budget'. Total tokens allowed in the window. */
  total?: number
}

/** Tagged result payload per action. */
export type TokenCountToolResult =
  | {
      action: 'count'
      tokens: number
      chars: number
      bytesPerToken: number
      fileExtension?: string
    }
  | {
      action: 'estimate'
      tokens: number
      messageCount: number
    }
  | {
      action: 'budget'
      used: number
      total: number
      remaining: number
      fractionUsed: number
      fractionRemaining: number
    }

const VALID_ACTIONS: ReadonlySet<TokenCountAction> = new Set([
  'count',
  'estimate',
  'budget',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `TokenCount: ${msg}` }
}

/**
 * Validate that `value` is a finite non-negative number. Returns the
 * narrowed number or a structured error.
 */
function requireNonNegativeNumber(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite number (got ${String(value)}).`,
    }
  }
  if (value < 0) {
    return {
      ok: false,
      error: `'${field}' must be non-negative (got ${value}).`,
    }
  }
  return { ok: true, value }
}

/**
 * Validate that `value` is a finite positive number (> 0). Returns the
 * narrowed number or a structured error.
 */
function requirePositiveNumber(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite number (got ${String(value)}).`,
    }
  }
  if (value <= 0) {
    return {
      ok: false,
      error: `'${field}' must be positive (got ${value}).`,
    }
  }
  return { ok: true, value }
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, option ranges)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runTokenCountTool(
  input: TokenCountToolInput,
): TokenCountToolResult {
  switch (input.action) {
    case 'count': {
      const text = input.text ?? ''
      const ext = input.fileExtension?.trim() || ''
      const ratio = ext
        ? bytesPerTokenForFileType(ext)
        : DEFAULT_BYTES_PER_TOKEN
      const tokens = roughTokenCountEstimation(text, ratio)
      const result: TokenCountToolResult = {
        action: 'count',
        tokens,
        chars: text.length,
        bytesPerToken: ratio,
      }
      if (ext) {
        result.fileExtension = ext.replace(/^\./, '').toLowerCase()
      }
      return result
    }
    case 'estimate': {
      const messages = input.messages ?? []
      const tokens = roughTokenCountEstimationForMessages(messages)
      return {
        action: 'estimate',
        tokens,
        messageCount: messages.length,
      }
    }
    case 'budget': {
      const used = input.used ?? 0
      const total = input.total ?? 0
      const remaining = Math.max(0, total - used)
      // total > 0 is enforced upstream; guard for divide-by-zero anyway
      // so the function is total-safe for direct callers.
      const fractionUsed = total > 0 ? used / total : 0
      const fractionRemaining = total > 0 ? remaining / total : 0
      return {
        action: 'budget',
        used,
        total,
        remaining,
        fractionUsed,
        fractionRemaining,
      }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Light structural sanity check on a candidate `Message[]`. We do not
 * fully validate the union here — `roughTokenCountEstimationForMessages`
 * is total over the declared union, but a caller can pass anything from
 * JSON-land. We just confirm it's an array of objects with a known
 * `role`; field-level shape errors fall through to the estimator
 * (text fields default to empty, image cost is fixed).
 */
function looksLikeMessages(value: unknown): value is Message[] {
  if (!Array.isArray(value)) return false
  for (const m of value) {
    if (m == null || typeof m !== 'object') return false
    const role = (m as { role?: unknown }).role
    if (
      role !== 'user' &&
      role !== 'assistant' &&
      role !== 'tool' &&
      role !== 'system'
    ) {
      return false
    }
  }
  return true
}

export const TokenCountTool: Tool<TokenCountToolInput> =
  defineTool<TokenCountToolInput>({
    name: TOKEN_COUNT_TOOL_NAME,
    description:
      'Estimate token counts and context-budget usage. Heuristic-only ' +
      '(byte-ratio estimator: ~4 chars/token, 2 for JSON-like formats); ' +
      'does not call a tokenizer or hit any API. The estimate matches ' +
      "what the harness's auto-compact path internally believes, so it " +
      "won't disagree with the harness about size. Pick `action`: " +
      '`count` returns tokens for a single `text` string (optionally ' +
      'using a `fileExtension` hint for the dense-format ratio) — returns ' +
      '`tokens`, `chars`, `bytesPerToken`, optional `fileExtension`; ' +
      '`estimate` walks a `Message[]` transcript (same estimator the ' +
      'harness uses) — returns `tokens`, `messageCount`; ' +
      '`budget` computes remaining/fractions from `used`+`total` — ' +
      'returns `used`, `total`, `remaining`, `fractionUsed`, ' +
      '`fractionRemaining`. Useful for the agent to self-monitor context ' +
      'pressure before spawning subagents or summarising. ' +
      'Pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['count', 'estimate', 'budget'],
          description:
            'Which token operation to run. `count` sizes a string; ' +
            "`estimate` sizes a transcript; `budget` computes remaining " +
            'context from used/total.',
        },
        text: {
          type: 'string',
          description:
            "action='count': the text to size. Empty string returns 0.",
        },
        fileExtension: {
          type: 'string',
          description:
            "action='count': optional file extension hint (e.g. \"json\", " +
            '".jsonl"). Swaps in the higher-density ratio for known formats. ' +
            'Unknown extensions fall back to the default 4 bytes/token.',
        },
        messages: {
          type: 'array',
          description:
            "action='estimate': transcript to size. Each element must " +
            "have a role of 'user' | 'assistant' | 'tool' | 'system'. " +
            'Empty array returns 0.',
          items: {
            type: 'object',
          },
        },
        used: {
          type: 'number',
          description:
            "action='budget': tokens already consumed. Must be a " +
            'finite non-negative number.',
          minimum: 0,
        },
        total: {
          type: 'number',
          description:
            "action='budget': total tokens in the context window. Must " +
            'be a finite positive number.',
          exclusiveMinimum: 0,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tokens'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'token',
      'tokens',
      'count',
      'estimate',
      'budget',
      'context',
      'size',
      'compact',
      'usage',
    ],
    aliases: ['token_count', 'count_tokens', 'context_budget'],
    async run(
      input: TokenCountToolInput,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      // ── basic shape check ─────────────────────────────────────────────
      if (input == null || typeof input !== 'object') {
        return errorResult(`input must be an object (got ${String(input)}).`)
      }
      const { action } = input
      if (typeof action !== 'string') {
        return errorResult(
          `'action' must be a string (got ${typeof action}).`,
        )
      }
      if (!VALID_ACTIONS.has(action as TokenCountAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: count, estimate, budget.`,
        )
      }

      // ── per-action validation ────────────────────────────────────────
      switch (action as TokenCountAction) {
        case 'count': {
          if (input.text === undefined) {
            return errorResult(`action='count': 'text' is required.`)
          }
          if (typeof input.text !== 'string') {
            return errorResult(
              `action='count': 'text' must be a string (got ${typeof input.text}).`,
            )
          }
          if (
            input.fileExtension !== undefined &&
            typeof input.fileExtension !== 'string'
          ) {
            return errorResult(
              `action='count': 'fileExtension' must be a string (got ${typeof input.fileExtension}).`,
            )
          }
          break
        }
        case 'estimate': {
          if (input.messages === undefined) {
            return errorResult(`action='estimate': 'messages' is required.`)
          }
          if (!looksLikeMessages(input.messages)) {
            return errorResult(
              `action='estimate': 'messages' must be an array of Message ` +
                `objects with role in {user, assistant, tool, system}.`,
            )
          }
          break
        }
        case 'budget': {
          if (input.used === undefined) {
            return errorResult(`action='budget': 'used' is required.`)
          }
          if (input.total === undefined) {
            return errorResult(`action='budget': 'total' is required.`)
          }
          const u = requireNonNegativeNumber(input.used, 'used')
          if (!u.ok) return errorResult(`action='budget': ${u.error}`)
          const t = requirePositiveNumber(input.total, 'total')
          if (!t.ok) return errorResult(`action='budget': ${t.error}`)
          break
        }
      }

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runTokenCountTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
