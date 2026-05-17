// test/core/whitespace/whitespaceTool.test.ts
//
// Spec for the WhitespaceTool wrapper. Each action gets happy-path
// shape assertions plus the option variants the task brief pinned (so
// future refactors can't silently change the output vocabulary).
// Validation tests exercise both the missing-required and wrong-type
// rejection paths.

import { describe, expect, it } from 'vitest'
import {
  WHITESPACE_TOOL_NAME,
  WhitespaceTool,
  runWhitespaceTool,
  type WhitespaceToolInput,
  type WhitespaceToolResult,
} from '../../../src/core/whitespace/whitespaceTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): WhitespaceToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as WhitespaceToolResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('Whitespace tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(WhitespaceTool.name).toBe(WHITESPACE_TOOL_NAME)
    expect(WHITESPACE_TOOL_NAME).toBe('Whitespace')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(WhitespaceTool.annotations?.readOnly).toBe(true)
    expect(WhitespaceTool.annotations?.parallelSafe).toBe(true)
    expect(
      WhitespaceTool.needsPermission({
        action: 'normalize',
        text: 'hello',
      }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = WhitespaceTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'dedent',
      'trimTrailing',
      'trimBlank',
      'collapseBlank',
      'normalizeEol',
      'expandTabs',
      'normalize',
    ])
  })

  it('loads under the core activation rule and surfaces whitespace keywords', () => {
    expect(WhitespaceTool.tags).toContain('core')
    expect(WhitespaceTool.tags).toContain('whitespace')
    expect(WhitespaceTool.searchHint).toContain('whitespace')
    expect(WhitespaceTool.searchHint).toContain('dedent')
  })
})

// ─── action=dedent ─────────────────────────────────────────────────────

describe('Whitespace — action=dedent', () => {
  it('strips common leading indent from a multi-line block', async () => {
    const text = '    line1\n      line2\n    line3\n'
    const r = await WhitespaceTool.run({ action: 'dedent', text }, mkCtx())
    const payload = parsePayload(r)
    expect(payload.action).toBe('dedent')
    if (payload.action === 'dedent') {
      expect(payload.result).toBe('line1\n  line2\nline3\n')
      expect(payload.indentRemoved).toBe(4)
    }
  })

  it('no common indent → indentRemoved=0', async () => {
    const text = 'foo\n  bar\nbaz\n'
    const r = await WhitespaceTool.run({ action: 'dedent', text }, mkCtx())
    const payload = parsePayload(r)
    if (payload.action === 'dedent') {
      expect(payload.indentRemoved).toBe(0)
    }
  })

  it('respects tabWidth when measuring indent', async () => {
    // Both lines start with one tab. With tabWidth=4 that's 4 columns;
    // with tabWidth=8 that's 8 columns. Both should be fully stripped.
    const text = '\thello\n\tworld\n'
    const r4 = await WhitespaceTool.run(
      { action: 'dedent', text, tabWidth: 4 },
      mkCtx(),
    )
    const r8 = await WhitespaceTool.run(
      { action: 'dedent', text, tabWidth: 8 },
      mkCtx(),
    )
    const p4 = parsePayload(r4)
    const p8 = parsePayload(r8)
    if (p4.action === 'dedent' && p8.action === 'dedent') {
      expect(p4.indentRemoved).toBe(4)
      expect(p8.indentRemoved).toBe(8)
    }
  })
})

// ─── action=trimTrailing ───────────────────────────────────────────────

