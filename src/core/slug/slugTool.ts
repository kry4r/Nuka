// src/core/slug/slugTool.ts
//
// SlugTool — agent-facing tool wrapping the pure `slug.ts` helpers
// into a single discriminated-action surface.
//
// Why a tool? `slug.ts` exposes three strictness-tiered helpers
// (`slugify`, `safeFilename`, `safeBranchName`) that the agent currently
// has no way to call directly. Without this wrapper the model would have
// to either hand-craft regex transformations (different `safe` definition
// every time, exactly the rope that Nuka-Code's per-call `sanitizeName`
// variants were tying themselves in) or shell out to `tr`/`sed` (no
// NFKD normalisation, no Unicode-property awareness, no git-ref rule
// modelling). Exposing the helpers as one tool gives a deterministic,
// pure surface for "make a URL slug", "make a safe filename", "make a
// safe git branch name".
//
// One Tool with `action`, not three narrow ones: same trade-off as
// FormatDuration / WrapText / CodeBlocks. The three helpers share the
// same conceptual domain (arbitrary string → constrained identifier)
// and overlap on the `replacement`/`maxLength` vocabulary. Bundling
// keeps the registry uncluttered and gives the model a single name to
// remember. JSON Schema doesn't model proper discriminated unions
// across action variants, so we declare `action` as an enum and
// validate cross-field requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'slugify'        requires `text`
//                            optional `separator`, `lower`, `strict`,
//                            `unicode`, `maxLength`
//   action: 'safeFilename'   requires `text`
//                            optional `replacement`, `preserveExtension`,
//                            `maxLength`
//   action: 'safeBranchName' requires `text`
//                            optional `replacement`, `maxLength`
//
// Output: each action returns a tagged structured payload (see
// SlugToolResult below). The tool's `output` is the JSON-stringified
// payload so structured consumers (palette, transcripts, downstream
// agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  safeBranchName,
  safeFilename,
  slugify,
  type SafeBranchOptions,
  type SafeFilenameOptions,
  type SlugOptions,
} from './slug'

export const SLUG_TOOL_NAME = 'Slug'

/** Allowed `action` discriminator values. */
export type SlugToolAction = 'slugify' | 'safeFilename' | 'safeBranchName'

export type SlugToolInput = {
  action: SlugToolAction
  /** Required for every action. */
  text: string
  // ── slugify-specific options ────────────────────────────────────────
  /** Single character used to join kept words. Defaults to `'-'`. */
  separator?: string
  /** Lower-case the output. Defaults to `true`. */
  lower?: boolean
  /** Strict ASCII slug. Defaults to `true`. */
  strict?: boolean
  /** Preserve Unicode letters/digits. Only used when `strict` is false-y
   * in the agent's mental model, but `slugify` accepts both independently;
   * we pass through as-is. Defaults to `false`. */
  unicode?: boolean
  // ── safeFilename-specific options ───────────────────────────────────
  /**
   * Replacement character for forbidden bytes (single char). Used by
   * `safeFilename` (default `'_'`) and `safeBranchName` (default `'-'`).
   */
  replacement?: string
  /** Preserve the trailing `.ext` for `safeFilename`. Defaults to `true`. */
  preserveExtension?: boolean
  // ── shared option ───────────────────────────────────────────────────
  /**
   * Maximum total length. Each helper applies its own default if omitted
   * (`slugify` -> Infinity, `safeFilename` -> 255, `safeBranchName` -> 200).
   * If provided, must be a positive number.
   */
  maxLength?: number
}

/** Tagged result payload per action. */
export type SlugToolResult =
  | {
      action: 'slugify'
      result: string
      originalLength: number
      resultLength: number
    }
  | {
      action: 'safeFilename'
      result: string
      hadExtension: boolean
    }
  | {
      action: 'safeBranchName'
      result: string
    }

const VALID_ACTIONS: ReadonlySet<SlugToolAction> = new Set([
  'slugify',
  'safeFilename',
  'safeBranchName',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `Slug: ${msg}` }
}

/**
 * Validate that `value` is a positive number. The slug helpers tolerate
 * `Infinity`, so we accept that explicitly. Returns the narrowed number
 * or a structured error.
 */
