// src/core/urlExtract/urlExtractTool.ts
//
// UrlExtractTool — agent-facing tool wrapping the pure `urlExtract.ts`
// helpers into a single discriminated-action surface.
//
// Why a tool? `urlExtract.ts` exposes a prose-aware URL scanner that
// can pull URLs out of arbitrary text, validate whether something is
// a URL, and extract markdown links. Without this wrapper the agent
// is stuck either hand-rolling regexes (different "what's a URL"
// definition every time — exactly the trap Nuka-Code's scattered
// `isUrl` checks used to fall into) or shelling out to `grep -oE`
// (no trailing-punct trimming, no markdown-link awareness, no
// balanced-paren handling). Surfacing the library as one tool gives
// the model a deterministic, kind-aware, prose-tolerant "find the
// URLs in this" primitive.
//
// One Tool with `action`, not three narrow ones: same trade-off as
// SlugTool / TextStatsTool. The three helpers share the same domain
// (string → URL-shaped data) and overlap on the input vocabulary;
// bundling them keeps the registry uncluttered. JSON Schema doesn't
// model proper discriminated unions across action variants, so we
// declare `action` as an enum and validate cross-field requirements
// at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'extract'              requires `text`
//                                  optional `kinds`, `includeBareDomain`
//   action: 'isUrl'                requires `text`
//   action: 'extractMarkdownLinks' requires `text`
//
// Output mapping: the underlying `MarkdownLink.style` (inline|reference)
// is surfaced through the tool as `type` to match the public Tool
// contract; everything else is forwarded verbatim.
//
// Output: each action returns a tagged structured payload (see
// UrlExtractToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  extractMarkdownLinks,
  extractUrls,
  isUrl,
  type ExtractUrlOptions,
  type MarkdownLink,
  type UrlKind,
  type UrlMatch,
} from './urlExtract'

export const URL_EXTRACT_TOOL_NAME = 'UrlExtract'

/** Allowed `action` discriminator values. */
export type UrlExtractAction = 'extract' | 'isUrl' | 'extractMarkdownLinks'

/** Allowed `kinds` filter values — mirrors {@link UrlKind}. */
const VALID_KINDS: ReadonlySet<UrlKind> = new Set<UrlKind>([
  'http',
  'ftp',
  'mailto',
  'file',
  'bare-domain',
])

const VALID_ACTIONS: ReadonlySet<UrlExtractAction> = new Set([
  'extract',
  'isUrl',
  'extractMarkdownLinks',
])

export type UrlExtractToolInput = {
  action: UrlExtractAction
  /** Required for every action. */
  text: string
  /**
   * `action='extract'`: restrict the scan to these kinds. Defaults to
   * the underlying module's default (`['http', 'ftp', 'mailto']`).
   */
  kinds?: ReadonlyArray<UrlKind>
  /**
   * `action='extract'`: shorthand for adding `'bare-domain'` to the
   * kinds set so schemeless hostnames also fire. Defaults to `false`.
   */
  includeBareDomain?: boolean
}

/**
 * Tool-facing markdown link shape. Mirrors {@link MarkdownLink} but
 * renames `style` → `type` so the public contract matches the
 * documented schema. We do not re-export {@link MarkdownLink} from
 * here; consumers that need the raw module type can import it from
 * the urlExtract barrel.
 */
export interface UrlExtractMarkdownLink {
  /** The visible text (for inline links) or reference label. */
  text: string
  /** The link target URL. */
  url: string
  /** Start offset of the whole construct. */
  start: number
  /** Exclusive end offset of the whole construct. */
  end: number
  /** Inline `[t](u)` vs reference-style `[ref]: u`. */
  type: 'inline' | 'reference'
}

/** Tagged result payload per action. */
export type UrlExtractToolResult =
  | { action: 'extract'; urls: UrlMatch[]; count: number }
  | { action: 'isUrl'; isUrl: boolean; text: string }
  | {
      action: 'extractMarkdownLinks'
      links: UrlExtractMarkdownLink[]
      count: number
    }

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `UrlExtract: ${msg}` }
}

/**
 * Convert the module's `MarkdownLink` (which uses `style`) into the
 * tool-facing shape (which uses `type`). Single-purpose mapping so
 * the rest of the file can stay focused on validation/dispatch.
 */
