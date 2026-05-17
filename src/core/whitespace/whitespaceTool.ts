// src/core/whitespace/whitespaceTool.ts
//
// WhitespaceTool — agent-facing tool wrapping the pure `whitespace.ts`
// helpers into a single discriminated-action surface.
//
// Why a tool? `whitespace.ts` is pure library code (string → cleaned
// string) used by Nuka's rendering pipeline and prompt-context shaper.
// Without a tool wrapper, the agent has to either shell out (`expand`,
// `sed 's/[[:space:]]*$//'`, `awk` blank-line games — locale-fragile,
// fragmented vocabulary, no `dedent`) or hand-roll regex transforms in
// chat (split surrogate pairs in tabs-with-emoji, miss CRLF, kill the
// trailing newline). Exposing the existing helpers gives the agent a
// deterministic, idempotent "sanitize this text" primitive that shares
// the same vocabulary as the rest of the codebase.
//
// One Tool with `action`, not seven narrow ones: same trade-off as
// FormatDurationTool / TextStatsTool / TruncateTool. The helpers
// (`dedent`, `trimTrailingWhitespace`, `trimBlankLines`,
// `collapseBlankLines`, `normalizeLineEndings`, `expandTabs`,
// `normalize`) share the same domain (string in, string out) and a
// common options vocabulary (`tabWidth`, `maxConsecutive`, EOL style).
// Bundling keeps the registry uncluttered. JSON Schema doesn't model
// proper discriminated unions across action variants, so we declare
// `action` as an enum and validate cross-field requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'dedent'        requires `text`              optional `tabWidth`
//   action: 'trimTrailing'  requires `text`
//   action: 'trimBlank'     requires `text`
//   action: 'collapseBlank' requires `text`              optional `maxConsecutive`
//   action: 'normalizeEol'  requires `text`              optional `to`
//   action: 'expandTabs'    requires `text`              optional `tabWidth`
//   action: 'normalize'     requires `text`              optional `dedent`,
//                           `trimTrailing`, `collapseBlanks`, `lineEndings`,
//                           `trimEdges`, `expandTabs`
//
// Output: each action returns a tagged structured payload (see
// WhitespaceToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.
//
// Per-action extras worth surfacing alongside `result`:
//
//  - `dedent`:        `indentRemoved` — how many leading columns were
//    stripped (0 when no common indent existed).
//  - `trimTrailing`:  `linesChanged`  — count of lines that had
//    trailing whitespace removed.
//  - `trimBlank`:     `leadingTrimmed` / `trailingTrimmed` — count of
//    blank lines stripped from each edge.
//
// `collapseBlank` / `normalizeEol` / `expandTabs` / `normalize` only
// return `{ result }`; counting more (e.g. "how many blank runs
// collapsed") would mean reimplementing the helpers here.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  collapseBlankLines,
  dedent,
  expandTabs,
  normalize,
  normalizeLineEndings,
  trimBlankLines,
  trimTrailingWhitespace,
  type LineEndingStyle,
  type NormalizeOptions,
} from './whitespace'

export const WHITESPACE_TOOL_NAME = 'Whitespace'

/** Allowed `action` discriminator values. */
export type WhitespaceAction =
  | 'dedent'
  | 'trimTrailing'
  | 'trimBlank'
  | 'collapseBlank'
  | 'normalizeEol'
  | 'expandTabs'
  | 'normalize'

export type WhitespaceToolInput = {
  action: WhitespaceAction
  /** Required for every action. */
  text: string
  /** Used by `dedent` and `expandTabs`. Positive integer, defaults to 8. */
  tabWidth?: number
  /** Used by `collapseBlank`. Non-negative integer, defaults to 1. */
  maxConsecutive?: number
  /** Used by `normalizeEol`. Defaults to 'lf'. */
  to?: LineEndingStyle
  // ── normalize-only sub-options ─────────────────────────────────────
  /** action='normalize': strip common leading indent. Default true. */
  dedent?: boolean
  /** action='normalize': strip trailing horizontal whitespace per line. Default true. */
  trimTrailing?: boolean
  /**
   * action='normalize': collapse blank-line runs. Boolean = default cap
   * of 1; number = explicit cap; false = disable. Default true.
   */
  collapseBlanks?: boolean | number
  /**
   * action='normalize': normalize line endings. 'lf' | 'crlf' | false.
   * Default 'lf'.
   */
  lineEndings?: LineEndingStyle | false
  /** action='normalize': trim leading/trailing blank lines. Default true. */
  trimEdges?: boolean
  /**
   * action='normalize': expand tabs to spaces using this width. Number
   * = on; false = off. Default false (preserve tabs).
   */
  expandTabs?: number | false
}

