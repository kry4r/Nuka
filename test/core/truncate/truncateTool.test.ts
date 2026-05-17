// test/core/truncate/truncateTool.test.ts
//
// Spec for the TruncateTool wrapper. Each action gets happy-path shape
// assertions plus the option variants the user prompt pinned (so future
// refactors can't silently change the output vocabulary). Validation
// tests exercise both the missing-required and wrong-type rejection
// paths.

import { describe, expect, it } from 'vitest'
import {
  TRUNCATE_TOOL_NAME,
  TruncateTool,
  runTruncate,
  type TruncateInput,
  type TruncateResult,
} from '../../../src/core/truncate/truncateTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): TruncateResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as TruncateResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('Truncate tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(TruncateTool.name).toBe(TRUNCATE_TOOL_NAME)
    expect(TRUNCATE_TOOL_NAME).toBe('Truncate')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(TruncateTool.annotations?.readOnly).toBe(true)
    expect(TruncateTool.annotations?.parallelSafe).toBe(true)
    expect(
      TruncateTool.needsPermission({
        action: 'middle',
        text: 'x',
        maxChars: 10,
      }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = TruncateTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'middle',
      'lines',
      'budget',
      'smart',
    ])
  })

  it('loads under the core activation rule and surfaces truncate keywords', () => {
    expect(TruncateTool.tags).toContain('core')
    expect(TruncateTool.tags).toContain('truncate')
    expect(TruncateTool.searchHint).toContain('truncate')
    expect(TruncateTool.searchHint).toContain('shrink')
  })
})

// ─── action='middle' ───────────────────────────────────────────────────

describe('Truncate — action=middle', () => {
  it('returns short text unchanged with truncated=false', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hello', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('middle')
    if (payload.action === 'middle') {
      expect(payload.result).toBe('hello')
      expect(payload.truncated).toBe(false)
      expect(payload.originalLength).toBe(5)
      expect(payload.resultLength).toBe(5)
    }
  })

  it('truncates long text with a chars-omitted marker', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'a'.repeat(200), maxChars: 40 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') {
      expect(payload.truncated).toBe(true)
      expect(payload.result.length).toBeLessThanOrEqual(40)
      expect(payload.result).toMatch(/…\[\d+ chars omitted\]…/)
      expect(payload.originalLength).toBe(200)
      expect(payload.resultLength).toBeLessThanOrEqual(40)
    }
  })

  it('respects explicit head/tail split', async () => {
    const input = 'HEAD' + 'x'.repeat(200) + 'TAIL'
    const r = await TruncateTool.run(
      {
        action: 'middle',
        text: input,
        maxChars: 40,
        headChars: 4,
        tailChars: 4,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') {
      expect(payload.result.startsWith('HEAD')).toBe(true)
      expect(payload.result.endsWith('TAIL')).toBe(true)
      expect(payload.truncated).toBe(true)
    }
  })

  it('uses a custom literal ellipsis when supplied', async () => {
    const r = await TruncateTool.run(
      {
        action: 'middle',
        text: 'abcdefghij'.repeat(10),
        maxChars: 30,
        ellipsis: '<SNIP>',
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') {
      expect(payload.result).toContain('<SNIP>')
      expect(payload.result).not.toContain('chars omitted')
      expect(payload.truncated).toBe(true)
    }
  })
})

// ─── action='lines' ────────────────────────────────────────────────────

