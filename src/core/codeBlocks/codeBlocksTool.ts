// src/core/codeBlocks/codeBlocksTool.ts
//
// CodeBlocks — agent-facing tool wrapping the pure `parse.ts` helpers
// into a single discriminated-action surface.
//
// Why a tool? `parse.ts` exposes four useful entry points
// (`extractCodeBlocks`, `splitByCodeFences`, `findFirstCodeBlock`,
// `unwrapSingleCodeBlock`) that the agent currently has no way to call.
// Without this wrapper the model would either eyeball-parse fences in
// its head (error-prone for nested fences, unclosed blocks, CRLF inputs)
// or shell out to `awk`/`sed` (fragile, doesn't model lang tags).
// Exposing the helpers as one tool gives a deterministic, pure surface
// for "give me every code block", "split prose/code", "find the python
// block", "is this just one code block?".
//
// One tool with `action` vs four narrow tools: same trade-off as
// FormatDuration — bundling keeps the registry uncluttered and gives the
// model a single name to remember. JSON Schema doesn't model proper
// discriminated unions across action variants, so we validate
// cross-field requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. `readOnly:
// true`, `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'extract'    requires `text` — extractCodeBlocks(text)
//   action: 'split'      requires `text` — splitByCodeFences(text)
//   action: 'findFirst'  requires `text`, optional `lang`
//                                       — findFirstCodeBlock(text, lang?)
//   action: 'unwrap'     requires `text` — unwrapSingleCodeBlock(text)
//
// Output: each action returns a tagged structured payload (see
// CodeBlocksResult below). The tool's `output` is the JSON-stringified
// payload so structured consumers can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  extractCodeBlocks,
  findFirstCodeBlock,
  splitByCodeFences,
  unwrapSingleCodeBlock,
  type CodeBlock,
  type Segment,
} from './parse'

export const CODE_BLOCKS_TOOL_NAME = 'CodeBlocks'

/** Allowed `action` discriminator values. */
export type CodeBlocksAction = 'extract' | 'split' | 'findFirst' | 'unwrap'

export type CodeBlocksInput = {
  action: CodeBlocksAction
  /** Required for every action. May be empty string ('' is valid). */
  text: string
  /**
   * Optional for action='findFirst'. When provided, filters by language
   * tag (case-insensitive). Pass null explicitly to match blocks that
   * had no info string.
   */
  lang?: string | null
}

/**
 * Public, transport-safe code block view. Drops the internal byte
 * offsets (`startOffset` / `endOffset`) from the parser's `CodeBlock`
 * since they leak implementation details to the agent and aren't useful
 * outside this process. Line numbers, lang, content, and fence metadata
 * are preserved.
 */
export type CodeBlockView = {
  lang: string | null
  content: string
  startLine: number
  endLine: number
  fenceChar: '`' | '~'
  fenceLength: number
  closed: boolean
}

/** Public view of a segment from `splitByCodeFences`. */
export type SegmentView =
  | {
      type: 'prose'
      content: string
      startLine: number
      endLine: number
    }
  | {
      type: 'code'
      content: string
      lang: string | null
      startLine: number
      endLine: number
    }

/** Tagged result payload per action. */
export type CodeBlocksResult =
  | { action: 'extract'; blocks: CodeBlockView[]; count: number }
  | {
      action: 'split'
      segments: SegmentView[]
      proseChars: number
      codeChars: number
    }
  | { action: 'findFirst'; block: CodeBlockView | null }
  | { action: 'unwrap'; unwrapped: string | null }

const VALID_ACTIONS: ReadonlySet<CodeBlocksAction> = new Set([
  'extract',
  'split',
  'findFirst',
  'unwrap',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `CodeBlocks: ${msg}` }
}

/** Strip the internal byte offsets before exposing to the agent. */
function toView(b: CodeBlock): CodeBlockView {
  return {
    lang: b.lang,
    content: b.content,
    startLine: b.startLine,
    endLine: b.endLine,
    fenceChar: b.fenceChar,
    fenceLength: b.fenceLength,
    closed: b.closed,
  }
}

