// src/core/diff/lines.ts
//
// Line-level diff primitives — wraps JsDiff's `diffLines` into a more
// caller-friendly shape:
//
//   - Drops JsDiff's `count` field by default (callers can re-compute
//     it from `value.split('\n').length` if needed; keeping the original
//     count keeps the seam narrower).
//   - Maps the {added,removed} pair into a single `op: 'add'|'del'|'eq'`
//     discriminant so render code can do `switch (op)` instead of
//     `if (added) ... else if (removed) ... else ...`.
//
// Upstream Nuka-Code uses `diffLines` in three places — fileHistory,
// insights, and one tool — but each repeats the same {added,removed}→
// branching shape. Centralising it once removes that repetition.
//
// Side-effects: none.

import { diffLines as jsDiffLines } from 'diff'

export type LineDiffOp = 'add' | 'del' | 'eq'

export type LineDiffSegment = {
  /** What the segment does relative to the source: insert, delete, or unchanged. */
  op: LineDiffOp
  /** The line text. May contain multiple newlines for a run of consecutive identical-op lines. */
  value: string
  /** Number of lines this segment spans. */
  count: number
}

export type DiffLinesOptions = {
  /** Strip trailing `\r` before diffing — useful when comparing CRLF vs LF inputs. */
  stripTrailingCr?: boolean
  /** Ignore leading/trailing whitespace differences when matching lines. */
  ignoreWhitespace?: boolean
  /**
   * If true, return one segment per line rather than collapsing runs.
   * Maps to JsDiff's `oneChangePerToken`.
   */
  oneSegmentPerLine?: boolean
}

/**
 * Compute a line-level diff. Returns an ordered list of segments
 * describing how `after` differs from `before`, lossless to the inputs:
 * concatenating all segment values (filtered by op as appropriate)
 * reconstructs each side.
 */
export function diffLinesSimple(
  before: string,
  after: string,
  options: DiffLinesOptions = {},
): LineDiffSegment[] {
  const changes = jsDiffLines(before, after, {
    stripTrailingCr: options.stripTrailingCr ?? false,
    ignoreWhitespace: options.ignoreWhitespace ?? false,
    oneChangePerToken: options.oneSegmentPerLine ?? false,
  })

  return changes.map(c => {
    let op: LineDiffOp
    if (c.added) op = 'add'
    else if (c.removed) op = 'del'
    else op = 'eq'
    return { op, value: c.value, count: c.count }
  })
}

/**
 * Summary counts of added / removed / unchanged lines for a pair of
 * texts. Convenience over `diffLinesSimple` for callers that only need
 * totals (e.g. a status bar showing `+N -M`).
 */
export function summariseLineChanges(
  before: string,
  after: string,
  options: DiffLinesOptions = {},
): { added: number; removed: number; unchanged: number } {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const seg of diffLinesSimple(before, after, options)) {
    if (seg.op === 'add') added += seg.count
    else if (seg.op === 'del') removed += seg.count
    else unchanged += seg.count
  }
  return { added, removed, unchanged }
}
