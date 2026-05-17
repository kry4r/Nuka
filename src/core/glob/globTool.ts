// src/core/glob/globTool.ts
//
// GlobMatchTool — agent-facing tool wrapping the pure `glob.ts` helpers
// into a single discriminated-action surface.
//
// Why a tool? `glob.ts` exposes `compileGlob` / `matchesGlob` /
// `globToRegex` / `expandBraces` as a pure-logic library — picomatch
// wrapped in a small, stable surface. Without a tool wrapper the agent
// has no path to it and would have to either shell out to `find -name`
// (different glob dialect, no `**`, no brace expansion) or hand-roll a
// regex in chat (every prompt picks a different definition of what `*`
// means). Exposing the helpers as one tool gives the model a
// deterministic, side-effect-free "does this path match this pattern"
// primitive that shares vocabulary with Nuka's permission cache and
// gitignore filter.
//
// One Tool with `action`, not three narrow ones: same trade-off as
// SlugTool / TruncateTool / TextStatsTool. The three actions share the
// same conceptual domain (string pattern → predicate / expansion) and
// the same options vocabulary (`caseInsensitive`, `dot`). Bundling
// keeps the registry uncluttered and gives the model one name to
// remember. JSON Schema doesn't model proper discriminated unions
// across action variants, so we declare `action` as an enum and
// validate cross-field requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'match'        requires `pattern`, `path`
//                          optional `caseInsensitive`, `dot`
//   action: 'matchMany'    requires `pattern`, `paths` (non-empty array)
//                          optional `caseInsensitive`, `dot`
//   action: 'expandBraces' requires `pattern`
//
// Output: each action returns a tagged structured payload (see
// GlobToolResult below). The tool's `output` is the JSON-stringified
// payload so structured consumers (palette, transcripts, downstream
// agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  compileGlob,
  expandBraces,
  matchesGlob,
  type GlobOptions,
} from './glob'

export const GLOB_MATCH_TOOL_NAME = 'GlobMatch'

/** Allowed `action` discriminator values. */
export type GlobMatchAction = 'match' | 'matchMany' | 'expandBraces'

export type GlobMatchInput = {
  action: GlobMatchAction
  /** Required for every action. */
  pattern: string
  /** Required for action='match'. */
  path?: string
  /** Required for action='matchMany'. Array of paths to filter. */
  paths?: string[]
  /** When true, pattern matches case-insensitively. */
  caseInsensitive?: boolean
  /** When true, `*` and `?` match path components starting with `.`. */
  dot?: boolean
}

/** Tagged result payload per action. */
export type GlobMatchResult =
  | {
      action: 'match'
      matched: boolean
      pattern: string
      path: string
    }
  | {
      action: 'matchMany'
      matches: string[]
      total: number
      matched: number
    }
  | {
      action: 'expandBraces'
      patterns: string[]
      original: string
    }

const VALID_ACTIONS: ReadonlySet<GlobMatchAction> = new Set([
  'match',
  'matchMany',
  'expandBraces',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `GlobMatch: ${msg}` }
}

/**
 * Translate the validated tool input into a {@link GlobOptions} pair —
 * undefined-keys stay undefined so the underlying picomatch options
 * are not perturbed when the caller didn't pin them.
 */
