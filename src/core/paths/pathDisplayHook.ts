// src/core/paths/pathDisplayHook.ts
//
// `afterToolCall` hook that post-processes a tool's surfaced text output by
// rewriting absolute filesystem paths into human-readable form via
// `displayPath()` (tildify + cwd-relativise + middle-truncate). Designed
// for opt-in registration alongside `auto-truncate` and the recent-files
// touch handler — see `cli.tsx`.
//
// Why a hook and not direct tool changes:
//
//   The existing tool registry has many tools that emit text containing
//   absolute paths (Bash output, Grep matches, Read line-prefixes, etc.).
//   Patching each tool to call `displayPath` would be invasive and would
//   not catch paths embedded in arbitrary stdout that the tool simply
//   copies through. A single afterToolCall hook gives uniform coverage
//   for free, governed by one configuration knob.
//
// Why opt-in (env var):
//
//   Rewriting paths inside tool output is a user-visible behaviour change.
//   Some workflows (CI logs, mechanical diff comparison) expect paths to
//   come out verbatim. The hook is wired in `cli.tsx` only when
//   `NUKA_PATH_DISPLAY_HOOK=1` so the default behaviour is unchanged.
//
// Conservative rules baked into the regex + filter:
//
//   * Only scan STRING outputs. `ContentBlock[]` outputs already encode
//     structure; rewriting bytes inside them could corrupt JSON payloads.
//   * Match POSIX absolute paths (`/Users/foo/...`, `/tmp/...`) plus the
//     Windows drive-letter form (`C:\\...`). Bare `~/` prefixes are
//     considered "already humanised" and skipped to avoid double-rewrite.
//   * Reject candidates that sit inside a JSON-encoded string literal
//     (i.e. preceded by `"` and followed by `"` on the same line) — those
//     are typically structured payloads where a textual swap could break
//     downstream parsers.
//   * Leave error results alone. The auto-truncate hook does the same:
//     debugging error text is where path provenance matters most, and we
//     don't want to surprise downstream log scrapers.
//   * If no rewrite actually changes the string, return `{}` (no churn —
//     the registry / wrapper short-circuit on an empty result).

import type { HookHandler } from '../hooks/events'
import type { ToolResult } from '../tools/types'
import { displayPath } from './pathDisplay'
import { homedir } from 'node:os'

/**
 * Behavioural options for {@link createPathDisplayHandler}.
 */
export interface PathDisplayHookConfig {
  /**
   * Tool names to apply pathDisplay to. When omitted, the hook runs for
   * every afterToolCall event regardless of toolName. When set, the
   * handler passes through (returns `{}`) for any tool not in the list.
   */
  toolNames?: ReadonlyArray<string>
  /**
   * cwd to compute relative paths against. Defaults to `process.cwd()`.
   * Captured at handler-construction time (NOT at each invocation) so
   * registry consumers can pre-bind a stable display root that survives
   * later `chdir` calls inside the agent.
   */
  cwd?: string
  /**
   * Home dir for `~/` prefix. Defaults to `os.homedir()`. Captured at
   * handler-construction time, same rationale as `cwd`.
   */
  home?: string
  /**
   * Skip rewriting if a candidate substring is shorter than this. Stops
   * us from rewriting trivial mentions like `/a` or `/b/c`. Default 8
   * (so `/etc/foo` survives but `/a/b` does not). Set to `0` to apply
   * rewriting to every absolute-path-like substring.
   */
  minPathLength?: number
}

/** Default minimum length for a candidate substring to be rewritten. */
export const DEFAULT_PATH_DISPLAY_HOOK_MIN_LENGTH = 8

/**
 * Match POSIX absolute paths and Windows drive paths within text. The
 * regex is intentionally generous about path characters (letters,
 * digits, `_`, `-`, `.`, `/`, `\\`) so it captures multi-segment paths
 * but stops at whitespace, quotes, parens, and other obvious delimiters.
 * The result is then filtered by `minPathLength` and the "inside JSON"
 * heuristic before any rewrite is applied.
 *
 * Capture group is non-greedy so adjacent paths don't get glued.
 */
const ABSOLUTE_PATH_REGEX =
  /(?:[A-Za-z]:[\\/][A-Za-z0-9_\-./\\]+|\/[A-Za-z0-9_\-./]+(?:\/[A-Za-z0-9_\-./]+)*)/g

/**
 * Internal type guard mirroring the one in `wrapTool.ts` / `autoTruncateHook`.
 * We narrow `payload.result` defensively rather than asserting any shape;
 * the registry payload type is opaque (`Readonly<Record<string, unknown>>`).
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}

/**
 * Heuristic: is the candidate at `index..end` likely embedded in a JSON
 * string literal on the surrounding line? We scan the line for an
 * unescaped `"` before and after the match. This is a conservative
 * approximation — JSON literals usually appear on a single line in tool
 * output (compact JSON, jq output, stringified Errors), and any false
 * positive simply means we leave a path unrewritten (the safer failure
 * mode for this hook).
 */
function looksLikeJsonString(line: string, matchStart: number, matchEnd: number): boolean {
  // Count unescaped double-quotes before the match. An odd count means
  // we are inside a string literal at the match start.
  let count = 0
  for (let i = 0; i < matchStart; i++) {
    if (line[i] === '"' && line[i - 1] !== '\\') count++
  }
  if (count % 2 === 0) return false
  // And confirm a closing quote appears after the match on the same line.
  for (let i = matchEnd; i < line.length; i++) {
    if (line[i] === '"' && line[i - 1] !== '\\') return true
  }
  return false
}

