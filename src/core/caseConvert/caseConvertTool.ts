// src/core/caseConvert/caseConvertTool.ts
//
// CaseConvertTool — agent-facing tool wrapping the pure `caseConvert.ts`
// helpers into a single discriminated-action surface.
//
// Why a tool? `caseConvert.ts` exposes seven converters plus `detectCase`
// and `splitWords` as pure-logic library code. Without a tool wrapper the
// agent has to either hand-roll a "convert this identifier" regex in
// chat (different acronym rules every time — `parseHTTPResponse` ends up
// as `parse-h-t-t-p-response` or `parse-http-response` depending on what
// the model invented this round) or shell out (no acronym preservation,
// locale-blind tr/sed). Exposing the helpers as one tool gives the model
// a deterministic, idempotent "re-case this token" primitive with the
// same acronym semantics every Nuka subsystem already uses.
//
// One Tool with `action`, not nine narrow ones: same trade-off as
// SlugTool / WhitespaceTool / TextStatsTool. The seven converters share
// the same domain (string in, string out) and option vocabulary
// (`preserveAcronyms`, `locale`). `detect` / `split` return a slightly
// different shape but slot under the same conceptual umbrella — "what is
// this token shaped like, and how do I split or re-shape it." JSON
// Schema doesn't model proper discriminated unions across action
// variants, so we declare `action` as an enum and validate cross-field
// requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'camel'    requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'pascal'   requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'kebab'    requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'snake'    requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'constant' requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'title'    requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'lower'    requires `text`     optional `preserveAcronyms`, `locale`
//   action: 'detect'   requires `text`
//   action: 'split'    requires `text`     optional `preserveAcronyms`
//
// Output: each action returns a tagged structured payload (see
// CaseConvertToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.
//
// Per-action extras worth surfacing alongside `result`:
//
//  - converter actions (`camel`/`pascal`/.../`lower`): include
//    `detectedSourceCase` — the result of running `detectCase` on the
//    raw input. Cheap (single linear scan) and the model often wants to
//    know "was the source already kebab" without a separate round-trip.
//
// `detect` returns `{ style }`; `split` returns `{ words }`.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  detectCase,
  splitWords,
  toCamelCase,
  toConstantCase,
  toKebabCase,
  toLowerCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
  type CaseOptions,
  type CaseStyle,
} from './caseConvert'

export const CASE_CONVERT_TOOL_NAME = 'CaseConvert'

/** Allowed `action` discriminator values. */
export type CaseConvertAction =
  | 'camel'
  | 'pascal'
  | 'kebab'
  | 'snake'
  | 'constant'
  | 'title'
  | 'lower'
  | 'detect'
  | 'split'

/**
 * Actions that produce a re-cased string (and thus accept the shared
 * `preserveAcronyms` / `locale` options). Used as the discriminant for
 * the validation branch below.
 */
const CONVERTER_ACTIONS: ReadonlySet<CaseConvertAction> = new Set([
  'camel',
  'pascal',
  'kebab',
  'snake',
  'constant',
  'title',
  'lower',
])

export type CaseConvertToolInput = {
  action: CaseConvertAction
  /** Required for every action. */
  text: string
  /**
   * Treat a run of consecutive uppercase letters (followed by another
   * uppercase or a digit) as a single word. Only consulted by converter
   * actions and `split`. Defaults to `true`.
   */
  preserveAcronyms?: boolean
  /**
   * Locale tag passed through to `toLocaleLowerCase` / `toLocaleUpperCase`.
   * Only consulted by converter actions. Defaults to `undefined` (invariant
   * case mapping).
   */
  locale?: string
}

/** Tagged result payload per action. */
export type CaseConvertToolResult =
  | {
      action: 'camel' | 'pascal' | 'kebab' | 'snake' | 'constant' | 'title' | 'lower'
      result: string
      detectedSourceCase: CaseStyle
    }
  | { action: 'detect'; style: CaseStyle }
  | { action: 'split'; words: string[] }

const VALID_ACTIONS: ReadonlySet<CaseConvertAction> = new Set([
  'camel',
  'pascal',
  'kebab',
  'snake',
  'constant',
  'title',
  'lower',
  'detect',
  'split',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `CaseConvert: ${msg}` }
}

/**
 * Build the `CaseOptions` object the underlying helpers expect from the
 * tool-level input. `locale` is `string | readonly string[]` at the lib
 * boundary; the tool only accepts a single string for schema simplicity
 * (the `Intl` APIs accept a single locale tag fine).
 */
