// test/core/toolSummary/summary.stringWidth.test.ts
//
// Visual-width-aware tests for the toolSummary surface. The pure
// heuristic functions in summary.ts deliberately do not do display-
// width math (their `.length` use is a non-display "is value
// non-empty?" check). The width-aware helpers live in the sibling
// `displayWidth.ts` module; these tests exercise that helper together
// with the existing `buildToolCallRow` to confirm:
//
//   • CJK glyphs count as 2 terminal cells each
//   • Emoji ZWJ clusters count as one width-2 cluster
//   • ANSI escapes are excluded from width counts
//   • The pure-ASCII case matches the char-count answer exactly (no
//     regression for the common path)
//   • The CJK case differs from a naive `.length`-based decision,
//     which is the whole point of the rewire
//
// Tests are intentionally focused: each spec sets up a small tool-
// call fixture, runs `buildToolCallRow` to keep the upstream
// heuristics in the loop, then asserts on the width-aware helper.

import { describe, expect, it } from 'vitest'
import {
  buildToolCallRow,
  summarizeToolInput,
} from '../../../src/core/toolSummary/summary'
import {
  displayWidthOfToolCallRow,
  fitToolCallRowToWidth,
  renderToolCallRow,
} from '../../../src/core/toolSummary/displayWidth'