/**
 * Apply `displayPath` to every absolute-path substring in `text`. Returns
 * the (possibly rewritten) string plus a flag indicating whether any
 * replacement actually occurred. We need the flag because string compare
 * alone wouldn't distinguish "no candidates" from "candidates all
 * untouched by displayPath" — same observable, but a `false` here lets
 * the hook short-circuit the surrounding payload.
 */
function rewritePathsInText(
  text: string,
  cwd: string,
  home: string,
  minPathLength: number,
): { rewritten: string; changed: boolean } {
  let changed = false
  // Rewrite line-by-line so the JSON-string heuristic has a bounded
  // window. Most tool outputs are newline-delimited so this is cheap
  // and avoids quote-scanning across megabyte payloads.
  const lines = text.split('\n')
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    if (line === undefined || line.length === 0) continue
    if (!line.includes('/') && !line.includes('\\')) continue

    // Reset regex state per line (global flag is stateful).
    ABSOLUTE_PATH_REGEX.lastIndex = 0
    let lineChanged = false
    const rewrittenLine = line.replace(ABSOLUTE_PATH_REGEX, (match, _offset) => {
      // Reject too-short candidates.
      if (match.length < minPathLength) return match
      // Reject if it already looks humanised (`~/...`).
      if (match.startsWith('~/') || match.startsWith('~\\')) return match
      // Compute offset for JSON heuristic — replace() passes the offset
      // as the second argument when no capture groups consume it.
      const offset =
        typeof _offset === 'number' ? _offset : line.indexOf(match)
      if (looksLikeJsonString(line, offset, offset + match.length)) {
        return match
      }
      // Strip a trailing punctuation char (`,`, `.`, `:`, `;`, `)`) so
      // sentence-final paths get rewritten cleanly. We only peel ONE
      // char — multi-char tails like `)).` aren't worth the complexity
      // and won't break anything (the path is still recognisable).
      let trailing = ''
      let core = match
      const last = core.charCodeAt(core.length - 1)
      // ASCII for ),.,:,;
      if (last === 41 || last === 44 || last === 46 || last === 58 || last === 59) {
        trailing = core.slice(-1)
        core = core.slice(0, -1)
      }
      if (core.length < minPathLength) return match
      const formatted = displayPath(core, { cwd, home })
      if (formatted === core) return match
      lineChanged = true
      return formatted + trailing
    })
    if (lineChanged) {
      changed = true
      lines[lineIdx] = rewrittenLine
    }
  }
  if (!changed) return { rewritten: text, changed: false }
  return { rewritten: lines.join('\n'), changed: true }
}

/**
 * Build an `afterToolCall` handler that rewrites absolute paths in
 * STRING tool output via `displayPath`. The handler is registered on
 * the host {@link HookRegistry}; the wrapTool integration honours its
 * `data.replaceResult` payload (see `core/hooks/wrapTool.ts` step 4a).
 *
 * Behaviour, per call:
 *
 *   * `payload` missing, or `payload.result` not a ToolResult → no-op
 *     (`return {}`).
 *   * `config.toolNames` set and `ctx.toolName` not in the list → no-op.
 *   * `result.isError === true` → no-op. Error text is left intact so
 *     debug context (and downstream log scrapers) survive verbatim.
 *   * `result.output` is `ContentBlock[]` rather than string → no-op.
 *     Block-array path is left to a future iter (would need per-block
 *     text/source rewriting that isn't worth coupling here).
 *   * Rewriting produces no net change → no-op (avoid churn).
 *   * Otherwise → `{ data: { replaceResult: { ...result, output: rewritten } } }`.
 *
 * The handler never throws synchronously for ordinary inputs. If it
 * ever did (a defensive regex run for example), the pipeline's
 * per-handler try/catch would isolate it.
 */
export function createPathDisplayHandler(
  config: PathDisplayHookConfig = {},
): HookHandler {
  const cwd = config.cwd ?? process.cwd()
  const home = config.home ?? homedir()
  const minPathLength =
    config.minPathLength ?? DEFAULT_PATH_DISPLAY_HOOK_MIN_LENGTH
  const toolNames = config.toolNames
    ? new Set(config.toolNames)
    : undefined

  return (ctx) => {
    // Filter by tool-name allow-list when one is configured.
    if (toolNames !== undefined) {
      const toolName = ctx.toolName
      if (toolName === undefined) return {}
      if (!toolNames.has(toolName)) return {}
    }

    const payload = ctx.payload
    if (payload === undefined) return {}

    const candidate = payload.result
    if (!isToolResult(candidate)) return {}

    // Skip error outputs — see file comment.
    if (candidate.isError) return {}

    const output = candidate.output
    if (typeof output !== 'string') return {}
    if (output.length === 0) return {}

    const { rewritten, changed } = rewritePathsInText(
      output,
      cwd,
      home,
      minPathLength,
    )
    if (!changed) return {}

    const replacement: ToolResult = {
      output: rewritten,
      isError: candidate.isError,
    }
    return {
      data: {
        replaceResult: replacement,
        pathDisplay: {
          originalLength: output.length,
          rewrittenLength: rewritten.length,
        },
      },
    }
  }
}