describe('Whitespace — action=trimTrailing', () => {
  it('strips trailing spaces per line', async () => {
    const r = await WhitespaceTool.run(
      { action: 'trimTrailing', text: 'foo  \nbar  \n' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('trimTrailing')
    if (payload.action === 'trimTrailing') {
      expect(payload.result).toBe('foo\nbar\n')
      expect(payload.linesChanged).toBe(2)
    }
  })

  it('no trailing whitespace → linesChanged=0', async () => {
    const r = await WhitespaceTool.run(
      { action: 'trimTrailing', text: 'foo\nbar\n' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'trimTrailing') {
      expect(payload.result).toBe('foo\nbar\n')
      expect(payload.linesChanged).toBe(0)
    }
  })
})

// ─── action=trimBlank ──────────────────────────────────────────────────

describe('Whitespace — action=trimBlank', () => {
  it('drops blank lines from both edges and reports counts', async () => {
    const r = await WhitespaceTool.run(
      { action: 'trimBlank', text: '\n\nhello\nworld\n\n\n' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('trimBlank')
    if (payload.action === 'trimBlank') {
      expect(payload.result).toBe('hello\nworld\n')
      expect(payload.leadingTrimmed).toBe(2)
      expect(payload.trailingTrimmed).toBe(2)
    }
  })

  it('no edge blanks → both counts zero', async () => {
    const r = await WhitespaceTool.run(
      { action: 'trimBlank', text: 'a\nb\nc' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'trimBlank') {
      expect(payload.leadingTrimmed).toBe(0)
      expect(payload.trailingTrimmed).toBe(0)
    }
  })
})

// ─── action=collapseBlank ──────────────────────────────────────────────

describe('Whitespace — action=collapseBlank', () => {
  it('5 consecutive blanks → 1 blank by default', async () => {
    const r = await WhitespaceTool.run(
      { action: 'collapseBlank', text: 'a\n\n\n\n\n\nb' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('collapseBlank')
    if (payload.action === 'collapseBlank') {
      // 'a' + (run of 5 blank lines becomes 1 blank) + 'b' → 'a\n\nb'
      expect(payload.result).toBe('a\n\nb')
    }
  })

  it('maxConsecutive=0 removes all blanks', async () => {
    const r = await WhitespaceTool.run(
      { action: 'collapseBlank', text: 'a\n\n\nb', maxConsecutive: 0 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'collapseBlank') {
      expect(payload.result).toBe('a\nb')
    }
  })

  it('maxConsecutive=2 keeps up to two blanks', async () => {
    const r = await WhitespaceTool.run(
      { action: 'collapseBlank', text: 'a\n\n\n\nb', maxConsecutive: 2 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'collapseBlank') {
      expect(payload.result).toBe('a\n\n\nb')
    }
  })
})

// ─── action=normalizeEol ───────────────────────────────────────────────

describe('Whitespace — action=normalizeEol', () => {
  it('CRLF → LF by default', async () => {
    const r = await WhitespaceTool.run(
      { action: 'normalizeEol', text: 'foo\r\nbar\r\n' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('normalizeEol')
    if (payload.action === 'normalizeEol') {
      expect(payload.result).toBe('foo\nbar\n')
    }
  })

  it('LF → CRLF when to=crlf', async () => {
    const r = await WhitespaceTool.run(
      { action: 'normalizeEol', text: 'foo\nbar\n', to: 'crlf' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalizeEol') {
      expect(payload.result).toBe('foo\r\nbar\r\n')
    }
  })

  it('mixed CR/CRLF/LF → LF', async () => {
    const r = await WhitespaceTool.run(
      { action: 'normalizeEol', text: 'a\r\nb\rc\nd' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalizeEol') {
      expect(payload.result).toBe('a\nb\nc\nd')
    }
  })
})

// ─── action=expandTabs ─────────────────────────────────────────────────

describe('Whitespace — action=expandTabs', () => {
  it('"\\t" → 8 spaces by default', async () => {
    const r = await WhitespaceTool.run(
      { action: 'expandTabs', text: '\t' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('expandTabs')
    if (payload.action === 'expandTabs') {
      expect(payload.result).toBe(' '.repeat(8))
    }
  })

  it('respects tabWidth=4', async () => {
    const r = await WhitespaceTool.run(
      { action: 'expandTabs', text: 'a\tb', tabWidth: 4 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'expandTabs') {
      // 'a' is at col 0; tab moves to next multiple of 4 → 3 spaces.
      expect(payload.result).toBe('a   b')
    }
  })

  it('no tabs in input → unchanged', async () => {
    const r = await WhitespaceTool.run(
      { action: 'expandTabs', text: 'plain text' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'expandTabs') {
      expect(payload.result).toBe('plain text')
    }
  })
})

// ─── action=normalize ──────────────────────────────────────────────────

describe('Whitespace — action=normalize', () => {
  it('defaults — dedent + trimTrailing + collapseBlanks + trimEdges + lf', async () => {
    // The defaults pipeline mirrors `normalize()`: tabs preserved
    // (expandTabs=false), dedent on, trimTrailing on, collapseBlanks=1,
    // trimEdges on, lineEndings='lf'. Input has all five "problems".
    const text = '  \n    foo  \n    bar\n\n\n    baz  \n  \n'
    const r = await WhitespaceTool.run(
      { action: 'normalize', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('normalize')
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('foo\nbar\n\nbaz\n')
    }
  })

  it('disable dedent → leading indent preserved', async () => {
    const text = '    foo\n    bar\n'
    const r = await WhitespaceTool.run(
      { action: 'normalize', text, dedent: false },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('    foo\n    bar\n')
    }
  })

  it('disable trimTrailing → trailing spaces survive', async () => {
    // We have to also disable trimEdges to keep the trailing
    // newline-with-spaces, but the *interior* trailing run is what we
    // care about here.
    const text = 'foo   \nbar\n'
    const r = await WhitespaceTool.run(
      { action: 'normalize', text, trimTrailing: false, dedent: false },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('foo   \nbar\n')
    }
  })

  it('disable collapseBlanks → blank-line runs survive', async () => {
    const text = 'a\n\n\n\nb\n'
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text,
        collapseBlanks: false,
        dedent: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      // trimEdges still applies (default true), but interior blanks
      // remain because collapseBlanks is off.
      expect(payload.result).toBe('a\n\n\n\nb\n')
    }
  })

  it('collapseBlanks=2 keeps up to two blanks', async () => {
    const text = 'a\n\n\n\nb\n'
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text,
        collapseBlanks: 2,
        dedent: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('a\n\n\nb\n')
    }
  })

  it('disable trimEdges → leading/trailing blanks survive', async () => {
    const text = '\nfoo\n\n'
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text,
        trimEdges: false,
        dedent: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      // collapseBlanks=1 reduces both edge runs to single blanks.
      expect(payload.result).toBe('\nfoo\n\n')
    }
  })

  it('lineEndings=crlf → output uses CRLF', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'foo\nbar\n',
        lineEndings: 'crlf',
        dedent: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('foo\r\nbar\r\n')
    }
  })

  it('lineEndings=false → preserve incoming style', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'foo\r\nbar\r\n',
        lineEndings: false,
        dedent: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      // Without explicit eol normalization, the helpers' interior
      // routines may or may not re-emit CRLF. We only require that
      // CRLF *survives* — i.e. it's not silently dropped to LF.
      expect(payload.result).toMatch(/\r\n/)
    }
  })

  it('expandTabs=number → tabs converted before dedent', async () => {
    // The pipeline runs expandTabs first, so a leading tab becomes
    // spaces and then dedent strips the common indent.
    const text = '\tfoo\n\tbar\n'
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text,
        expandTabs: 4,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'normalize') {
      expect(payload.result).toBe('foo\nbar\n')
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('Whitespace — validation', () => {
  it('rejects an invalid action with a structured error', async () => {
    const r = await WhitespaceTool.run(
      { action: 'bogus', text: 'hi' } as unknown as WhitespaceToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown action 'bogus'/)
  })

  it('rejects a non-string action', async () => {
    const r = await WhitespaceTool.run(
      { action: 42 as unknown as 'dedent', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'action' must be a string/)
  })

  it('rejects missing text', async () => {
    const r = await WhitespaceTool.run(
      { action: 'dedent' } as unknown as WhitespaceToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects non-string text', async () => {
    const r = await WhitespaceTool.run(
      { action: 'dedent', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it('rejects tabWidth=0 on dedent', async () => {
    const r = await WhitespaceTool.run(
      { action: 'dedent', text: 'hi', tabWidth: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'tabWidth' must be a positive integer/)
  })

  it('rejects negative tabWidth on expandTabs', async () => {
    const r = await WhitespaceTool.run(
      { action: 'expandTabs', text: 'hi', tabWidth: -3 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'tabWidth' must be a positive integer/)
  })

  it('rejects negative maxConsecutive on collapseBlank', async () => {
    const r = await WhitespaceTool.run(
      { action: 'collapseBlank', text: 'hi', maxConsecutive: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(
      /'maxConsecutive' must be a non-negative integer/,
    )
  })

  it('rejects unknown `to` on normalizeEol', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalizeEol',
        text: 'hi',
        to: 'cr' as unknown as 'lf',
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown 'to' value/)
  })

  it('rejects non-boolean normalize.dedent', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'hi',
        dedent: 'yes' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'dedent' must be a boolean/)
  })

  it('rejects malformed normalize.collapseBlanks', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'hi',
        collapseBlanks: 'maybe' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(
      /'collapseBlanks' must be a boolean or number/,
    )
  })

  it('rejects negative number for normalize.collapseBlanks', async () => {
    const r = await WhitespaceTool.run(
      { action: 'normalize', text: 'hi', collapseBlanks: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(
      /'collapseBlanks' must be a non-negative integer/,
    )
  })

  it('rejects unknown normalize.lineEndings', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'hi',
        lineEndings: 'cr' as unknown as 'lf',
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(
      /'lineEndings' must be 'lf', 'crlf', or false/,
    )
  })

  it('rejects non-number, non-false normalize.expandTabs', async () => {
    const r = await WhitespaceTool.run(
      {
        action: 'normalize',
        text: 'hi',
        expandTabs: 'wide' as unknown as number,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(
      /'expandTabs' must be a number or false/,
    )
  })

  it('rejects non-object input', async () => {
    const r = await WhitespaceTool.run(
      null as unknown as WhitespaceToolInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/input must be an object/)
  })
})

// ─── exported pure helper ──────────────────────────────────────────────

describe('runWhitespaceTool — direct invocation', () => {
  it('returns the same shape as the Tool run', () => {
    const payload = runWhitespaceTool({
      action: 'dedent',
      text: '    a\n    b\n',
    })
    expect(payload.action).toBe('dedent')
    if (payload.action === 'dedent') {
      expect(payload.result).toBe('a\nb\n')
      expect(payload.indentRemoved).toBe(4)
    }
  })

  it('forwards options to the underlying helpers', () => {
    const payload = runWhitespaceTool({
      action: 'collapseBlank',
      text: 'a\n\n\n\nb',
      maxConsecutive: 2,
    })
    if (payload.action === 'collapseBlank') {
      expect(payload.result).toBe('a\n\n\nb')
    }
  })
})
