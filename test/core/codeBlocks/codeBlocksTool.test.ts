// test/core/codeBlocks/codeBlocksTool.test.ts
//
// Spec for the CodeBlocksTool wrapper. Each action gets a happy-path
// shape assertion plus the edge cases the user prompt pinned (empty
// text, no-match findFirst, multi-block unwrap returning null).
// Validation tests cover the unknown-action, wrong-type, and
// missing-text rejection paths.

import { describe, expect, it } from 'vitest'
import {
  CODE_BLOCKS_TOOL_NAME,
  CodeBlocksTool,
  runCodeBlocks,
  type CodeBlocksInput,
  type CodeBlocksResult,
} from '../../../src/core/codeBlocks/codeBlocksTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): CodeBlocksResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as CodeBlocksResult
}

describe('CodeBlocks tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(CodeBlocksTool.name).toBe(CODE_BLOCKS_TOOL_NAME)
    expect(CODE_BLOCKS_TOOL_NAME).toBe('CodeBlocks')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(CodeBlocksTool.annotations?.readOnly).toBe(true)
    expect(CodeBlocksTool.annotations?.parallelSafe).toBe(true)
    expect(
      CodeBlocksTool.needsPermission({ action: 'extract', text: '' }),
    ).toBe('none')
  })

  it('declares required action/text with the documented enum', () => {
    const params = CodeBlocksTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string | string[]; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'extract',
      'split',
      'findFirst',
      'unwrap',
    ])
    expect(params.properties?.text?.type).toBe('string')
  })

  it('loads under the core activation rule and surfaces fence keywords', () => {
    expect(CodeBlocksTool.tags).toContain('core')
    expect(CodeBlocksTool.tags).toContain('code-blocks')
    expect(CodeBlocksTool.searchHint).toContain('fence')
    expect(CodeBlocksTool.searchHint).toContain('markdown')
  })
})

// ─── action='extract' ───────────────────────────────────────────────

describe('CodeBlocks — action=extract', () => {
  it('returns every block with lang and 1-based line numbers', async () => {
    const text = [
      'intro line',
      '```ts',
      'const x = 1',
      '```',
      'gap text',
      '```python',
      'print("hi")',
      'print("bye")',
      '```',
    ].join('\n')
    const r = await CodeBlocksTool.run(
      { action: 'extract', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('extract')
    if (payload.action !== 'extract') return // narrowing
    expect(payload.count).toBe(2)
    expect(payload.blocks.length).toBe(2)

    const [a, b] = payload.blocks
    expect(a!.lang).toBe('ts')
    expect(a!.content).toBe('const x = 1\n')
    expect(a!.startLine).toBe(2)
    expect(a!.endLine).toBe(4)
    expect(a!.closed).toBe(true)
    expect(a!.fenceChar).toBe('`')
    expect(a!.fenceLength).toBe(3)

    expect(b!.lang).toBe('python')
    expect(b!.content).toBe('print("hi")\nprint("bye")\n')
    expect(b!.startLine).toBe(6)
    expect(b!.endLine).toBe(9)
    expect(b!.closed).toBe(true)
  })

  it('returns an empty array for empty text', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'extract', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'extract', blocks: [], count: 0 })
  })

  it('returns an empty array for text with no fenced blocks', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'extract', text: 'just prose\nno code here' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'extract') throw new Error('wrong action')
    expect(payload.count).toBe(0)
    expect(payload.blocks).toEqual([])
  })

  it('marks unclosed blocks with closed=false', async () => {
    const text = 'open\n```\nstill in code'
    const r = await CodeBlocksTool.run(
      { action: 'extract', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'extract') throw new Error('wrong action')
    expect(payload.count).toBe(1)
    expect(payload.blocks[0]!.closed).toBe(false)
  })
})

// ─── action='split' ─────────────────────────────────────────────────

describe('CodeBlocks — action=split', () => {
  it('returns interleaved prose/code segments in document order', async () => {
    const text = [
      'lead prose',
      '```js',
      'a()',
      '```',
      'tail prose',
    ].join('\n')
    const r = await CodeBlocksTool.run(
      { action: 'split', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'split') throw new Error('wrong action')
    expect(payload.segments.length).toBe(3)

    const [s0, s1, s2] = payload.segments
    expect(s0!.type).toBe('prose')
    expect(s1!.type).toBe('code')
    expect(s2!.type).toBe('prose')

    if (s1!.type === 'code') {
      expect(s1!.lang).toBe('js')
      expect(s1!.content).toBe('a()\n')
    }

    // proseChars + codeChars sum to the chars in their segments.
    let proseSum = 0
    let codeSum = 0
    for (const s of payload.segments) {
      if (s.type === 'prose') proseSum += s.content.length
      else codeSum += s.content.length
    }
    expect(payload.proseChars).toBe(proseSum)
    expect(payload.codeChars).toBe(codeSum)
  })

  it('returns a single prose segment when text has no fences', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'split', text: 'pure prose' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'split') throw new Error('wrong action')
    expect(payload.segments.length).toBe(1)
    expect(payload.segments[0]!.type).toBe('prose')
    expect(payload.codeChars).toBe(0)
  })
})