function buildOpts(input: GlobMatchInput): GlobOptions {
  const opts: GlobOptions = {}
  if (input.caseInsensitive !== undefined) {
    opts.caseInsensitive = input.caseInsensitive
  }
  if (input.dot !== undefined) opts.dot = input.dot
  return opts
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, type checks)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runGlobMatchTool(input: GlobMatchInput): GlobMatchResult {
  const opts = buildOpts(input)
  switch (input.action) {
    case 'match': {
      const path = input.path as string
      const matched = matchesGlob(input.pattern, path, opts)
      return {
        action: 'match',
        matched,
        pattern: input.pattern,
        path,
      }
    }
    case 'matchMany': {
      const paths = input.paths as string[]
      // Compile once, test many — the whole reason this case exists.
      const matcher = compileGlob(input.pattern, opts)
      const matches = paths.filter((p) => matcher.test(p))
      return {
        action: 'matchMany',
        matches,
        total: paths.length,
        matched: matches.length,
      }
    }
    case 'expandBraces': {
      const patterns = expandBraces(input.pattern)
      return {
        action: 'expandBraces',
        patterns,
        original: input.pattern,
      }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const GlobMatchTool: Tool<GlobMatchInput> = defineTool<GlobMatchInput>({
  name: GLOB_MATCH_TOOL_NAME,
  description:
    'Test glob patterns against paths or expand brace alternatives. ' +
    'Pure picomatch-backed matcher; no filesystem access. ' +
    'Pick `action`: ' +
    "`match` returns `{matched, pattern, path}` for a single path " +
    "(supports `*`, `**`, `?`, `[abc]`, `{a,b}`, leading `!` negation; " +
    "options: `caseInsensitive`, `dot`); " +
    "`matchMany` filters an already-known list of paths against the " +
    "pattern and returns `{matches, total, matched}` — compile once, " +
    "test many; " +
    "`expandBraces` syntactically expands `a/{b,c}/d` to " +
    "`['a/b/d', 'a/c/d']` (no numeric-range expansion). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'pattern'],
    properties: {
      action: {
        type: 'string',
        enum: ['match', 'matchMany', 'expandBraces'],
        description:
          "Which operation to run. Required fields per action: " +
          "match -> pattern+path; matchMany -> pattern+paths (non-empty); " +
          "expandBraces -> pattern.",
      },
      pattern: {
        type: 'string',
        description:
          'Glob pattern. Picomatch syntax: `*` and `?` for single-segment ' +
          'wildcards, `**` for multi-segment, `[abc]` character class, ' +
          '`{a,b}` alternation, leading `!` for negation, backslash escapes. ' +
          'Leading `/` is stripped (anchor-to-root); trailing `/` becomes ' +
          '`/**` (directory contents). Required for every action.',
      },
      path: {
        type: 'string',
        description:
          "action='match': single path to test against `pattern`. " +
          'Forward-slash-separated; pre-normalised by the caller (no ' +
          'backslash → slash conversion is performed).',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          "action='matchMany': array of paths to filter. Must be " +
          "non-empty. The pattern is compiled once and applied to " +
          "every entry; only matching paths appear in the result " +
          "(original order preserved).",
      },
      caseInsensitive: {
        type: 'boolean',
        description:
          "When true, the pattern matches case-insensitively (`*.TXT` " +
          "matches `foo.txt`). Default false. Applies to action='match' " +
          "and action='matchMany'.",
      },
      dot: {
        type: 'boolean',
        description:
          "When true, `*` and `?` may match path components starting " +
          "with `.` (so `*` matches `.hidden`). Default false. Applies " +
          "to action='match' and action='matchMany'.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'glob', 'match', 'pattern'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'glob',
    'match',
    'pattern',
    'wildcard',
    'picomatch',
    'expand',
    'braces',
    'filter',
  ],
  aliases: ['glob_match', 'glob', 'pattern_match'],
  async run(input: GlobMatchInput, _ctx: ToolContext): Promise<ToolResult> {
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
    if (!VALID_ACTIONS.has(action as GlobMatchAction)) {
      return errorResult(
        `unknown action '${action}'. Valid: match, matchMany, expandBraces.`,
      )
    }

    // ── shared validation: pattern (required for every action) ───────
    if (typeof input.pattern !== 'string') {
      return errorResult(
        `'pattern' must be a string (got ${typeof input.pattern}).`,
      )
    }

    // ── shared validation: caseInsensitive / dot (when provided) ─────
    if (
      input.caseInsensitive !== undefined &&
      typeof input.caseInsensitive !== 'boolean'
    ) {
      return errorResult(
        `'caseInsensitive' must be a boolean (got ${typeof input.caseInsensitive}).`,
      )
    }
    if (input.dot !== undefined && typeof input.dot !== 'boolean') {
      return errorResult(
        `'dot' must be a boolean (got ${typeof input.dot}).`,
      )
    }

    // ── per-action cross-field validation ─────────────────────────────
    switch (action as GlobMatchAction) {
      case 'match': {
        if (typeof input.path !== 'string') {
          return errorResult(
            `action='match': 'path' must be a string (got ${typeof input.path}).`,
          )
        }
        break
      }
      case 'matchMany': {
        if (!Array.isArray(input.paths)) {
          return errorResult(
            `action='matchMany': 'paths' must be an array (got ${typeof input.paths}).`,
          )
        }
        if (input.paths.length === 0) {
          return errorResult(
            `action='matchMany': 'paths' must be a non-empty array.`,
          )
        }
        for (let i = 0; i < input.paths.length; i++) {
          if (typeof input.paths[i] !== 'string') {
            return errorResult(
              `action='matchMany': 'paths[${i}]' must be a string (got ${typeof input.paths[i]}).`,
            )
          }
        }
        break
      }
      case 'expandBraces': {
        // pattern already checked above; nothing else required.
        break
      }
    }

    // ── delegate to the pure helper ──────────────────────────────────
    try {
      const payload = runGlobMatchTool(input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`action='${action}' failed: ${msg}`)
    }
  },
})