// Build ANSI sequences at runtime rather than as escape literals so
// the file stays editable in any editor that doesn't render raw ESC.
const ESC = ''
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`

describe('summarizeToolInput visual-width passthrough', () => {
  // summarizeToolInput is heuristic-only; it doesn't truncate or
  // measure visual width. These tests document that contract — the
  // raw chosen field comes back regardless of CJK / emoji / ANSI
  // content. Width handling is the caller's job (and is what
  // displayWidthOfToolCallRow is for).

  it('returns CJK content verbatim', () => {
    expect(summarizeToolInput({ query: '搜索代码' })).toBe('搜索代码')
  })

  it('returns emoji content verbatim, ZWJ clusters preserved', () => {
    const family = '👨‍👩‍👧'
    expect(summarizeToolInput({ command: family })).toBe(family)
  })

  it('returns ANSI-decorated content verbatim (no stripping)', () => {
    const decorated = `${RED}error${RESET}`
    expect(summarizeToolInput({ command: decorated })).toBe(decorated)
  })
})

describe('renderToolCallRow', () => {
  it('omits the separator when summary is null', () => {
    const row = buildToolCallRow('read_file', undefined)
    expect(row.summary).toBeNull()
    expect(renderToolCallRow(row)).toBe('read_file')
  })

  it('renders "toolName: summary" when summary is present', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    expect(renderToolCallRow(row)).toBe('search_code: foo')
  })
})

describe('displayWidthOfToolCallRow', () => {
  it('pure-ASCII case matches the char-count answer exactly', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    // "search_code" (11) + ": " (2) + "foo" (3) = 16 cells
    expect(displayWidthOfToolCallRow(row)).toBe(16)
    // Sanity: the naive char count agrees in this case.
    expect(renderToolCallRow(row).length).toBe(16)
  })

  it('CJK summary counts each glyph as 2 cells', () => {
    const row = buildToolCallRow('search_code', { query: '搜索代码' })
    // "search_code" (11) + ": " (2) + "搜索代码" (4 glyphs × 2 = 8) = 21
    expect(displayWidthOfToolCallRow(row)).toBe(21)
    // Naive .length would say 17 because each CJK glyph is one UTF-16
    // code unit. Width-aware count must NOT match the naive count.
    expect(renderToolCallRow(row).length).toBe(17)
  })

  it('emoji ZWJ cluster counts as width 2, not as its codepoint count', () => {
    // 👨‍👩‍👧 is U+1F468 ZWJ U+1F469 ZWJ U+1F467 → 5 codepoints, but
    // one width-2 grapheme cluster in a TUI.
    const family = '👨‍👩‍👧'
    const row = buildToolCallRow('search_code', { command: family })
    // "search_code" (11) + ": " (2) + family (2) = 15 cells
    expect(displayWidthOfToolCallRow(row)).toBe(15)
  })

  it('ANSI escapes contribute 0 cells to the row width', () => {
    const decorated = `${RED}error${RESET}` // visible: 5 cells
    const row = buildToolCallRow('search_code', { command: decorated })
    // "search_code" (11) + ": " (2) + "error" (5) = 18 cells
    expect(displayWidthOfToolCallRow(row)).toBe(18)
    // Naive .length includes the ANSI bytes, so it would way overshoot.
    expect(renderToolCallRow(row).length).toBeGreaterThan(18)
  })

  it('summary-less row reports just the toolName width', () => {
    const row = buildToolCallRow('read_file', undefined)
    expect(displayWidthOfToolCallRow(row)).toBe('read_file'.length)
  })
})

describe('fitToolCallRowToWidth', () => {
  it('returns the same row reference when it already fits', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    const fitted = fitToolCallRowToWidth(row, 100)
    expect(fitted).toBe(row)
  })

  it('pure-ASCII case at exact budget: identical to before', () => {
    // "search_code: foo" = 16 cells, budget = 16 → unchanged.
    const row = buildToolCallRow('search_code', { query: 'foo' })
    const fitted = fitToolCallRowToWidth(row, 16)
    expect(fitted).toBe(row)
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(16)
  })

  it('CJK case at exact budget: width-aware decision differs from char-count', () => {
    // "search_code: 搜索代码" — actual width 21, naive .length 17.
    // A char-count limit of 17 would say "fits"; a width limit of 17
    // must say "doesn't fit". This is the regression the helper
    // exists to prevent.
    const row = buildToolCallRow('search_code', { query: '搜索代码' })
    expect(renderToolCallRow(row).length).toBe(17) // naive says fits at 17
    expect(displayWidthOfToolCallRow(row)).toBe(21) // truth says no

    const fitted = fitToolCallRowToWidth(row, 17)
    expect(fitted).not.toBe(row)
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(17)
  })

  it('truncates a too-long ASCII summary with the default ellipsis', () => {
    const row = buildToolCallRow('search_code', {
      query: 'a'.repeat(50),
    })
    const fitted = fitToolCallRowToWidth(row, 20)
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(20)
    // Default ellipsis is one-cell '…'
    expect(fitted.summary).not.toBeNull()
    expect(fitted.summary).toMatch(/…$/)
  })

  it('truncates with custom ASCII ellipsis when configured', () => {
    const row = buildToolCallRow('search_code', {
      query: 'a'.repeat(50),
    })
    const fitted = fitToolCallRowToWidth(row, 20, { ellipsis: '...' })
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(20)
    expect(fitted.summary).toMatch(/\.\.\.$/)
  })

  it('drops the summary when the toolName + separator already meet the budget', () => {
    // "search_code" alone = 11 cells. Budget = 12 leaves only one
    // cell after "search_code" and not enough room for the separator
    // plus any summary content.
    const row = buildToolCallRow('search_code', { query: 'foo' })
    const fitted = fitToolCallRowToWidth(row, 12)
    expect(fitted.summary).toBeNull()
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(12)
  })

  it('truncates the toolName itself when budget is below toolName width', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    const fitted = fitToolCallRowToWidth(row, 6)
    expect(fitted.summary).toBeNull()
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(6)
  })

  it('handles zero budget by returning an empty row', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    const fitted = fitToolCallRowToWidth(row, 0)
    expect(fitted.toolName).toBe('')
    expect(fitted.summary).toBeNull()
    expect(displayWidthOfToolCallRow(fitted)).toBe(0)
  })

  it('rejects negative or non-finite budgets', () => {
    const row = buildToolCallRow('search_code', { query: 'foo' })
    expect(() => fitToolCallRowToWidth(row, -1)).toThrow(RangeError)
    expect(() => fitToolCallRowToWidth(row, Number.NaN)).toThrow(RangeError)
    expect(() => fitToolCallRowToWidth(row, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    )
  })

  it('preserves classification flags through truncation', () => {
    const row = buildToolCallRow('search_code', {
      query: 'a'.repeat(50),
    })
    expect(row.isSearch).toBe(true)
    const fitted = fitToolCallRowToWidth(row, 20)
    expect(fitted.isSearch).toBe(true)
    expect(fitted.isRead).toBe(false)
    expect(fitted.isCollapsible).toBe(true)
  })

  it('width-clips an ANSI-decorated summary correctly (escapes stripped)', () => {
    // 50 visible cells of red 'a's with reset.
    const decorated = `${RED}${'a'.repeat(50)}${RESET}`
    const row = buildToolCallRow('search_code', { command: decorated })
    const fitted = fitToolCallRowToWidth(row, 20)
    expect(displayWidthOfToolCallRow(fitted)).toBeLessThanOrEqual(20)
    // truncateByWidth drops ANSI bytes — the result is bare visible text.
    expect(fitted.summary).not.toMatch(/\x1B\[/)
  })
})