function buildOpts(input: CaseConvertToolInput): CaseOptions {
  const opts: CaseOptions = {}
  if (input.preserveAcronyms !== undefined) {
    opts.preserveAcronyms = input.preserveAcronyms
  }
  if (input.locale !== undefined) {
    opts.locale = input.locale
  }
  return opts
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, option types)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runCaseConvertTool(
  input: CaseConvertToolInput,
): CaseConvertToolResult {
  switch (input.action) {
    case 'camel': {
      const opts = buildOpts(input)
      return {
        action: 'camel',
        result: toCamelCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'pascal': {
      const opts = buildOpts(input)
      return {
        action: 'pascal',
        result: toPascalCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'kebab': {
      const opts = buildOpts(input)
      return {
        action: 'kebab',
        result: toKebabCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'snake': {
      const opts = buildOpts(input)
      return {
        action: 'snake',
        result: toSnakeCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'constant': {
      const opts = buildOpts(input)
      return {
        action: 'constant',
        result: toConstantCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'title': {
      const opts = buildOpts(input)
      return {
        action: 'title',
        result: toTitleCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'lower': {
      const opts = buildOpts(input)
      return {
        action: 'lower',
        result: toLowerCase(input.text, opts),
        detectedSourceCase: detectCase(input.text),
      }
    }
    case 'detect': {
      return { action: 'detect', style: detectCase(input.text) }
    }
    case 'split': {
      const opts = buildOpts(input)
      return { action: 'split', words: splitWords(input.text, opts) }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const CaseConvertTool: Tool<CaseConvertToolInput> =
  defineTool<CaseConvertToolInput>({
    name: CASE_CONVERT_TOOL_NAME,
    description:
      'Convert an identifier-like string between common case conventions. ' +
      'Pure, idempotent on its own form, no IO. Pick `action`: ' +
      '`camel` -> helloWorld; `pascal` -> HelloWorld; `kebab` -> hello-world; ' +
      '`snake` -> hello_world; `constant` -> HELLO_WORLD; ' +
      "`title` -> 'Hello World'; `lower` -> 'hello world'. Each converter " +
      'returns `{ result, detectedSourceCase }` so the caller can see what ' +
      'shape the input arrived in. ' +
      '`detect` returns `{ style }` where style is one of camel/pascal/' +
      'kebab/snake/constant/title/lower/mixed/unknown. ' +
      '`split` returns `{ words }` — the constituent words of the input, ' +
      'with case preserved (downstream converters re-case as needed). ' +
      'Acronyms: with `preserveAcronyms:true` (default), a run of ' +
      'consecutive uppercase letters is treated as one word unless ' +
      'followed by ≥2 lowercase letters — `parseHTTPResponse` splits as ' +
      "['parse','HTTP','Response'] and re-emits as parse-http-response. " +
      'With `preserveAcronyms:false`, every uppercase letter starts a new ' +
      "word. Note: converting *into* camel/pascal lower-cases the rest of " +
      'each word, so `parseHTTPResponse` -> camel returns ' +
      "`parseHttpResponse` (we have no metadata in the canonicalized form " +
      'to recover which segments were acronyms). ' +
      'Pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action', 'text'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'camel',
            'pascal',
            'kebab',
            'snake',
            'constant',
            'title',
            'lower',
            'detect',
            'split',
          ],
          description:
            'Which case transform / inspection to run. The seven case ' +
            'converters return `{ result, detectedSourceCase }`; `detect` ' +
            'returns `{ style }`; `split` returns `{ words }`. All require ' +
            '`text`.',
        },
        text: {
          type: 'string',
          description:
            'Input text. Empty string is allowed — converter actions ' +
            'return `result: ""`, `detect` returns `style: "unknown"`, ' +
            '`split` returns `words: []`.',
        },
        preserveAcronyms: {
          type: 'boolean',
          description:
            'Only consulted by converter actions and `split`. When true ' +
            '(default), a run of consecutive uppercase letters is treated ' +
            'as a single word unless followed by ≥2 lowercase letters — so ' +
            "`HTTPServer` splits as ['HTTP','Server'] and `parseURLs` as " +
            "['parse','URLs']. When false, every uppercase letter starts " +
            'a new word.',
        },
        locale: {
          type: 'string',
          description:
            'Only consulted by converter actions. BCP-47 locale tag (e.g. ' +
            "`'tr-TR'`) passed to `toLocaleLowerCase` / `toLocaleUpperCase`. " +
            'Use when you need locale-sensitive case mappings (Turkish ' +
            'dotted/dotless i, etc.). Defaults to invariant case mapping.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'caseConvert', 'text', 'format'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'case',
      'caseConvert',
      'camel',
      'pascal',
      'kebab',
      'snake',
      'constant',
      'title',
      'identifier',
      'rename',
      'splitWords',
      'detectCase',
    ],
    aliases: ['case_convert', 'rename_case', 'recase'],
    async run(
      input: CaseConvertToolInput,
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
      if (!VALID_ACTIONS.has(action as CaseConvertAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: camel, pascal, kebab, snake, ` +
            `constant, title, lower, detect, split.`,
        )
      }

      // ── shared validation: text ───────────────────────────────────────
      if (typeof input.text !== 'string') {
        return errorResult(
          `'text' must be a string (got ${typeof input.text}).`,
        )
      }

      // ── per-action option validation ──────────────────────────────────
      // `preserveAcronyms` and `locale` are ignored by `detect`; the
      // helpers tolerate extra keys, but we still type-check anything the
      // caller passed so a buggy producer can't slip a wrong-typed value
      // past us.
      if (
        input.preserveAcronyms !== undefined &&
        typeof input.preserveAcronyms !== 'boolean'
      ) {
        return errorResult(
          `'preserveAcronyms' must be a boolean (got ${typeof input.preserveAcronyms}).`,
        )
      }
      if (input.locale !== undefined) {
        if (typeof input.locale !== 'string') {
          return errorResult(
            `'locale' must be a string (got ${typeof input.locale}).`,
          )
        }
        if (input.locale.length === 0) {
          return errorResult(`'locale' must be a non-empty string.`)
        }
      }

      // `detect` doesn't consult `preserveAcronyms` or `locale`. We accept
      // them silently rather than reject — the agent shouldn't be punished
      // for passing the shared option vocabulary uniformly.
      void CONVERTER_ACTIONS

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runCaseConvertTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
