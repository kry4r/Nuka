// src/core/diff/format.ts
//
// Unified-diff formatting helpers. Wraps the `diff` package's
// `structuredPatch` / `createPatch` / `createTwoFilesPatch` primitives
// behind small, side-effect-free seams that match Nuka's surface.
//
// Differences from upstream (Nuka-Code `src/utils/diff.ts`):
//
//   1. No analytics, no cost-tracker, no LOC counter. Upstream embeds
//      `logEvent('tengu_file_changed', ...)` and `addToTotalLinesChanged`
//      directly inside the format/count helpers. That coupling is what
//      kept this module out of Nuka up to now. The port here separates
//      the pure formatter from any caller-side accounting (callers can
//      pass `countLinesChanged()` output into their own counters).
//
//   2. The ampersand/dollar escape dance from upstream is preserved —
//      JsDiff's word-level tokenization can mis-handle `&` / `$` runs in
//      certain inputs, and upstream worked around this by swapping them
//      for sentinel tokens around the call. Keeping the same workaround
//      here matches the upstream output byte-for-byte for the same input.
//
//   3. `formatUnifiedDiff` is the "give me a diff string" entry point —
//      it's `createPatch` with the same defaults Nuka-Code uses
//      (3 lines of context, 5s timeout). Returns '' (not undefined)
//      when no changes are present, so callers can treat the absence of
//      diff as "no diff text to show".
//
//   4. `getHunksFromContents` returns the structured hunks directly,
//      mirroring upstream's `getPatchFromContents`. Useful when the
//      caller wants to render diffs themselves (e.g. ink components)
//      rather than emitting plain unified-diff text.
//
//   5. `adjustHunkLineNumbers` is ported as-is — same shape, same
//      semantics. Used by callers that diffed a slice of a file and now
//      need to translate hunk line numbers back to the whole-file frame
//      of reference.
//
// Side-effects: none. Pure transformations over input strings.

import {
  createPatch,
  createTwoFilesPatch,
  structuredPatch,
  type StructuredPatchHunk,
} from 'diff'

export const DEFAULT_CONTEXT_LINES = 3
export const DEFAULT_DIFF_TIMEOUT_MS = 5_000

// JsDiff's word-level tokenizer can produce surprising results when
// inputs contain bare `&` or `$` characters (the latter participates in
// regex replacement). Substitute them for sentinel strings around the
// diff call and swap them back afterwards — same trick upstream uses.
const AMPERSAND_TOKEN = '<<:AMPERSAND_TOKEN:>>'
const DOLLAR_TOKEN = '<<:DOLLAR_TOKEN:>>'

function escapeForDiff(s: string): string {
  return s.replaceAll('&', AMPERSAND_TOKEN).replaceAll('$', DOLLAR_TOKEN)
}

function unescapeFromDiff(s: string): string {
  return s.replaceAll(AMPERSAND_TOKEN, '&').replaceAll(DOLLAR_TOKEN, '$')
}

export type FormatUnifiedDiffOptions = {
  /** Path/label printed in the diff header (both sides). Defaults to "file". */
  filename?: string
  /** Lines of context around each hunk. Default 3. */
  contextLines?: number
  /** Abort diffing after this many ms. Default 5000. */
  timeoutMs?: number
  /** Treat lines as equal even if their leading/trailing whitespace differs. */
  ignoreWhitespace?: boolean
}

/**
 * Compute the unified-diff text between two strings.
 *
 * Returns the unified-diff text exactly as produced by `diff`'s
 * `createPatch`, with the ampersand/dollar workaround applied. If the
 * underlying diff times out, returns an empty string rather than
 * surfacing `undefined`.
 */
export function formatUnifiedDiff(
  before: string,
  after: string,
  options: FormatUnifiedDiffOptions = {},
): string {
  const filename = options.filename ?? 'file'
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIFF_TIMEOUT_MS
  const ignoreWhitespace = options.ignoreWhitespace ?? false

  const escapedBefore = escapeForDiff(before)
  const escapedAfter = escapeForDiff(after)
  const raw = createPatch(filename, escapedBefore, escapedAfter, undefined, undefined, {
    context: contextLines,
    ignoreWhitespace,
    timeout: timeoutMs,
  })
  if (!raw) return ''
  return unescapeFromDiff(raw)
}