describe('Truncate — action=lines', () => {
  it('truncates 100-line input with maxLines=10 down to 10 lines', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')
    const r = await TruncateTool.run(
      { action: 'lines', text, maxLines: 10 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('lines')
    if (payload.action === 'lines') {
      expect(payload.truncated).toBe(true)
      // Result has at most 10 lines (count newlines + 1 since no trailing).
      const outLines = payload.result.split('\n')
      expect(outLines.length).toBeLessThanOrEqual(10)
      // Head and tail are preserved.
      expect(payload.result.startsWith('line 1\n')).toBe(true)
      expect(payload.result.endsWith('line 100')).toBe(true)
      // resultLines counts non-trailing-newline lines.
      expect(payload.resultLines).toBeLessThanOrEqual(10)
      expect(payload.originalLines).toBe(100)
    }
  })

  it('returns short input unchanged when under budget', async () => {
    const text = 'a\nb\nc'
    const r = await TruncateTool.run(
      { action: 'lines', text, maxLines: 10 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lines') {
      expect(payload.result).toBe(text)
      expect(payload.truncated).toBe(false)
      expect(payload.originalLines).toBe(3)
      expect(payload.resultLines).toBe(3)
    }
  })

  it('respects explicit headLines / tailLines', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)
    const r = await TruncateTool.run(
      {
        action: 'lines',
        text: lines.join('\n'),
        maxLines: 7,
        headLines: 3,
        tailLines: 3,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lines') {
      const out = payload.result.split('\n')
      expect(out[0]).toBe('L1')
      expect(out[1]).toBe('L2')
      expect(out[2]).toBe('L3')
      expect(out[out.length - 1]).toBe('L20')
      expect(out[out.length - 2]).toBe('L19')
      expect(out[out.length - 3]).toBe('L18')
      expect(payload.truncated).toBe(true)
    }
  })
})

// ─── action='budget' ───────────────────────────────────────────────────

describe('Truncate — action=budget', () => {
  it('returns text unchanged when within budget', async () => {
    const r = await TruncateTool.run(
      { action: 'budget', text: 'hello', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'budget') {
      expect(payload.result).toBe('hello')
      expect(payload.truncated).toBe(false)
    }
  })

  it('char-bounds long text and appends an omission marker', async () => {
    const r = await TruncateTool.run(
      {
        action: 'budget',
        text: 'word '.repeat(50), // 250 chars
        maxChars: 60,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'budget') {
      expect(payload.truncated).toBe(true)
      expect(payload.result).toMatch(/…\[\d+ chars omitted\]…$/)
      expect(payload.originalLength).toBeGreaterThan(payload.resultLength)
    }
  })
})

// ─── action='smart' ────────────────────────────────────────────────────

describe('Truncate — action=smart', () => {
  it('returns unchanged input when within budget', async () => {
    const r = await TruncateTool.run(
      { action: 'smart', text: 'hello', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'smart') {
      expect(payload.result).toBe('hello')
      expect(payload.truncated).toBe(false)
    }
  })

  it('preferLineBoundary picks the line-strategy for multi-line input', async () => {
    // 10 lines of 20 chars each = ~210 chars; budget 80, line-pref on.
    const lines = Array.from({ length: 10 }, (_, i) =>
      `line ${i + 1}`.padEnd(20, '.'),
    )
    const text = lines.join('\n')
    const r = await TruncateTool.run(
      {
        action: 'smart',
        text,
        maxChars: 80,
        preferLineBoundary: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'smart') {
      expect(payload.truncated).toBe(true)
      // Line-truncation emits the lines-omitted marker, not the chars one.
      expect(payload.result).toMatch(/lines omitted/)
    }
  })

  it('preserveCodeFences avoids splitting a code fence', async () => {
    // 4+ lines containing a balanced fenced block. Without
    // preserveCodeFences the smart helper would still pick lines for
    // a multi-line input; with the flag it must use lines too — the
    // important guarantee is that fence markers stay balanced.
    const fenced = [
      'intro line one',
      'intro line two',
      '```js',
      'const x = 1',
      'const y = 2',
      'const z = 3',
      'const a = 4',
      'const b = 5',
      '```',
      'outro line one',
      'outro line two',
    ].join('\n')
    const r = await TruncateTool.run(
      {
        action: 'smart',
        text: fenced,
        maxChars: 90,
        preserveCodeFences: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'smart') {
      expect(payload.truncated).toBe(true)
      // Count fence markers in the output. Either zero (both fences
      // were dropped together) or two (balanced) — never one, which
      // would be the orphan-opener bug.
      const fenceMatches = payload.result.match(/```/g) ?? []
      expect(fenceMatches.length % 2).toBe(0)
    }
  })
})

// ─── truncated flag truth table ────────────────────────────────────────

describe('Truncate — truncated flag', () => {
  it('is false when input <= budget (middle)', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hi', maxChars: 50 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') expect(payload.truncated).toBe(false)
  })

  it('is true when input > budget (middle)', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'x'.repeat(100), maxChars: 30 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') expect(payload.truncated).toBe(true)
  })

  it('is false when input <= budget (lines)', async () => {
    const r = await TruncateTool.run(
      { action: 'lines', text: 'a\nb', maxLines: 10 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lines') expect(payload.truncated).toBe(false)
  })

  it('is true when input > budget (lines)', async () => {
    const lines = Array.from({ length: 50 }, () => 'x').join('\n')
    const r = await TruncateTool.run(
      { action: 'lines', text: lines, maxLines: 5 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lines') expect(payload.truncated).toBe(true)
  })

  it('is false when input <= budget (budget)', async () => {
    const r = await TruncateTool.run(
      { action: 'budget', text: 'short', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'budget') expect(payload.truncated).toBe(false)
  })

  it('is true when input > budget (budget)', async () => {
    const r = await TruncateTool.run(
      { action: 'budget', text: 'word '.repeat(50), maxChars: 60 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'budget') expect(payload.truncated).toBe(true)
  })

  it('is false when input <= budget (smart)', async () => {
    const r = await TruncateTool.run(
      { action: 'smart', text: 'tiny', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'smart') expect(payload.truncated).toBe(false)
  })

  it('is true when input > budget (smart)', async () => {
    const r = await TruncateTool.run(
      { action: 'smart', text: 'word '.repeat(50), maxChars: 30 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'smart') expect(payload.truncated).toBe(true)
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('Truncate — validation', () => {
  it('rejects an invalid action', async () => {
    const r = await TruncateTool.run(
      { action: 'flip', text: 'x', maxChars: 10 } as unknown as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('unknown action')
  })

  it('rejects middle with missing maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hello' } as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxChars')
  })

  it('rejects budget with missing maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'budget', text: 'hello' } as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxChars')
  })

  it('rejects smart with missing maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'smart', text: 'hello' } as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxChars')
  })

  it('rejects lines with missing maxLines', async () => {
    const r = await TruncateTool.run(
      { action: 'lines', text: 'a\nb\nc' } as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLines')
  })

  it('rejects negative maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hello', maxChars: -5 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxChars')
  })

  it('rejects zero maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'budget', text: 'hello', maxChars: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxChars')
  })

  it('rejects negative maxLines', async () => {
    const r = await TruncateTool.run(
      { action: 'lines', text: 'a\nb', maxLines: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLines')
  })

  it('rejects zero maxLines', async () => {
    const r = await TruncateTool.run(
      { action: 'lines', text: 'a\nb', maxLines: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxLines')
  })

  it('rejects non-integer maxChars', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hello', maxChars: 1.5 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('integer')
  })

  it('rejects negative headChars on middle', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 'hello', maxChars: 10, headChars: -3 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('headChars')
  })

  it('rejects negative tailLines on lines', async () => {
    const r = await TruncateTool.run(
      { action: 'lines', text: 'a\nb', maxLines: 10, tailLines: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('tailLines')
  })

  it('rejects non-string text', async () => {
    const r = await TruncateTool.run(
      { action: 'middle', text: 42, maxChars: 10 } as unknown as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('text')
  })

  it('rejects non-boolean preferLineBoundary on smart', async () => {
    const r = await TruncateTool.run(
      {
        action: 'smart',
        text: 'hello',
        maxChars: 30,
        preferLineBoundary: 'yes',
      } as unknown as TruncateInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('preferLineBoundary')
  })
})

// ─── unicode safety ────────────────────────────────────────────────────

describe('Truncate — unicode safety', () => {
  // Build a string with a surrogate-pair emoji ('😀' = U+1F600) so the
  // grapheme path is exercised. We splice the emoji into the middle of
  // a long ASCII run and check that the truncated result either keeps
  // the full emoji glyph or omits it entirely — but never a half pair.
  it('never splits a surrogate pair (middle)', async () => {
    const head = 'a'.repeat(50)
    const tail = 'b'.repeat(50)
    const text = head + '😀' + tail
    const r = await TruncateTool.run(
      { action: 'middle', text, maxChars: 30 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') {
      // The emoji is either fully present or fully absent.
      const halfPair = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      expect(halfPair.test(payload.result)).toBe(false)
    }
  })

  it('never splits a surrogate pair (budget)', async () => {
    const text = 'word '.repeat(20) + '😀' + ' more '.repeat(20)
    const r = await TruncateTool.run(
      { action: 'budget', text, maxChars: 40 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'budget') {
      const halfPair = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      expect(halfPair.test(payload.result)).toBe(false)
    }
  })

  it('counts emoji as one grapheme cluster, not two code units', async () => {
    // Three emoji glyphs = 3 graphemes, 6 UTF-16 code units. The
    // `originalLength` field must report 3, not 6.
    const r = await TruncateTool.run(
      { action: 'middle', text: '😀😀😀', maxChars: 100 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'middle') {
      expect(payload.originalLength).toBe(3)
      expect(payload.resultLength).toBe(3)
      expect(payload.truncated).toBe(false)
    }
  })
})

// ─── runTruncate direct (bypassing the Tool channel) ───────────────────

describe('runTruncate (direct helper)', () => {
  it('returns the same shape as the Tool output', () => {
    const out = runTruncate({
      action: 'middle',
      text: 'a'.repeat(80),
      maxChars: 30,
    })
    expect(out.action).toBe('middle')
    if (out.action === 'middle') {
      expect(out.truncated).toBe(true)
      expect(out.result).toMatch(/…\[\d+ chars omitted\]…/)
      expect(out.resultLength).toBeLessThanOrEqual(30)
    }
  })

  it('lines variant returns line-count fields', () => {
    const out = runTruncate({
      action: 'lines',
      text: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n'),
      maxLines: 5,
    })
    expect(out.action).toBe('lines')
    if (out.action === 'lines') {
      expect(out.originalLines).toBe(10)
      expect(out.resultLines).toBeLessThanOrEqual(5)
      expect(out.truncated).toBe(true)
    }
  })
})