/** Convert a parser segment into the transport-safe shape. */
function segToView(s: Segment): SegmentView {
  if (s.type === 'prose') {
    return {
      type: 'prose',
      content: s.text,
      startLine: s.startLine,
      endLine: s.endLine,
    }
  }
  return {
    type: 'code',
    content: s.block.content,
    lang: s.block.lang,
    startLine: s.block.startLine,
    endLine: s.block.endLine,
  }
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 */
export function runCodeBlocks(input: CodeBlocksInput): CodeBlocksResult {
  const { action, text } = input
  switch (action) {
    case 'extract': {
      const blocks = extractCodeBlocks(text).map(toView)
      return { action: 'extract', blocks, count: blocks.length }
    }
    case 'split': {
      const segments = splitByCodeFences(text).map(segToView)
      let proseChars = 0
      let codeChars = 0
      for (const s of segments) {
        if (s.type === 'prose') proseChars += s.content.length
        else codeChars += s.content.length
      }
      return { action: 'split', segments, proseChars, codeChars }
    }
    case 'findFirst': {
      // `lang` is optional. `undefined` means "any lang"; an explicit
      // null filters to blocks that lacked an info string. A non-empty
      // string filters by tag (case-insensitive, the parser handles
      // the lowercasing internally).
      const lang = input.lang
      const block =
        lang === undefined
          ? findFirstCodeBlock(text)
          : findFirstCodeBlock(text, lang)
      return { action: 'findFirst', block: block ? toView(block) : null }
    }
    case 'unwrap': {
      return { action: 'unwrap', unwrapped: unwrapSingleCodeBlock(text) }
    }
    default: {
      const _exhaustive: never = action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const CodeBlocksTool: Tool<CodeBlocksInput> = defineTool<CodeBlocksInput>({
  name: CODE_BLOCKS_TOOL_NAME,
  description:
    'Parse fenced code blocks (CommonMark §4.5) out of a string. ' +
    'Pick `action`: ' +
    "`extract` returns every fenced block (lang, content, line range, fence char/length, closed); " +
    "`split` returns an ordered list of prose/code segments that reconstruct the input byte-for-byte; " +
    "`findFirst` returns the first block (optionally filtered by `lang`, case-insensitive); " +
    "`unwrap` returns the inner content when the input is exactly one fenced block (optionally surrounded by whitespace), else null. " +
    'Indented (4-space) code blocks are NOT supported — fenced only. All actions are pure and parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['extract', 'split', 'findFirst', 'unwrap'],
        description:
          "Which operation to run. All actions require `text`. " +
          "`findFirst` additionally accepts an optional `lang` filter.",
      },
      text: {
        type: 'string',
        description:
          'The text to parse. May be empty (`extract`/`split` return empty results; ' +
          '`findFirst`/`unwrap` return null).',
      },
      lang: {
        type: ['string', 'null'],
        description:
          "action='findFirst': filter by language tag (case-insensitive). " +
          'Pass null to match blocks with no info string. Omit for "any lang".',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'text', 'markdown', 'code-blocks'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'code',
    'block',
    'fence',
    'markdown',
    'parse',
    'extract',
    'unwrap',
  ],
  aliases: ['code_blocks', 'codeblocks', 'parse_code_blocks'],
  async run(
    input: CodeBlocksInput,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    // ── shape validation ────────────────────────────────────────────
    if (input == null || typeof input !== 'object') {
      return errorResult(
        `input must be an object (got ${String(input)}).`,
      )
    }
    const { action } = input
    if (typeof action !== 'string') {
      return errorResult(
        `'action' must be a string (got ${typeof action}).`,
      )
    }
    if (!VALID_ACTIONS.has(action as CodeBlocksAction)) {
      return errorResult(
        `unknown action '${action}'. Valid: extract, split, findFirst, unwrap.`,
      )
    }
    if (typeof input.text !== 'string') {
      return errorResult(
        `'text' must be a string (got ${typeof input.text}).`,
      )
    }
    if (
      input.lang !== undefined &&
      input.lang !== null &&
      typeof input.lang !== 'string'
    ) {
      return errorResult(
        `'lang' must be a string, null, or omitted (got ${typeof input.lang}).`,
      )
    }

    // ── delegate to the pure helper ─────────────────────────────────
    try {
      const payload = runCodeBlocks(input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`action='${action}' failed: ${msg}`)
    }
  },
})