function toToolMarkdownLink(link: MarkdownLink): UrlExtractMarkdownLink {
  return {
    text: link.text,
    url: link.url,
    start: link.start,
    end: link.end,
    type: link.style,
  }
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, option ranges)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runUrlExtractTool(
  input: UrlExtractToolInput,
): UrlExtractToolResult {
  switch (input.action) {
    case 'extract': {
      const opts: ExtractUrlOptions = {}
      if (input.kinds !== undefined) opts.kinds = input.kinds
      if (input.includeBareDomain !== undefined) {
        opts.includeBareDomain = input.includeBareDomain
      }
      const urls = extractUrls(input.text, opts)
      return { action: 'extract', urls, count: urls.length }
    }
    case 'isUrl': {
      return { action: 'isUrl', isUrl: isUrl(input.text), text: input.text }
    }
    case 'extractMarkdownLinks': {
      const links = extractMarkdownLinks(input.text).map(toToolMarkdownLink)
      return { action: 'extractMarkdownLinks', links, count: links.length }
    }
    default: {
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const UrlExtractTool: Tool<UrlExtractToolInput> =
  defineTool<UrlExtractToolInput>({
    name: URL_EXTRACT_TOOL_NAME,
    description:
      'Scan arbitrary text for URLs / markdown links. Pure, prose-tolerant. ' +
      'Pick `action`: ' +
      "`extract` returns every URL hit in source order with " +
      '`{ url, start, end, kind, inMarkdownLink? }` records ' +
      "(kinds: http, ftp, mailto, file, bare-domain; trailing prose " +
      "punctuation trimmed, balanced parens respected, emails detected " +
      'as `mailto`); options: `kinds` (filter), `includeBareDomain`. ' +
      "`isUrl` returns a boolean — does `text` contain at least one URL " +
      "of the default kinds? " +
      "`extractMarkdownLinks` parses `[text](url)` and `[ref]: url` " +
      'constructs into `{ text, url, start, end, type }` records. ' +
      'All actions are pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action', 'text'],
      properties: {
        action: {
          type: 'string',
          enum: ['extract', 'isUrl', 'extractMarkdownLinks'],
          description:
            'Which scan to run. `extract` returns every URL; `isUrl` ' +
            'returns a boolean; `extractMarkdownLinks` returns parsed ' +
            'markdown link records. All require `text`.',
        },
        text: {
          type: 'string',
          description:
            'Input text to scan. Empty string is allowed (returns an ' +
            'empty list / false).',
        },
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['http', 'ftp', 'mailto', 'file', 'bare-domain'],
          },
          description:
            "action='extract': restrict the scan to these kinds. " +
            "Defaults to ['http', 'ftp', 'mailto']. Pass " +
            "'bare-domain' to pick up schemeless hosts; pass 'file' " +
            "to pick up file:// URIs.",
        },
        includeBareDomain: {
          type: 'boolean',
          description:
            "action='extract': shorthand for adding 'bare-domain' to " +
            '`kinds` so schemeless hostnames like `example.com` also ' +
            'fire. Defaults to false.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'urlExtract', 'url', 'text'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'url',
      'urls',
      'link',
      'links',
      'extract',
      'markdown',
      'isUrl',
      'mailto',
      'email',
      'ftp',
      'http',
      'https',
      'domain',
    ],
    aliases: ['url_extract', 'extract_urls', 'find_urls'],
    async run(
      input: UrlExtractToolInput,
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
      if (!VALID_ACTIONS.has(action as UrlExtractAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: extract, isUrl, extractMarkdownLinks.`,
        )
      }

      // ── shared validation: text ───────────────────────────────────────
      if (typeof input.text !== 'string') {
        return errorResult(
          `'text' must be a string (got ${typeof input.text}).`,
        )
      }

      // ── per-action option validation ──────────────────────────────────
      switch (action as UrlExtractAction) {
        case 'extract': {
          if (input.kinds !== undefined) {
            if (!Array.isArray(input.kinds)) {
              return errorResult(
                `action='extract': 'kinds' must be an array (got ${typeof input.kinds}).`,
              )
            }
            for (const k of input.kinds) {
              if (typeof k !== 'string') {
                return errorResult(
                  `action='extract': 'kinds' entries must be strings (got ${typeof k}).`,
                )
              }
              if (!VALID_KINDS.has(k as UrlKind)) {
                return errorResult(
                  `action='extract': unknown kind '${k}'. Valid: http, ftp, mailto, file, bare-domain.`,
                )
              }
            }
          }
          if (
            input.includeBareDomain !== undefined &&
            typeof input.includeBareDomain !== 'boolean'
          ) {
            return errorResult(
              `action='extract': 'includeBareDomain' must be a boolean (got ${typeof input.includeBareDomain}).`,
            )
          }
          break
        }
        case 'isUrl':
        case 'extractMarkdownLinks':
          // No additional options.
          break
      }

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runUrlExtractTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