/** Tagged result payload per action. */
export type WhitespaceToolResult =
  | { action: 'dedent'; result: string; indentRemoved: number }
  | { action: 'trimTrailing'; result: string; linesChanged: number }
  | {
      action: 'trimBlank'
      result: string
      leadingTrimmed: number
      trailingTrimmed: number
    }
  | { action: 'collapseBlank'; result: string }
  | { action: 'normalizeEol'; result: string }
  | { action: 'expandTabs'; result: string }
  | { action: 'normalize'; result: string }

const VALID_ACTIONS: ReadonlySet<WhitespaceAction> = new Set([
  'dedent',
  'trimTrailing',
  'trimBlank',
  'collapseBlank',
  'normalizeEol',
  'expandTabs',
  'normalize',
])

const VALID_EOL_STYLES: ReadonlySet<LineEndingStyle> = new Set(['lf', 'crlf'])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `Whitespace: ${msg}` }
}

function requirePositiveInt(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite positive integer (got ${String(value)}).`,
    }
  }
  if (!Number.isInteger(value) || value < 1) {
    return {
      ok: false,
      error: `'${field}' must be a positive integer (got ${value}).`,
    }
  }
  return { ok: true, value }
}

function requireNonNegativeInt(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite non-negative integer (got ${String(value)}).`,
    }
  }
  if (!Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      error: `'${field}' must be a non-negative integer (got ${value}).`,
    }
  }
  return { ok: true, value }
}

// ─── per-action metric helpers ──────────────────────────────────────
//
// These walk the (input, output) pair to derive the `indentRemoved` /
// `linesChanged` / `leadingTrimmed` / `trailingTrimmed` extras that the
// task brief asked for. They run *after* the pure helper, so they pay
// one extra pass each but stay free of state.

/**
 * Count how many leading columns `dedent` stripped by comparing the
 * leading whitespace of the first non-blank line in each side. We use
 * `expandTabs(leading, { tabWidth })` so the count is column-accurate
 * even when the input mixed tabs and spaces.
 */
function measureIndentRemoved(
  before: string,
  after: string,
  tabWidth: number,
): number {
  if (!before) return 0
  const beforeLines = before.replace(/\r\n?/g, '\n').split('\n')
  const afterLines = after.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < beforeLines.length && i < afterLines.length; i++) {
    const b = beforeLines[i]!
    const a = afterLines[i]!
    if (/^\s*$/.test(b)) continue // blank: doesn't constrain
    const bLeading = b.match(/^[^\S\r\n]*/)?.[0] ?? ''
    const aLeading = a.match(/^[^\S\r\n]*/)?.[0] ?? ''
    const bExpanded = expandTabs(bLeading, { tabWidth }).length
    const aExpanded = expandTabs(aLeading, { tabWidth }).length
    return Math.max(0, bExpanded - aExpanded)
  }
  return 0
}

/**
 * Count how many lines had trailing whitespace stripped. We split on
 * `\n` (after CR/LF normalize) on both sides and compare line-by-line.
 */
function countLinesChanged(before: string, after: string): number {
  if (before === after) return 0
  const b = before.replace(/\r\n?/g, '\n').split('\n')
  const a = after.replace(/\r\n?/g, '\n').split('\n')
  const n = Math.min(b.length, a.length)
  let count = 0
  for (let i = 0; i < n; i++) {
    if (b[i] !== a[i]) count++
  }
  return count
}

/**
 * Count blank lines trimmed from each edge. Done by independently
 * scanning the input from each edge for the run of blank lines, since
 * `trimBlankLines` returns only the cleaned body.
 */