// ─── action='findFirst' ─────────────────────────────────────────────

describe('CodeBlocks — action=findFirst', () => {
  const textMulti = [
    '```ts',
    'const a = 1',
    '```',
    'gap',
    '```python',
    'print("hi")',
    '```',
    '',
    '```ts',
    'const b = 2',
    '```',
  ].join('\n')

  it('with lang filter — returns the first matching block', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text: textMulti, lang: 'python' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'findFirst') throw new Error('wrong action')
    expect(payload.block).not.toBeNull()
    expect(payload.block!.lang).toBe('python')
    expect(payload.block!.content).toBe('print("hi")\n')
  })

  it('with lang filter — case-insensitive', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text: textMulti, lang: 'PYTHON' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'findFirst') throw new Error('wrong action')
    expect(payload.block).not.toBeNull()
    expect(payload.block!.lang).toBe('python')
  })

  it('with lang filter — no match returns null', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text: textMulti, lang: 'rust' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'findFirst', block: null })
  })

  it('without lang filter — returns the first block of any lang', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text: textMulti },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'findFirst') throw new Error('wrong action')
    expect(payload.block).not.toBeNull()
    expect(payload.block!.lang).toBe('ts')
    expect(payload.block!.content).toBe('const a = 1\n')
  })

  it('without lang filter — empty text returns null', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'findFirst', block: null })
  })
})

// ─── action='unwrap' ────────────────────────────────────────────────

describe('CodeBlocks — action=unwrap', () => {
  it('unwraps a single fenced block to its inner content', async () => {
    const text = '```ts\nconst x = 1\nconst y = 2\n```'
    const r = await CodeBlocksTool.run(
      { action: 'unwrap', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({
      action: 'unwrap',
      unwrapped: 'const x = 1\nconst y = 2\n',
    })
  })

  it('unwraps with surrounding whitespace-only prose', async () => {
    const text = '\n\n```\ninner\n```\n  \n'
    const r = await CodeBlocksTool.run(
      { action: 'unwrap', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'unwrap') throw new Error('wrong action')
    expect(payload.unwrapped).toBe('inner\n')
  })

  it('returns null when prose surrounds the block', async () => {
    const text = 'prose here\n```\ncode\n```'
    const r = await CodeBlocksTool.run(
      { action: 'unwrap', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'unwrap', unwrapped: null })
  })

  it('returns null when there are multiple fenced blocks', async () => {
    const text = '```\none\n```\n```\ntwo\n```'
    const r = await CodeBlocksTool.run(
      { action: 'unwrap', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'unwrap', unwrapped: null })
  })

  it('returns null for empty text', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'unwrap', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({ action: 'unwrap', unwrapped: null })
  })
})

// ─── input validation ──────────────────────────────────────────────

describe('CodeBlocks — input validation', () => {
  it('rejects an unknown action', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'bogus' as unknown as CodeBlocksInput['action'], text: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/unknown action 'bogus'/)
  })

  it('rejects a non-string action', async () => {
    const r = await CodeBlocksTool.run(
      { action: 42 as unknown as CodeBlocksInput['action'], text: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'action' must be a string/)
  })

  it('empty text still works (returns empty result)', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'extract', text: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const payload = parsePayload(r)
    if (payload.action !== 'extract') throw new Error('wrong action')
    expect(payload.count).toBe(0)
  })

  it('rejects missing text', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'extract' } as unknown as CodeBlocksInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'text' must be a string/)
  })

  it('rejects a non-string text', async () => {
    const r = await CodeBlocksTool.run(
      { action: 'extract', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'text' must be a string/)
  })

  it('rejects a non-string lang on findFirst', async () => {
    const r = await CodeBlocksTool.run(
      {
        action: 'findFirst',
        text: 'x',
        lang: 42 as unknown as string,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'lang' must be a string/)
  })

  it('accepts lang=null (matches blocks with no info string)', async () => {
    const text = '```\nbare\n```\n```ts\ntyped\n```'
    const r = await CodeBlocksTool.run(
      { action: 'findFirst', text, lang: null },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action !== 'findFirst') throw new Error('wrong action')
    expect(payload.block).not.toBeNull()
    expect(payload.block!.lang).toBeNull()
    expect(payload.block!.content).toBe('bare\n')
  })
})

// ─── direct helper (bypasses Tool surface) ──────────────────────────

describe('runCodeBlocks — direct call', () => {
  it('extract returns the same shape as the Tool surface', () => {
    const out = runCodeBlocks({ action: 'extract', text: '```\nx\n```' })
    expect(out.action).toBe('extract')
    if (out.action === 'extract') {
      expect(out.count).toBe(1)
    }
  })
})