/**
 * Compute the unified-diff text between two strings, with separate
 * before/after labels in the header. Useful when the diff straddles a
 * rename or two distinct paths (`createTwoFilesPatch` shape).
 */
export function formatTwoFilesUnifiedDiff(
  oldFilename: string,
  newFilename: string,
  before: string,
  after: string,
  options: Omit<FormatUnifiedDiffOptions, 'filename'> = {},
): string {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIFF_TIMEOUT_MS
  const ignoreWhitespace = options.ignoreWhitespace ?? false

  const escapedBefore = escapeForDiff(before)
  const escapedAfter = escapeForDiff(after)
  const raw = createTwoFilesPatch(
    oldFilename,
    newFilename,
    escapedBefore,
    escapedAfter,
    undefined,
    undefined,
    {
      context: contextLines,
      ignoreWhitespace,
      timeout: timeoutMs,
    },
  )
  if (!raw) return ''
  return unescapeFromDiff(raw)
}

export type GetHunksOptions = {
  filename?: string
  contextLines?: number
  timeoutMs?: number
  ignoreWhitespace?: boolean
  /**
   * Collapse all changes into a single hunk by passing a huge `context`.
   * Useful when the caller plans to render the entire file with edits
   * inline rather than show fragments.
   */
  singleHunk?: boolean
}

/**
 * Compute structured hunks between two strings — same shape as JsDiff's
 * `StructuredPatchHunk`. Returns `[]` when the diff aborts or produces
 * no changes.
 */
export function getHunksFromContents(
  before: string,
  after: string,
  options: GetHunksOptions = {},
): StructuredPatchHunk[] {
  const filename = options.filename ?? 'file'
  const contextLines = options.singleHunk
    ? 100_000
    : options.contextLines ?? DEFAULT_CONTEXT_LINES
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIFF_TIMEOUT_MS
  const ignoreWhitespace = options.ignoreWhitespace ?? false

  const result = structuredPatch(
    filename,
    filename,
    escapeForDiff(before),
    escapeForDiff(after),
    undefined,
    undefined,
    {
      context: contextLines,
      ignoreWhitespace,
      timeout: timeoutMs,
    },
  )
  if (!result) return []
  return result.hunks.map(h => ({
    ...h,
    lines: h.lines.map(unescapeFromDiff),
  }))
}

/**
 * Shift hunk line numbers by `offset`. Use when the caller diffed a
 * slice of a file (e.g. an edit-context window) but wants to render the
 * hunks against the whole-file line numbering. Pass `sliceStartLine - 1`
 * to convert slice-relative numbers to file-relative.
 */
export function adjustHunkLineNumbers(
  hunks: StructuredPatchHunk[],
  offset: number,
): StructuredPatchHunk[] {
  if (offset === 0) return hunks
  return hunks.map(h => ({
    ...h,
    oldStart: h.oldStart + offset,
    newStart: h.newStart + offset,
  }))
}

/**
 * Count added/removed lines in a set of structured hunks. Pure — no
 * analytics or cost-tracker side-effects (those live in the caller in
 * this port). For new files where the hunks list is empty, pass the
 * file content via `newFileContent` and every line will count as an
 * addition.
 */
export function countLinesChanged(
  hunks: StructuredPatchHunk[],
  newFileContent?: string,
): { additions: number; deletions: number } {
  if (hunks.length === 0 && newFileContent !== undefined) {
    // Match upstream: count every line in the new file as an addition,
    // including a possible trailing empty line from a final newline.
    const additions = newFileContent.split(/\r?\n/).length
    return { additions, deletions: 0 }
  }

  let additions = 0
  let deletions = 0
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }
  }
  return { additions, deletions }
}

export type { StructuredPatchHunk }