function requirePositiveNumber(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number') {
    return {
      ok: false,
      error: `'${field}' must be a number (got ${typeof value}).`,
    }
  }
  if (Number.isNaN(value)) {
    return { ok: false, error: `'${field}' must not be NaN.` }
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
 * Detect whether the original input had a trailing `.ext` (last `.`
 * after at least one preceding char, and at least one char after).
 * Mirrors the logic inside `safeFilename` so the tool can report
 * `hadExtension` without exposing the internal split.
 */
function detectHadExtension(text: string): boolean {
  const lastDot = text.lastIndexOf('.')
  return lastDot > 0 && lastDot < text.length - 1
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, option ranges)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runSlugTool(input: SlugToolInput): SlugToolResult {
  switch (input.action) {
    case 'slugify': {
      const opts: SlugOptions = {}
      if (input.separator !== undefined) opts.separator = input.separator
      if (input.lower !== undefined) opts.lower = input.lower
      if (input.strict !== undefined) opts.strict = input.strict
      if (input.unicode !== undefined) opts.unicode = input.unicode
      if (input.maxLength !== undefined) opts.maxLength = input.maxLength
      const result = slugify(input.text, opts)
      return {
        action: 'slugify',
        result,
        originalLength: input.text.length,
        resultLength: result.length,
      }
    }
    case 'safeFilename': {
      const opts: SafeFilenameOptions = {}
      if (input.replacement !== undefined) opts.replacement = input.replacement
      if (input.preserveExtension !== undefined) {
        opts.preserveExtension = input.preserveExtension
      }
      if (input.maxLength !== undefined) opts.maxLength = input.maxLength
      // The slug module always uses the LAST `.` to find the extension,
      // and only counts it when there's content on both sides. Report
      // that fact based on the input — but only when the caller asked
      // us to preserve extensions (or left it default-on).
      const preserve = input.preserveExtension !== false
      const hadExtension = preserve && detectHadExtension(input.text)
      const result = safeFilename(input.text, opts)
      return { action: 'safeFilename', result, hadExtension }
    }
    case 'safeBranchName': {
      const opts: SafeBranchOptions = {}
      if (input.replacement !== undefined) opts.replacement = input.replacement
      if (input.maxLength !== undefined) opts.maxLength = input.maxLength
      const result = safeBranchName(input.text, opts)
      return { action: 'safeBranchName', result }
    }
    default: {
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const SlugTool: Tool<SlugToolInput> = defineTool<SlugToolInput>({
  name: SLUG_TOOL_NAME,
  description:
    'Convert an arbitrary string into a constrained identifier. ' +
    'Three strictness tiers via `action`: ' +
    "`slugify` produces a URL-safe slug (default strict ASCII [a-z0-9] + " +
    "separator; pass `unicode:true` to keep accented Latin / CJK; " +
    "options: `separator`, `lower`, `strict`, `unicode`, `maxLength`); " +
    "`safeFilename` produces a cross-platform filename — strips " +
    "Windows+POSIX forbidden chars `/ \\ : * ? \" < > |` plus C0 controls, " +
    "preserves case, dots, underscores, and (by default) the trailing " +
    ".ext (options: `replacement`, `preserveExtension`, `maxLength`); " +
    "`safeBranchName` produces a git-ref-format-clean branch name — drops " +
    "`..`, `~`, `^`, `:`, `?`, `*`, `[`, `\\`, leading `-`/`.`/`/`, " +
    "trailing `.lock`, etc. (options: `replacement`, `maxLength`). " +
    'All actions are pure — no IO, parallel-safe.',
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['slugify', 'safeFilename', 'safeBranchName'],
        description:
          'Which strictness tier to run. `slugify` -> URL slug; ' +
          '`safeFilename` -> cross-platform filename; ' +
          '`safeBranchName` -> git ref name. All require `text`.',
      },
      text: {
        type: 'string',
        description:
          'Input text to convert. Empty input returns empty output ' +
          '(callers needing a non-empty fallback must supply one).',
      },
      separator: {
        type: 'string',
        description:
          "action='slugify': single character used to join kept words. " +
          "Default '-'. Must be exactly one character (multi-char " +
          "separators would collide with the collapse pass).",
        minLength: 1,
      },
      lower: {
        type: 'boolean',
        description:
          "action='slugify': lower-case the output. Default true. Only " +
          "meaningful when `unicode:true`; strict ASCII path always " +
          "produces lowercase.",
      },
      strict: {
        type: 'boolean',
        description:
          "action='slugify': strict ASCII slug. Default true. When false, " +
          "the looser reject set keeps `.`, `_`, etc. Ignored when " +
          "`unicode:true` is set.",
      },
      unicode: {
        type: 'boolean',
        description:
          "action='slugify': preserve Unicode letters/digits (\\p{L} / " +
          "\\p{N}). Default false. When true, 'café résumé' survives as " +
          "'café-résumé'; CJK and Cyrillic survive too.",
      },
      replacement: {
        type: 'string',
        description:
          "action='safeFilename' (default '_') / 'safeBranchName' " +
          "(default '-'): single character used to replace forbidden " +
          "bytes. For safeBranchName, must be a git-safe char [A-Za-z0-9_.-].",
        minLength: 1,
      },
      preserveExtension: {
        type: 'boolean',
        description:
          "action='safeFilename': preserve the trailing '.ext' and only " +
          "sanitize the stem. Default true.",
      },
      maxLength: {
        type: 'number',
        description:
          'Maximum total length of the result. Each action applies its ' +
          "own default if omitted (slugify -> Infinity, safeFilename -> " +
          '255, safeBranchName -> 200). Must be a positive number.',
        exclusiveMinimum: 0,
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'slug', 'text', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'slug',
    'slugify',
    'filename',
    'branch',
    'safe',
    'sanitize',
    'identifier',
    'url',
    'ref',
  ],
  aliases: ['slugify', 'safe_name', 'sanitize'],
  async run(input: SlugToolInput, _ctx: ToolContext): Promise<ToolResult> {
    // ── basic shape check ─────────────────────────────────────────────
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
    if (!VALID_ACTIONS.has(action as SlugToolAction)) {
      return errorResult(
        `unknown action '${action}'. Valid: slugify, safeFilename, safeBranchName.`,
      )
    }

    // ── shared validation: text ───────────────────────────────────────
    if (typeof input.text !== 'string') {
      return errorResult(
        `'text' must be a string (got ${typeof input.text}).`,
      )
    }

    // ── shared validation: maxLength (when provided) ──────────────────
    if (input.maxLength !== undefined) {
      const m = requirePositiveNumber(input.maxLength, 'maxLength')
      if (!m.ok) {
        return errorResult(m.error)
      }
    }

    // ── per-action option validation ──────────────────────────────────
    switch (action as SlugToolAction) {
      case 'slugify': {
        if (input.separator !== undefined) {
          if (typeof input.separator !== 'string') {
            return errorResult(
              `action='slugify': 'separator' must be a string (got ${typeof input.separator}).`,
            )
          }
          if (input.separator.length === 0) {
            return errorResult(
              `action='slugify': 'separator' must be a non-empty string.`,
            )
          }
        }
        if (input.lower !== undefined && typeof input.lower !== 'boolean') {
          return errorResult(
            `action='slugify': 'lower' must be a boolean (got ${typeof input.lower}).`,
          )
        }
        if (
          input.strict !== undefined &&
          typeof input.strict !== 'boolean'
        ) {
          return errorResult(
            `action='slugify': 'strict' must be a boolean (got ${typeof input.strict}).`,
          )
        }
        if (
          input.unicode !== undefined &&
          typeof input.unicode !== 'boolean'
        ) {
          return errorResult(
            `action='slugify': 'unicode' must be a boolean (got ${typeof input.unicode}).`,
          )
        }
        break
      }
      case 'safeFilename': {
        if (input.replacement !== undefined) {
          if (typeof input.replacement !== 'string') {
            return errorResult(
              `action='safeFilename': 'replacement' must be a string (got ${typeof input.replacement}).`,
            )
          }
          if (input.replacement.length === 0) {
            return errorResult(
              `action='safeFilename': 'replacement' must be a non-empty string.`,
            )
          }
        }
        if (
          input.preserveExtension !== undefined &&
          typeof input.preserveExtension !== 'boolean'
        ) {
          return errorResult(
            `action='safeFilename': 'preserveExtension' must be a boolean (got ${typeof input.preserveExtension}).`,
          )
        }
        break
      }
      case 'safeBranchName': {
        if (input.replacement !== undefined) {
          if (typeof input.replacement !== 'string') {
            return errorResult(
              `action='safeBranchName': 'replacement' must be a string (got ${typeof input.replacement}).`,
            )
          }
          if (input.replacement.length === 0) {
            return errorResult(
              `action='safeBranchName': 'replacement' must be a non-empty string.`,
            )
          }
        }
        break
      }
    }

    // ── delegate to the pure helper ──────────────────────────────────
    try {
      const payload = runSlugTool(input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`action='${action}' failed: ${msg}`)
    }
  },
})
