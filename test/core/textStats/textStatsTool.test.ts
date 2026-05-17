// test/core/textStats/textStatsTool.test.ts
//
// Spec for the TextStatsTool wrapper. Each action gets happy-path
// shape assertions plus the option variants the user prompt pinned
// (so future refactors can't silently change the output vocabulary).
// Validation tests exercise both the missing-required and wrong-type
// rejection paths.

import { describe, expect, it } from 'vitest'
import {
  TEXT_STATS_TOOL_NAME,
  TextStatsTool,
  runTextStatsTool,
  type TextStatsToolInput,
  type TextStatsToolResult,
} from '../../../src/core/textStats/textStatsTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): TextStatsToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as TextStatsToolResult
}

// Build ANSI sequences as runtime strings rather than literal escapes
// to keep this file editable in a wider range of editors. Mirrors the
// pattern in `test/core/textStats/textStats.test.ts`.
const ESC = ''
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`

// ─── metadata / schema ─────────────────────────────────────────────────

describe('TextStats tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(TextStatsTool.name).toBe(TEXT_STATS_TOOL_NAME)
    expect(TEXT_STATS_TOOL_NAME).toBe('TextStats')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(TextStatsTool.annotations?.readOnly).toBe(true)
    expect(TextStatsTool.annotations?.parallelSafe).toBe(true)
    expect(
      TextStatsTool.needsPermission({
        action: 'stats',
        text: 'hello',
      }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = TextStatsTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'stats',
      'lines',
      'words',
      'sentences',
      'paragraphs',
    ])
  })

  it('loads under the core activation rule and surfaces stats keywords', () => {
    expect(TextStatsTool.tags).toContain('core')
    expect(TextStatsTool.tags).toContain('textStats')
    expect(TextStatsTool.searchHint).toContain('textStats')
    expect(TextStatsTool.searchHint).toContain('count')
  })
})

// ─── action='stats' ────────────────────────────────────────────────────

describe('TextStats — action=stats', () => {
  it('returns the full breakdown for simple multi-line text', async () => {
    const text = 'hello world\nfoo bar baz'
    const r = await TextStatsTool.run({ action: 'stats', text }, mkCtx())
    const payload = parsePayload(r)
    expect(payload.action).toBe('stats')
    if (payload.action === 'stats') {
      expect(payload.chars).toBe(text.length)
      // visualWidth counts terminal cells. `\n` is zero-width, so the
      // total is text.length - 1 (one newline in the input).
      expect(payload.visualWidth).toBe(text.length - 1)
      expect(payload.bytes).toBe(text.length)
      expect(payload.lines).toBe(2)
      expect(payload.words).toBe(5) // hello, world, foo, bar, baz
      expect(payload.sentences).toBe(1) // no terminal punct → 1
      expect(payload.paragraphs).toBe(1)
      expect(payload.avgLineLength).toBeGreaterThan(0)
      expect(payload.avgWordLength).toBeGreaterThan(0)
      expect(payload.avgWordsPerSentence).toBe(5)
    }
  })

  it('exposes every documented metric in the output payload', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 'hi' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      // The contract pins exactly these keys (plus `action`). Future
      // refactors that drop one should fail this test.
      expect(Object.keys(payload).sort()).toEqual(
        [
          'action',
          'avgLineLength',
          'avgWordLength',
          'avgWordsPerSentence',
          'bytes',
          'chars',
          'lines',
          'paragraphs',
          'sentences',
          'visualWidth',
          'words',
        ].sort(),
      )
    }
  })

  it('CJK characters → visualWidth uses double-width', async () => {
    const text = '你好世界' // 4 CJK chars
    const r = await TextStatsTool.run({ action: 'stats', text }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      expect(payload.chars).toBe(4)
      expect(payload.visualWidth).toBe(8) // 4 chars × 2 cells = 8
      // 4 chars × 3 UTF-8 bytes each
      expect(payload.bytes).toBe(12)
    }
  })

  it('ANSI codes (default countAnsi=false) → chars excludes ANSI', async () => {
    const text = `${RED}hello${RESET}`
    const r = await TextStatsTool.run({ action: 'stats', text }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      // ANSI stripped → just 'hello' contributes to chars/visualWidth.
      expect(payload.chars).toBe(5)
      expect(payload.visualWidth).toBe(5)
      // bytes still tracks the raw UTF-8 length so it matches `wc -c`.
      expect(payload.bytes).toBe(text.length)
      expect(payload.words).toBe(1)
    }
  })

  it('countAnsi=true → chars includes ANSI bytes', async () => {
    const text = `${RED}hello${RESET}`
    const r = await TextStatsTool.run(
      { action: 'stats', text, countAnsi: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      // With countAnsi=true the escapes count as literal text.
      expect(payload.chars).toBe(text.length)
      expect(payload.chars).toBeGreaterThan(5)
    }
  })

  it('empty text → all zeros', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      expect(payload.chars).toBe(0)
      expect(payload.visualWidth).toBe(0)
      expect(payload.bytes).toBe(0)
      expect(payload.lines).toBe(0)
      expect(payload.words).toBe(0)
      expect(payload.sentences).toBe(0)
      expect(payload.paragraphs).toBe(0)
      expect(payload.avgLineLength).toBe(0)
      expect(payload.avgWordLength).toBe(0)
      expect(payload.avgWordsPerSentence).toBe(0)
    }
  })

  it('single word → 1 word, 1 line', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 'hello' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      expect(payload.words).toBe(1)
      expect(payload.lines).toBe(1)
    }
  })

  it('multi-paragraph (\\n\\n) → correct paragraph count', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 'first para\n\nsecond para\n\nthird' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'stats') {
      expect(payload.paragraphs).toBe(3)
    }
  })

  it('respects tabWidth for visualWidth', async () => {
    const r4 = await TextStatsTool.run(
      { action: 'stats', text: '\thi', tabWidth: 4 },
      mkCtx(),
    )
    const r8 = await TextStatsTool.run(
      { action: 'stats', text: '\thi', tabWidth: 8 },
      mkCtx(),
    )
    const p4 = parsePayload(r4)
    const p8 = parsePayload(r8)
    if (p4.action === 'stats' && p8.action === 'stats') {
      // tabWidth=4 → 4 + 2 = 6; tabWidth=8 → 8 + 2 = 10.
      expect(p8.visualWidth).toBeGreaterThan(p4.visualWidth)
    }
  })
})

// ─── action=lines ──────────────────────────────────────────────────────

describe('TextStats — action=lines', () => {
  it('returns a scalar line count', async () => {
    const r = await TextStatsTool.run(
      { action: 'lines', text: 'a\nb\nc' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('lines')
    if (payload.action === 'lines') {
      expect(payload.lines).toBe(3)
    }
  })

  it('empty text → 0 lines', async () => {
    const r = await TextStatsTool.run({ action: 'lines', text: '' }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'lines') {
      expect(payload.lines).toBe(0)
    }
  })

  it('trailing newline is a terminator, not a new line', async () => {
    const r = await TextStatsTool.run(
      { action: 'lines', text: 'a\n' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lines') {
      expect(payload.lines).toBe(1)
    }
  })
})

// ─── action=words ──────────────────────────────────────────────────────

describe('TextStats — action=words', () => {
  it('returns a scalar word count', async () => {
    const r = await TextStatsTool.run(
      { action: 'words', text: 'one two three four' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('words')
    if (payload.action === 'words') {
      expect(payload.words).toBe(4)
    }
  })

  it('single word → 1', async () => {
    const r = await TextStatsTool.run(
      { action: 'words', text: 'hello' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'words') {
      expect(payload.words).toBe(1)
    }
  })

  it('whitespace-only → 0', async () => {
    const r = await TextStatsTool.run(
      { action: 'words', text: '   \n\t  ' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'words') {
      expect(payload.words).toBe(0)
    }
  })
})

// ─── action=sentences ──────────────────────────────────────────────────

describe('TextStats — action=sentences', () => {
  it('returns a scalar sentence count', async () => {
    const r = await TextStatsTool.run(
      { action: 'sentences', text: 'First. Second! Third?' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('sentences')
    if (payload.action === 'sentences') {
      expect(payload.sentences).toBe(3)
    }
  })

  it('no terminal punctuation but non-empty → 1', async () => {
    const r = await TextStatsTool.run(
      { action: 'sentences', text: 'hello world' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'sentences') {
      expect(payload.sentences).toBe(1)
    }
  })
})

// ─── action=paragraphs ─────────────────────────────────────────────────

describe('TextStats — action=paragraphs', () => {
  it('returns a scalar paragraph count', async () => {
    const r = await TextStatsTool.run(
      { action: 'paragraphs', text: 'p1\n\np2\n\np3' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('paragraphs')
    if (payload.action === 'paragraphs') {
      expect(payload.paragraphs).toBe(3)
    }
  })

  it('non-empty input with no blank lines → 1', async () => {
    const r = await TextStatsTool.run(
      { action: 'paragraphs', text: 'just one paragraph\nstill one' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'paragraphs') {
      expect(payload.paragraphs).toBe(1)
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('TextStats — validation', () => {
  it('rejects an invalid action with a structured error', async () => {
    const r = await TextStatsTool.run(
      { action: 'bogus', text: 'hi' } as unknown as TextStatsToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown action 'bogus'/)
  })

  it('rejects a non-string action', async () => {
    const r = await TextStatsTool.run(
      { action: 42 as unknown as 'stats', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'action' must be a string/)
  })

  it('rejects missing text', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats' } as unknown as TextStatsToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects non-string text', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects tabWidth=0', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 'hi', tabWidth: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'tabWidth' must be a positive number/)
  })

  it('rejects negative tabWidth', async () => {
    const r = await TextStatsTool.run(
      { action: 'stats', text: 'hi', tabWidth: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'tabWidth' must be a positive number/)
  })

  it('rejects non-boolean countAnsi', async () => {
    const r = await TextStatsTool.run(
      {
        action: 'stats',
        text: 'hi',
        countAnsi: 'yes' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'countAnsi' must be a boolean/)
  })

  it('rejects non-object input', async () => {
    const r = await TextStatsTool.run(
      null as unknown as TextStatsToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/input must be an object/)
  })
})

// ─── exported pure helper ──────────────────────────────────────────────

describe('runTextStatsTool — direct invocation', () => {
  it('returns the same shape as the Tool run', () => {
    const payload = runTextStatsTool({
      action: 'stats',
      text: 'hello world',
    })
    expect(payload.action).toBe('stats')
    if (payload.action === 'stats') {
      expect(payload.words).toBe(2)
    }
  })

  it('forwards options to the underlying counters', () => {
    const text = `${RED}hi there${RESET}`
    const stripped = runTextStatsTool({ action: 'words', text })
    const counted = runTextStatsTool({
      action: 'words',
      text,
      countAnsi: true,
    })
    if (stripped.action === 'words' && counted.action === 'words') {
      // Both visible words are 'hi' and 'there'. With ANSI stripped → 2.
      // With ANSI literal, the escape sequences are non-whitespace blobs
      // that fuse onto the adjacent visible word, so count stays 2 — but
      // the helper should still execute both paths without error.
      expect(stripped.words).toBe(2)
      expect(counted.words).toBeGreaterThanOrEqual(2)
    }
  })
})
