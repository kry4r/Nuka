// test/core/glob/globTool.test.ts
//
// Spec for the GlobMatchTool wrapper. Each action gets happy-path
// shape assertions plus the option variants the user prompt pinned
// (so future refactors can't silently change the output vocabulary).
// Validation tests exercise both the missing-required and wrong-type
// rejection paths.

import { describe, expect, it } from 'vitest'
import {
  GLOB_MATCH_TOOL_NAME,
  GlobMatchTool,
  runGlobMatchTool,
  type GlobMatchInput,
  type GlobMatchResult,
} from '../../../src/core/glob/globTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): GlobMatchResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as GlobMatchResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('GlobMatch tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(GlobMatchTool.name).toBe(GLOB_MATCH_TOOL_NAME)
    expect(GLOB_MATCH_TOOL_NAME).toBe('GlobMatch')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(GlobMatchTool.annotations?.readOnly).toBe(true)
    expect(GlobMatchTool.annotations?.parallelSafe).toBe(true)
    expect(
      GlobMatchTool.needsPermission({
        action: 'match',
        pattern: '*.ts',
        path: 'foo.ts',
      }),
    ).toBe('none')
  })

  it('declares required action+pattern with the documented enum', () => {
    const params = GlobMatchTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'pattern'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'match',
      'matchMany',
      'expandBraces',
    ])
  })

  it('loads under the core activation rule and surfaces glob keywords', () => {
    expect(GlobMatchTool.tags).toContain('core')
    expect(GlobMatchTool.tags).toContain('glob')
    expect(GlobMatchTool.searchHint).toContain('glob')
    expect(GlobMatchTool.searchHint).toContain('pattern')
  })
})

// ─── action='match' ────────────────────────────────────────────────────

describe('GlobMatch — action=match', () => {
  it("matches '*.ts' against 'foo.ts'", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*.ts', path: 'foo.ts' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload).toEqual({
      action: 'match',
      matched: true,
      pattern: '*.ts',
      path: 'foo.ts',
    })
  })

  it("does not match '*.ts' against 'foo.txt'", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*.ts', path: 'foo.txt' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(false)
      expect(payload.pattern).toBe('*.ts')
      expect(payload.path).toBe('foo.txt')
    }
  })

  it("matches '**/*.ts' against 'a/b/c.ts' (multi-segment globstar)", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '**/*.ts', path: 'a/b/c.ts' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(true)
    }
  })

  it("matches '*.TXT' against 'foo.txt' when caseInsensitive:true", async () => {
    const r = await GlobMatchTool.run(
      {
        action: 'match',
        pattern: '*.TXT',
        path: 'foo.txt',
        caseInsensitive: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(true)
    }
  })

  it("does NOT match '*.TXT' against 'foo.txt' by default (case-sensitive)", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*.TXT', path: 'foo.txt' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(false)
    }
  })

  it("does NOT match '*' against '.hidden' when dot:false (default)", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*', path: '.hidden', dot: false },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(false)
    }
  })

  it("matches '*' against '.hidden' when dot:true", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*', path: '.hidden', dot: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'match') {
      expect(payload.matched).toBe(true)
    }
  })
})

// ─── action='matchMany' ────────────────────────────────────────────────

