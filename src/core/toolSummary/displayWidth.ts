// src/core/toolSummary/displayWidth.ts
//
// Visual-width add-on for the pure ToolSummary heuristics in
// `summary.ts`. `summary.ts` is deliberately display-agnostic — it
// keeps its `summarizeToolInput` / `buildToolCallRow` pair free of any
// truncation, padding or column math, because those are display
// concerns and downstream renderers may want different limits.
//
// But every downstream renderer *does* eventually need to ask:
//
//   • "How many terminal cells does the row 'toolName: summary' take?"
//   • "Cap the row at N columns; collapse the summary if it doesn't fit."
//
// Doing that math with `String.prototype.length` is wrong for any text
// containing CJK glyphs (each 2 cells), emoji (1 grapheme often spans
// multiple code points), or ANSI escapes (zero cells, but inflate
// `.length`). This module wraps the stringWidth helpers to give
// callers a single drop-in: pass a `ToolCallRow`, get terminal-cell
// width or a width-bounded row back.
//
// The helpers in here:
//   - Read from `ToolCallRow` only via its public surface.
//   - Do not mutate `summary.ts`'s heuristic types.
//   - Are pure: deterministic, no I/O, parallel-safe.
//   - Treat the canonical row rendering as `"<toolName>: <summary>"`
//     when summary is non-null, else just `"<toolName>"`. That
//     mirrors what most existing TUI tool-row renderers print.
//
// Why a sibling helper instead of swapping inside summary.ts? Today
// summary.ts has zero display-width math — no truncation, no padding,
// no column tests. The only `.length` use in the file is a
// non-display "is the value non-empty?" check (`value.trim().length >
// 0`), which is a code-unit count and unrelated to terminal cells.
// Adding visual-width capability therefore landed as a new, opt-in
// helper rather than a no-op rewrite of summary.ts.

import { ToolCallRow } from './summary'
import { stringWidth, truncateByWidth } from '../stringWidth'

/**
 * Separator inserted between toolName and summary in the canonical
 * rendering. Kept as a module-private constant rather than a parameter
 * so width math and the actual render string can't drift apart.
 *
 * Width = 2 cells (": ").
 */
const ROW_SEPARATOR = ': '

/**
 * Render a `ToolCallRow` as the canonical "toolName: summary" string
 * a TUI / transcript renderer would print. Summary is omitted when
 * null. Exposed so callers can stay in sync with the width-math here
 * without re-implementing the join.
 */
export function renderToolCallRow(row: ToolCallRow): string {
  if (row.summary === null || row.summary === '') {
    return row.toolName
  }
  return `${row.toolName}${ROW_SEPARATOR}${row.summary}`
}

/**
 * Display width of a `ToolCallRow`, in terminal cells.
 *
 *   • Counts CJK / fullwidth glyphs as 2 cells each
 *   • Counts ZWJ-emoji clusters as one width-2 grapheme
 *   • Excludes ANSI escape sequences (they consume 0 cells)
 *   • Includes the `": "` separator when summary is non-null
 *
 * For a row with no summary, this is just `stringWidth(toolName)`.
 */
export function displayWidthOfToolCallRow(row: ToolCallRow): number {
  if (row.summary === null || row.summary === '') {
    return stringWidth(row.toolName)
  }
  // Separator is pure ASCII so its width is exactly its char count,
  // but go through stringWidth anyway to keep one code path.
  return (
    stringWidth(row.toolName) +
    stringWidth(ROW_SEPARATOR) +
    stringWidth(row.summary)
  )
}

/** Options for {@link fitToolCallRowToWidth}. */
export interface FitToolCallRowOptions {
  /**
   * Tail marker used when the summary is truncated. Defaults to
   * `'…'` (U+2026, one cell). Pass `'...'` for an ASCII-only
   * three-dot marker (three cells). Pass `''` to truncate without
   * any marker.
   */
  ellipsis?: string
}

/**
 * Bound a `ToolCallRow`'s rendered width to at most `maxColumns`
 * terminal cells. Returns a new row with the same toolName / flags
 * but a possibly-shortened summary. If the row already fits, the
 * same row reference is returned.
 *
 * Truncation rules:
 *
 *   1. If `toolName` alone (plus separator, if a summary will be
 *      shown) already meets or exceeds `maxColumns`, the summary is
 *      replaced with `null` — the toolName takes precedence.
 *   2. Otherwise the summary is truncated by visual width to whatever
 *      budget remains, with the configured ellipsis marker appended.
 *   3. Width is measured in terminal cells, so CJK / emoji / ANSI
 *      escape inputs all collapse correctly.
 *
 * `maxColumns` must be a non-negative finite number; a zero budget
 * returns a row with an empty toolName and null summary.
 */
export function fitToolCallRowToWidth(
  row: ToolCallRow,
  maxColumns: number,
  opts: FitToolCallRowOptions = {},
): ToolCallRow {
  if (!Number.isFinite(maxColumns) || maxColumns < 0) {
    throw new RangeError(`maxColumns must be ≥ 0, got ${maxColumns}`)
  }

  if (maxColumns === 0) {
    return {
      toolName: '',
      summary: null,
      isSearch: row.isSearch,
      isRead: row.isRead,
      isCollapsible: row.isCollapsible,
    }
  }

  const currentWidth = displayWidthOfToolCallRow(row)
  if (currentWidth <= maxColumns) {
    return row
  }

  const { ellipsis = '…' } = opts
  const toolNameWidth = stringWidth(row.toolName)

  // The toolName alone already eats the budget. Drop the summary
  // entirely and width-clip the toolName itself; the row is then a
  // bare, possibly-truncated tool identifier.
  if (
    row.summary === null ||
    row.summary === '' ||
    toolNameWidth + stringWidth(ROW_SEPARATOR) >= maxColumns
  ) {
    const truncatedName = truncateByWidth(row.toolName, maxColumns, {
      ellipsis,
    })
    return {
      toolName: truncatedName,
      summary: null,
      isSearch: row.isSearch,
      isRead: row.isRead,
      isCollapsible: row.isCollapsible,
    }
  }

  // Room for at least toolName + separator + 1 cell of summary.
  const summaryBudget =
    maxColumns - toolNameWidth - stringWidth(ROW_SEPARATOR)
  const truncatedSummary = truncateByWidth(row.summary, summaryBudget, {
    ellipsis,
  })

  return {
    toolName: row.toolName,
    summary: truncatedSummary,
    isSearch: row.isSearch,
    isRead: row.isRead,
    isCollapsible: row.isCollapsible,
  }
}
