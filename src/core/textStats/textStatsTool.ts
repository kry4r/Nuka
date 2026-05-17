// src/core/textStats/textStatsTool.ts
//
// TextStatsTool — agent-facing tool wrapping the pure `textStats.ts`
// helpers into a single discriminated-action surface.
//
// Why a tool? `textStats.ts` exposes a unified `textStats()` plus four
// per-metric counters (`countLines`, `countWords`, `countSentences`,
// `countParagraphs`) as pure-logic library code. Without a tool wrapper
// the agent has to either shell out to `wc -lwc` (no sentence/paragraph
// detection, no ANSI strip, locale-dependent word splitting) or
// hand-roll regexes in chat (different "what's a word" definition every
// time — exactly the rope Nuka-Code's per-call `countLines` /
// `wordCount` / `systemCharCount` variants were tying themselves in).
// Exposing the library gives the model a deterministic, ANSI-aware,
// terminator-vs-separator-correct "how big is this text" primitive.
//
// One Tool with `action`, not five narrow ones: same trade-off as
// SlugTool / TruncateTool / FormatDurationTool. The four counters
// share the same domain (string → integer) and option vocabulary
// (`countAnsi`, `tabWidth`); the `stats` action returns everything in
// one shot. Bundling keeps the registry uncluttered. JSON Schema
// doesn't model proper discriminated unions across action variants,
// so we declare `action` as an enum and validate cross-field
// requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'stats'      → full TextStats breakdown
//   action: 'lines'      → { lines }
//   action: 'words'      → { words }
//   action: 'sentences'  → { sentences }
//   action: 'paragraphs' → { paragraphs }
//
// All actions require `text` and accept the shared options
// `tabWidth` (only consulted by `stats` for visualWidth) and
// `countAnsi`.
//
// Output: each action returns a tagged structured payload (see
// TextStatsToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  countLines,
  countParagraphs,
  countSentences,
  countWords,
  textStats,
  type TextStats,
  type TextStatsOptions,
} from './textStats'

export const TEXT_STATS_TOOL_NAME = 'TextStats'

/** Allowed `action` discriminator values. */
export type TextStatsAction =
  | 'stats'
  | 'lines'
  | 'words'
  | 'sentences'
  | 'paragraphs'

export type TextStatsToolInput = {
  action: TextStatsAction
  /** Required for every action. */
  text: string
  /**
   * Width to charge for a `\t` character when computing
   * `visualWidth`. Only consulted by `action='stats'`. Defaults to 8.
   * Must be positive if provided.
   */
  tabWidth?: number
  /**
   * When false (the default), ANSI escape sequences are stripped
   * before all counting. When true, ANSI bytes count as literal text.
   */
  countAnsi?: boolean
}

/** Tagged result payload per action. */
export type TextStatsToolResult =
  | ({ action: 'stats' } & TextStats)
  | { action: 'lines'; lines: number }
  | { action: 'words'; words: number }
  | { action: 'sentences'; sentences: number }
  | { action: 'paragraphs'; paragraphs: number }

const VALID_ACTIONS: ReadonlySet<TextStatsAction> = new Set([
  'stats',
  'lines',
  'words',
  'sentences',
  'paragraphs',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `TextStats: ${msg}` }
}

/**
 * Validate that `value` is a positive number. Returns the narrowed
 * number or a structured error.
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
      error: `'${field}' must be a positive number (got ${value}).`,
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
export function runTextStatsTool(
  input: TextStatsToolInput,
): TextStatsToolResult {
  const opts: TextStatsOptions = {}
  if (input.tabWidth !== undefined) opts.tabWidth = input.tabWidth
  if (input.countAnsi !== undefined) opts.countAnsi = input.countAnsi

  switch (input.action) {
    case 'stats': {
      const stats = textStats(input.text, opts)
      return { action: 'stats', ...stats }
    }
    case 'lines':
      return { action: 'lines', lines: countLines(input.text, opts) }
    case 'words':
      return { action: 'words', words: countWords(input.text, opts) }
    case 'sentences':
      return {
        action: 'sentences',
        sentences: countSentences(input.text, opts),
      }
    case 'paragraphs':
      return {
        action: 'paragraphs',
        paragraphs: countParagraphs(input.text, opts),
      }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const TextStatsTool: Tool<TextStatsToolInput> =
  defineTool<TextStatsToolInput>({
    name: TEXT_STATS_TOOL_NAME,
    description:
      'Compute statistics for a text string. Pure, allocation-light, ' +
      'linear in input length. ANSI-aware (escape sequences strip out ' +
      'by default; pass `countAnsi:true` to count them as literal text). ' +
      'Pick `action`: ' +
      '`stats` returns the full breakdown (chars, visualWidth, bytes, ' +
      'lines, words, sentences, paragraphs, avgLineLength, avgWordLength, ' +
      'avgWordsPerSentence); ' +
      '`lines` returns a visible-line count (trailing newline is a ' +
      'terminator, not a new empty line; recognizes \\n, \\r\\n, lone \\r); ' +
      '`words` returns a whitespace-collapsed token count; ' +
      '`sentences` returns a count of `[.!?]`-runs followed by whitespace ' +
      'or EOF (abbreviations like `Mr.` inflate; `3.14` does not); ' +
      '`paragraphs` returns a blank-line-separated paragraph count. ' +
      'Pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action', 'text'],
      properties: {
        action: {
          type: 'string',
          enum: ['stats', 'lines', 'words', 'sentences', 'paragraphs'],
          description:
            'Which metric to return. `stats` returns the full TextStats ' +
            'breakdown; the others return a single scalar count.',
        },
        text: {
          type: 'string',
          description:
            'Input text to measure. Empty string is allowed (returns ' +
            'all zeros for `stats`, 0 for scalar counters).',
        },
        tabWidth: {
          type: 'number',
          description:
            "Width to charge for a `\\t` character when computing " +
            "`visualWidth`. Only consulted by action='stats'. Defaults " +
            'to 8. Must be a positive number.',
          exclusiveMinimum: 0,
        },
        countAnsi: {
          type: 'boolean',
          description:
            'When false (default), ANSI escape sequences are stripped ' +
            'before counting — they contribute zero chars, zero width, ' +
            'and are excluded from word/sentence/paragraph detection. ' +
            'Bytes still reflect the raw UTF-8 encoding. When true, ANSI ' +
            'bytes are counted as literal text.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'textStats', 'text', 'count'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'textStats',
      'text',
      'stats',
      'count',
      'lines',
      'words',
      'sentences',
      'paragraphs',
      'chars',
      'bytes',
      'visualWidth',
      'wc',
    ],
    aliases: ['text_stats', 'count_text', 'wc'],
    async run(
      input: TextStatsToolInput,
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
      if (!VALID_ACTIONS.has(action as TextStatsAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: stats, lines, words, sentences, paragraphs.`,
        )
      }

      // ── shared validation: text ───────────────────────────────────────
      if (typeof input.text !== 'string') {
        return errorResult(
          `'text' must be a string (got ${typeof input.text}).`,
        )
      }

      // ── shared validation: tabWidth (when provided) ───────────────────
      if (input.tabWidth !== undefined) {
        const v = requirePositiveNumber(input.tabWidth, 'tabWidth')
        if (!v.ok) {
          return errorResult(v.error)
        }
      }

      // ── shared validation: countAnsi (when provided) ──────────────────
      if (
        input.countAnsi !== undefined &&
        typeof input.countAnsi !== 'boolean'
      ) {
        return errorResult(
          `'countAnsi' must be a boolean (got ${typeof input.countAnsi}).`,
        )
      }

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runTextStatsTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