describe('GlobMatch — action=matchMany', () => {
  it('filters an array of paths against the pattern', async () => {
    const paths = ['a.ts', 'b.txt', 'c.ts', 'd.md', 'e.ts']
    const r = await GlobMatchTool.run(
      { action: 'matchMany', pattern: '*.ts', paths },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('matchMany')
    if (payload.action === 'matchMany') {
      expect(payload.matches).toEqual(['a.ts', 'c.ts', 'e.ts'])
      expect(payload.total).toBe(5)
      expect(payload.matched).toBe(3)
    }
  })

  it('preserves original order in matches', async () => {
    const paths = ['z.ts', 'a.ts', 'm.ts']
    const r = await GlobMatchTool.run(
      { action: 'matchMany', pattern: '*.ts', paths },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'matchMany') {
      expect(payload.matches).toEqual(['z.ts', 'a.ts', 'm.ts'])
    }
  })

  it('returns no matches when nothing matches', async () => {
    const paths = ['a.txt', 'b.md']
    const r = await GlobMatchTool.run(
      { action: 'matchMany', pattern: '*.ts', paths },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'matchMany') {
      expect(payload.matches).toEqual([])
      expect(payload.total).toBe(2)
      expect(payload.matched).toBe(0)
    }
  })

  it('forwards caseInsensitive into the compiled matcher', async () => {
    const r = await GlobMatchTool.run(
      {
        action: 'matchMany',
        pattern: '*.TS',
        paths: ['a.ts', 'b.TS', 'c.tx'],
        caseInsensitive: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'matchMany') {
      expect(payload.matches).toEqual(['a.ts', 'b.TS'])
      expect(payload.matched).toBe(2)
    }
  })

  it('rejects an empty paths array (must be non-empty)', async () => {
    const r = await GlobMatchTool.run(
      { action: 'matchMany', pattern: '*.ts', paths: [] },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/non-empty/)
  })
})

// ─── action='expandBraces' ─────────────────────────────────────────────

describe('GlobMatch — action=expandBraces', () => {
  it("expands 'a/{b,c}/d' into 2 patterns", async () => {
    const r = await GlobMatchTool.run(
      { action: 'expandBraces', pattern: 'a/{b,c}/d' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('expandBraces')
    if (payload.action === 'expandBraces') {
      expect(payload.patterns).toEqual(['a/b/d', 'a/c/d'])
      expect(payload.original).toBe('a/{b,c}/d')
    }
  })

  it('returns 1 pattern (the original) when there are no braces', async () => {
    const r = await GlobMatchTool.run(
      { action: 'expandBraces', pattern: 'no.braces' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'expandBraces') {
      expect(payload.patterns).toEqual(['no.braces'])
      expect(payload.patterns.length).toBe(1)
      expect(payload.original).toBe('no.braces')
    }
  })

  it('expands nested braces correctly', async () => {
    const r = await GlobMatchTool.run(
      { action: 'expandBraces', pattern: 'a/{b,c}/{x,y}' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'expandBraces') {
      expect(payload.patterns).toEqual([
        'a/b/x',
        'a/b/y',
        'a/c/x',
        'a/c/y',
      ])
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('GlobMatch — validation', () => {
  it('rejects missing pattern', async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', path: 'foo.ts' } as unknown as GlobMatchInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'pattern' must be a string/)
  })

  it("rejects 'match' without path", async () => {
    const r = await GlobMatchTool.run(
      { action: 'match', pattern: '*.ts' } as unknown as GlobMatchInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/action='match'/)
    expect(r.output).toMatch(/'path' must be a string/)
  })

  it("rejects 'matchMany' without paths", async () => {
    const r = await GlobMatchTool.run(
      { action: 'matchMany', pattern: '*.ts' } as unknown as GlobMatchInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'paths' must be an array/)
  })

  it("rejects 'matchMany' with a non-string element in paths", async () => {
    const r = await GlobMatchTool.run(
      {
        action: 'matchMany',
        pattern: '*.ts',
        paths: ['a.ts', 42 as unknown as string, 'b.ts'],
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'paths\[1\]' must be a string/)
  })

  it('rejects unknown action', async () => {
    const r = await GlobMatchTool.run(
      { action: 'glob' as unknown as 'match', pattern: '*.ts' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/unknown action 'glob'/)
  })

  it("rejects non-boolean caseInsensitive", async () => {
    const r = await GlobMatchTool.run(
      {
        action: 'match',
        pattern: '*.ts',
        path: 'foo.ts',
        caseInsensitive: 'yes' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'caseInsensitive' must be a boolean/)
  })

  it("rejects non-boolean dot", async () => {
    const r = await GlobMatchTool.run(
      {
        action: 'match',
        pattern: '*',
        path: 'foo',
        dot: 1 as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/'dot' must be a boolean/)
  })

  it('rejects non-object input', async () => {
    const r = await GlobMatchTool.run(
      null as unknown as GlobMatchInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/input must be an object/)
  })
})

// ─── direct helper round-trip ─────────────────────────────────────────

describe('runGlobMatchTool — direct helper round-trip', () => {
  it('returns the same shape as the tool output for each action', () => {
    const m = runGlobMatchTool({
      action: 'match',
      pattern: '*.ts',
      path: 'foo.ts',
    })
    expect(m).toEqual({
      action: 'match',
      matched: true,
      pattern: '*.ts',
      path: 'foo.ts',
    })

    const mm = runGlobMatchTool({
      action: 'matchMany',
      pattern: '*.ts',
      paths: ['a.ts', 'b.txt'],
    })
    expect(mm).toEqual({
      action: 'matchMany',
      matches: ['a.ts'],
      total: 2,
      matched: 1,
    })

    const eb = runGlobMatchTool({
      action: 'expandBraces',
      pattern: 'a.{js,ts}',
    })
    expect(eb).toEqual({
      action: 'expandBraces',
      patterns: ['a.js', 'a.ts'],
      original: 'a.{js,ts}',
    })
  })
})
