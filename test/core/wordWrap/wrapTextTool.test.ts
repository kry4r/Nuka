// test/core/wordWrap/wrapTextTool.test.ts
//
// Spec for the WrapTextTool wrapper. Each action gets happy-path shape
// assertions plus the option variants the user prompt pinned (so future
// refactors can't silently change the output vocabulary). Validation
// tests exercise both the missing-required and wrong-type rejection
// paths.

import { describe, expect, it } from 'vitest'
import {
  WRAP_TEXT_TOOL_NAME,
  WrapTextTool,
  runWrapText,
  type WrapTextInput,
  type WrapTextResult,
} from '../../../src/core/wordWrap/wrapTextTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'
import { stringWidth } from '../../../src/core/stringWidth'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): WrapTextResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as WrapTextResult
}

// Build ANSI sequences using String.fromCharCode so the literal ESC
// byte (0x1b) is materialised at runtime, not embedded in this source
// file (which keeps it editable in a wider range of editors).
const ESC = String.fromCharCode(27)
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`

// ─── metadata / schema ─────────────────────────────────────────────────

describe('WrapText tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(WrapTextTool.name).toBe(WRAP_TEXT_TOOL_NAME)
    expect(WRAP_TEXT_TOOL_NAME).toBe('WrapText')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(WrapTextTool.annotations?.readOnly).toBe(true)
    expect(WrapTextTool.annotations?.parallelSafe).toBe(true)
    expect(
      WrapTextTool.needsPermission({ action: 'wrap', text: 'a', width: 10 }),
    ).toBe('none')
  })

  it('declares required action+text+width with the documented enum', () => {
    const params = WrapTextTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text', 'width'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual(['wrap', 'wrapWithPrefix'])
  })

  it('loads under the core activation rule and surfaces wrap keywords', () => {
    expect(WrapTextTool.tags).toContain('core')
    expect(WrapTextTool.tags).toContain('wordWrap')
    expect(WrapTextTool.searchHint).toContain('wrap')
    expect(WrapTextTool.searchHint).toContain('reflow')
  })
})

// ─── action='wrap' ─────────────────────────────────────────────────────

describe('WrapText — action=wrap', () => {
  it('wraps simple text at width=20 on word boundaries', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'the quick brown fox jumps over the lazy dog',
        width: 20,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('wrap')
    if (payload.action === 'wrap') {
      // Every line fits in 20 cells.
      for (const line of payload.lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(20)
      }
      // Output is consistent: lines == result.split('\n').
      expect(payload.result.split('\n')).toEqual(payload.lines)
      // maxLineWidth equals the widest line in cells.
      const widest = payload.lines
        .map(l => stringWidth(l))
        .reduce((a, b) => (a > b ? a : b), 0)
      expect(payload.maxLineWidth).toBe(widest)
      // At least two output lines for this 43-char input at width 20.
      expect(payload.lines.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('applies hangingIndent to continuation lines only', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'one two three four five six seven',
        width: 12,
        hangingIndent: 2,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      // The first line has no hanging indent.
      expect(payload.lines[0]?.startsWith(' ')).toBe(false)
      // Continuation lines (if any) begin with at least 2 spaces.
      const continuations = payload.lines.slice(1)
      expect(continuations.length).toBeGreaterThan(0)
      for (const line of continuations) {
        expect(line.startsWith('  ')).toBe(true)
      }
    }
  })

  it('preserves ANSI escapes and computes width on stripped content', async () => {
    const text = `${RED}hello${RESET} world ${RED}beautiful${RESET} sky`
    const r = await WrapTextTool.run(
      { action: 'wrap', text, width: 12 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      // ANSI escapes survive into the output.
      expect(payload.result.includes(RED)).toBe(true)
      expect(payload.result.includes(RESET)).toBe(true)
      // Each line's visible width fits in the budget (ANSI is zero-width).
      for (const line of payload.lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(12)
      }
    }
  })

  it('counts CJK characters as width 2', async () => {
    // 6 CJK glyphs = 12 cells. At width 6 we should wrap to 3 cells per
    // line (3 glyphs per line).
    const r = await WrapTextTool.run(
      { action: 'wrap', text: '古古古 古古古', width: 6 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      // Each line's display width <= 6.
      for (const line of payload.lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(6)
      }
      // The wide-glyph string was actually wrapped, not jammed on one line.
      expect(payload.lines.length).toBeGreaterThanOrEqual(2)
      // maxLineWidth honours the 2-cells-per-CJK accounting.
      expect(payload.maxLineWidth).toBeGreaterThanOrEqual(2)
      expect(payload.maxLineWidth).toBeLessThanOrEqual(6)
    }
  })

  it('breakWord=true hard-breaks long words', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'superlongunbreakableword',
        width: 5,
        breakWord: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      // All lines fit (no overflow with breakWord:true).
      for (const line of payload.lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(5)
      }
      expect(payload.lines.length).toBeGreaterThan(1)
      // Original word is reconstructable by joining (no chars lost).
      expect(payload.lines.join('')).toBe('superlongunbreakableword')
    }
  })

  it('breakWord=false (default) keeps long words on their own line', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'short superlongwordthatoverflows tiny',
        width: 8,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      // The overlong word sits intact on its own line, overflowing budget.
      expect(payload.lines).toContain('superlongwordthatoverflows')
      // Surrounding short words are placed on their own lines (under budget).
      expect(payload.lines).toContain('short')
      expect(payload.lines).toContain('tiny')
    }
  })
})

// ─── action='wrapWithPrefix' ───────────────────────────────────────────

describe('WrapText — action=wrapWithPrefix', () => {
  it('renders a blockquote-style prefix on every line', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrapWithPrefix',
        text: 'the quick brown fox jumps over the lazy dog',
        width: 20,
        firstPrefix: '> ',
        continuationPrefix: '> ',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('wrapWithPrefix')
    if (payload.action === 'wrapWithPrefix') {
      // Every line starts with '> '.
      for (const line of payload.lines) {
        expect(line.startsWith('> ')).toBe(true)
      }
      // Every line's visible width fits inside `width`.
      for (const line of payload.lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(20)
      }
      // Result and lines are consistent.
      expect(payload.result.split('\n')).toEqual(payload.lines)
      expect(payload.lines.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('uses different first vs continuation prefixes (bullet list)', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrapWithPrefix',
        text: 'an item description that wraps onto multiple lines for sure',
        width: 20,
        firstPrefix: '- ',
        continuationPrefix: '  ',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrapWithPrefix') {
      // First line gets the bullet.
      expect(payload.lines[0]?.startsWith('- ')).toBe(true)
      // Continuation lines align under the bullet (two-space indent).
      const continuations = payload.lines.slice(1)
      expect(continuations.length).toBeGreaterThan(0)
      for (const line of continuations) {
        expect(line.startsWith('  ')).toBe(true)
        expect(line.startsWith('- ')).toBe(false)
      }
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('WrapText — validation', () => {
  it('rejects an invalid action', async () => {
    const r = await WrapTextTool.run(
      { action: 'flip', text: 'x', width: 10 } as unknown as WrapTextInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('unknown action')
  })

  it('rejects width=0', async () => {
    const r = await WrapTextTool.run(
      { action: 'wrap', text: 'hello world', width: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('width')
  })

  it('rejects negative width', async () => {
    const r = await WrapTextTool.run(
      { action: 'wrap', text: 'hello world', width: -3 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('width')
  })

  it('rejects non-integer width', async () => {
    const r = await WrapTextTool.run(
      { action: 'wrap', text: 'hello world', width: 1.5 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('integer')
  })

  it('rejects wrapWithPrefix with missing firstPrefix', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrapWithPrefix',
        text: 'hello',
        width: 20,
        continuationPrefix: '  ',
      } as WrapTextInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('firstPrefix')
  })

  it('rejects wrapWithPrefix with missing continuationPrefix', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrapWithPrefix',
        text: 'hello',
        width: 20,
        firstPrefix: '- ',
      } as WrapTextInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('continuationPrefix')
  })

  it('rejects missing text', async () => {
    const r = await WrapTextTool.run(
      { action: 'wrap', width: 20 } as unknown as WrapTextInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('text')
  })

  it('rejects negative hangingIndent', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'hello world',
        width: 20,
        hangingIndent: -1,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('hangingIndent')
  })
})

// ─── output consistency ────────────────────────────────────────────────

describe('WrapText — lines array matches split-by-newline', () => {
  it('wrap: lines exactly equals result.split("\\n")', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrap',
        text: 'first paragraph line\n\nsecond paragraph also wraps a bit',
        width: 15,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrap') {
      expect(payload.lines).toEqual(payload.result.split('\n'))
    }
  })

  it('wrapWithPrefix: lines exactly equals result.split("\\n")', async () => {
    const r = await WrapTextTool.run(
      {
        action: 'wrapWithPrefix',
        text: 'one two three four five',
        width: 12,
        firstPrefix: '> ',
        continuationPrefix: '> ',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'wrapWithPrefix') {
      expect(payload.lines).toEqual(payload.result.split('\n'))
    }
  })
})

// ─── runWrapText direct (bypassing the Tool channel) ───────────────────

describe('runWrapText (direct helper)', () => {
  it('returns the same shape as the Tool output', () => {
    const out = runWrapText({
      action: 'wrap',
      text: 'hello world this is a test',
      width: 10,
    })
    expect(out.action).toBe('wrap')
    if (out.action === 'wrap') {
      expect(out.result.split('\n')).toEqual(out.lines)
      expect(out.maxLineWidth).toBeGreaterThan(0)
    }
  })
})