function countEdgeBlanks(text: string): {
  leading: number
  trailing: number
} {
  if (!text) return { leading: 0, trailing: 0 }
  const lf = text.replace(/\r\n?/g, '\n')
  const endsNewline = lf.endsWith('\n')
  const body = endsNewline ? lf.slice(0, -1) : lf
  const lines = body.split('\n')
  let leading = 0
  for (const l of lines) {
    if (/^\s*$/.test(l)) leading++
    else break
  }
  // If every line is blank, don't double-count.
  if (leading === lines.length) {
    return { leading, trailing: 0 }
  }
  let trailing = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*$/.test(lines[i]!)) trailing++
    else break
  }
  return { leading, trailing }
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, option ranges)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runWhitespaceTool(
  input: WhitespaceToolInput,
): WhitespaceToolResult {
  switch (input.action) {
    case 'dedent': {
      const tabWidth = input.tabWidth ?? 8
      const result = dedent(input.text, { tabWidth })
      const indentRemoved = measureIndentRemoved(
        input.text,
        result,
        tabWidth,
      )
      return { action: 'dedent', result, indentRemoved }
    }
    case 'trimTrailing': {
      const result = trimTrailingWhitespace(input.text)
      const linesChanged = countLinesChanged(input.text, result)
      return { action: 'trimTrailing', result, linesChanged }
    }
    case 'trimBlank': {
      const { leading, trailing } = countEdgeBlanks(input.text)
      const result = trimBlankLines(input.text)
      return {
        action: 'trimBlank',
        result,
        leadingTrimmed: leading,
        trailingTrimmed: trailing,
      }
    }
    case 'collapseBlank': {
      const max = input.maxConsecutive ?? 1
      const result = collapseBlankLines(input.text, { maxConsecutive: max })
      return { action: 'collapseBlank', result }
    }
    case 'normalizeEol': {
      const to = input.to ?? 'lf'
      const result = normalizeLineEndings(input.text, { to })
      return { action: 'normalizeEol', result }
    }
    case 'expandTabs': {
      const tabWidth = input.tabWidth ?? 8
      const result = expandTabs(input.text, { tabWidth })
      return { action: 'expandTabs', result }
    }
    case 'normalize': {
      const opts: NormalizeOptions = {}
      if (input.dedent !== undefined) opts.dedent = input.dedent
      if (input.trimTrailing !== undefined) opts.trimTrailing = input.trimTrailing
      if (input.collapseBlanks !== undefined) opts.collapseBlanks = input.collapseBlanks
      if (input.lineEndings !== undefined) opts.lineEndings = input.lineEndings
      if (input.trimEdges !== undefined) opts.trimEdges = input.trimEdges
      if (input.expandTabs !== undefined) opts.expandTabs = input.expandTabs
      const result = normalize(input.text, opts)
      return { action: 'normalize', result }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const WhitespaceTool: Tool<WhitespaceToolInput> =
  defineTool<WhitespaceToolInput>({
    name: WHITESPACE_TOOL_NAME,
    description:
      'Clean up whitespace in a text string. Pure, idempotent on its own ' +
      'output, no IO. Pick `action`: ' +
      '`dedent` strips the longest common leading indent across non-blank ' +
      'lines (tab-aware via `tabWidth`, default 8) — returns `result` and ' +
      '`indentRemoved`; ' +
      '`trimTrailing` removes trailing spaces/tabs per line — returns ' +
      '`result` and `linesChanged`; ' +
      '`trimBlank` drops blank lines from both edges (preserves a single ' +
      'final newline) — returns `result`, `leadingTrimmed`, ' +
      '`trailingTrimmed`; ' +
      '`collapseBlank` caps consecutive blank-line runs at ' +
      '`maxConsecutive` (default 1, 0 removes blanks entirely); ' +
      "`normalizeEol` converts line endings — `to`='lf' (default) or " +
      "'crlf'; " +
      '`expandTabs` converts `\\t` to spaces at the next `tabWidth` ' +
      'multiple (default 8); ' +
      '`normalize` is a combined pipeline (expandTabs -> dedent -> ' +
      'trimTrailing -> collapseBlanks -> trimEdges -> lineEndings) with ' +
      'each step independently disable-able. ' +
      'Pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action', 'text'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'dedent',
            'trimTrailing',
            'trimBlank',
            'collapseBlank',
            'normalizeEol',
            'expandTabs',
            'normalize',
          ],
          description:
            'Which whitespace transform to apply. Every action takes ' +
            '`text`; per-action options listed below.',
        },
        text: {
          type: 'string',
          description:
            'Input text. Empty string is allowed (returns empty result). ' +
            'Required for every action.',
        },
        tabWidth: {
          type: 'number',
          description:
            "Used by action='dedent' and action='expandTabs'. Spaces per " +
            'tab stop. Default 8. Must be a positive integer.',
          minimum: 1,
        },
        maxConsecutive: {
          type: 'number',
          description:
            "action='collapseBlank': maximum consecutive blank lines to " +
            'permit. Default 1 (long runs collapse to one blank). 0 removes ' +
            'blank lines entirely. Must be a non-negative integer.',
          minimum: 0,
        },
        to: {
          type: 'string',
          enum: ['lf', 'crlf'],
          description:
            "action='normalizeEol': target line-ending style. Default 'lf'.",
        },
        dedent: {
          type: 'boolean',
          description:
            "action='normalize': run dedent step. Default true.",
        },
        trimTrailing: {
          type: 'boolean',
          description:
            "action='normalize': strip trailing horizontal whitespace per " +
            'line. Default true.',
        },
        collapseBlanks: {
          oneOf: [{ type: 'boolean' }, { type: 'number', minimum: 0 }],
          description:
            "action='normalize': collapse blank-line runs. true = default " +
            'cap 1; number = explicit cap; false = disable. Default true.',
        },
        lineEndings: {
          oneOf: [
            { type: 'string', enum: ['lf', 'crlf'] },
            { type: 'boolean', enum: [false] },
          ],
          description:
            "action='normalize': normalize line endings. 'lf' (default), " +
            "'crlf', or false to skip.",
        },
        trimEdges: {
          type: 'boolean',
          description:
            "action='normalize': trim leading/trailing blank lines. " +
            'Default true.',
        },
        expandTabs: {
          oneOf: [
            { type: 'number', minimum: 1 },
            { type: 'boolean', enum: [false] },
          ],
          description:
            "action='normalize': expand tabs to spaces using this width. " +
            'number = on; false = off. Default false (tabs preserved).',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'whitespace', 'text', 'format'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'whitespace',
      'dedent',
      'trim',
      'tabs',
      'spaces',
      'blank',
      'collapse',
      'normalize',
      'eol',
      'crlf',
      'lf',
    ],
    aliases: ['whitespace', 'clean_whitespace', 'normalize_whitespace'],
    async run(
      input: WhitespaceToolInput,
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
      if (!VALID_ACTIONS.has(action as WhitespaceAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: dedent, trimTrailing, trimBlank, collapseBlank, normalizeEol, expandTabs, normalize.`,
        )
      }

      // ── shared validation: text ───────────────────────────────────────
      if (typeof input.text !== 'string') {
        return errorResult(
          `'text' must be a string (got ${typeof input.text}).`,
        )
      }

      // ── per-action / cross-field validation ──────────────────────────
      switch (action as WhitespaceAction) {
        case 'dedent':
        case 'expandTabs': {
          if (input.tabWidth !== undefined) {
            const v = requirePositiveInt(input.tabWidth, 'tabWidth')
            if (!v.ok) return errorResult(`action='${action}': ${v.error}`)
          }
          break
        }
        case 'collapseBlank': {
          if (input.maxConsecutive !== undefined) {
            const v = requireNonNegativeInt(
              input.maxConsecutive,
              'maxConsecutive',
            )
            if (!v.ok) return errorResult(`action='collapseBlank': ${v.error}`)
          }
          break
        }
        case 'normalizeEol': {
          if (
            input.to !== undefined &&
            !VALID_EOL_STYLES.has(input.to as LineEndingStyle)
          ) {
            return errorResult(
              `action='normalizeEol': unknown 'to' value '${String(input.to)}'. Valid: lf, crlf.`,
            )
          }
          break
        }
        case 'normalize': {
          if (
            input.dedent !== undefined &&
            typeof input.dedent !== 'boolean'
          ) {
            return errorResult(
              `action='normalize': 'dedent' must be a boolean (got ${typeof input.dedent}).`,
            )
          }
          if (
            input.trimTrailing !== undefined &&
            typeof input.trimTrailing !== 'boolean'
          ) {
            return errorResult(
              `action='normalize': 'trimTrailing' must be a boolean (got ${typeof input.trimTrailing}).`,
            )
          }
          if (input.collapseBlanks !== undefined) {
            if (
              typeof input.collapseBlanks !== 'boolean' &&
              typeof input.collapseBlanks !== 'number'
            ) {
              return errorResult(
                `action='normalize': 'collapseBlanks' must be a boolean or number (got ${typeof input.collapseBlanks}).`,
              )
            }
            if (typeof input.collapseBlanks === 'number') {
              const v = requireNonNegativeInt(
                input.collapseBlanks,
                'collapseBlanks',
              )
              if (!v.ok) return errorResult(`action='normalize': ${v.error}`)
            }
          }
          if (input.lineEndings !== undefined) {
            if (input.lineEndings !== false) {
              if (
                typeof input.lineEndings !== 'string' ||
                !VALID_EOL_STYLES.has(input.lineEndings as LineEndingStyle)
              ) {
                return errorResult(
                  `action='normalize': 'lineEndings' must be 'lf', 'crlf', or false (got ${String(input.lineEndings)}).`,
                )
              }
            }
          }
          if (
            input.trimEdges !== undefined &&
            typeof input.trimEdges !== 'boolean'
          ) {
            return errorResult(
              `action='normalize': 'trimEdges' must be a boolean (got ${typeof input.trimEdges}).`,
            )
          }
          if (input.expandTabs !== undefined) {
            if (input.expandTabs !== false) {
              if (typeof input.expandTabs !== 'number') {
                return errorResult(
                  `action='normalize': 'expandTabs' must be a number or false (got ${typeof input.expandTabs}).`,
                )
              }
              const v = requirePositiveInt(input.expandTabs, 'expandTabs')
              if (!v.ok) return errorResult(`action='normalize': ${v.error}`)
            }
          }
          break
        }
        // 'trimTrailing' and 'trimBlank' need only `text` validation.
      }

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runWhitespaceTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
