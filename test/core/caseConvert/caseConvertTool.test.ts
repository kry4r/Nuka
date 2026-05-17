// test/core/caseConvert/caseConvertTool.test.ts
//
// Spec for the CaseConvertTool wrapper. Each action gets happy-path
// shape assertions plus the variants the task brief pinned (acronym
// preservation, mixed/unknown detection, the `parseHTTPResponse` round
// trip). Validation tests exercise both the missing-required and
// wrong-type rejection paths.

import { describe, expect, it } from 'vitest'
import {
  CASE_CONVERT_TOOL_NAME,
  CaseConvertTool,
  runCaseConvertTool,
  type CaseConvertToolResult,
} from '../../../src/core/caseConvert/caseConvertTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): CaseConvertToolResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as CaseConvertToolResult
}

// ─── metadata / schema ─────────────────────────────────────────────────

describe('CaseConvert tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(CaseConvertTool.name).toBe(CASE_CONVERT_TOOL_NAME)
    expect(CASE_CONVERT_TOOL_NAME).toBe('CaseConvert')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(CaseConvertTool.annotations?.readOnly).toBe(true)
    expect(CaseConvertTool.annotations?.parallelSafe).toBe(true)
    expect(
      CaseConvertTool.needsPermission({ action: 'camel', text: 'hi' }),
    ).toBe('none')
  })

  it('declares required action+text with the documented enum', () => {
    const params = CaseConvertTool.parameters as {
      required?: string[]
      properties?: Record<string, { type?: string; enum?: string[] }>
    }
    expect(params.required).toEqual(['action', 'text'])
    expect(params.properties?.action?.type).toBe('string')
    expect(params.properties?.action?.enum).toEqual([
      'camel',
      'pascal',
      'kebab',
      'snake',
      'constant',
      'title',
      'lower',
      'detect',
      'split',
    ])
  })

  it('loads under the core activation rule and surfaces case keywords', () => {
    expect(CaseConvertTool.tags).toContain('core')
    expect(CaseConvertTool.tags).toContain('caseConvert')
    expect(CaseConvertTool.searchHint).toContain('case')
    expect(CaseConvertTool.searchHint).toContain('camel')
    expect(CaseConvertTool.searchHint).toContain('kebab')
  })
})

// ─── action=camel ──────────────────────────────────────────────────────

describe('CaseConvert — action=camel', () => {
  it("'hello world' -> 'helloWorld'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'camel', text: 'hello world' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.action).toBe('camel')
    if (payload.action === 'camel') {
      expect(payload.result).toBe('helloWorld')
      expect(payload.detectedSourceCase).toBe('lower')
    }
  })

  it("'HELLO_WORLD' -> 'helloWorld' (detectedSourceCase=constant)", async () => {
    const r = await CaseConvertTool.run(
      { action: 'camel', text: 'HELLO_WORLD' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'camel') {
      expect(payload.result).toBe('helloWorld')
      expect(payload.detectedSourceCase).toBe('constant')
    }
  })
})

// ─── action=pascal ─────────────────────────────────────────────────────

describe('CaseConvert — action=pascal', () => {
  it("'hello-world' -> 'HelloWorld' (detectedSourceCase=kebab)", async () => {
    const r = await CaseConvertTool.run(
      { action: 'pascal', text: 'hello-world' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'pascal') {
      expect(payload.result).toBe('HelloWorld')
      expect(payload.detectedSourceCase).toBe('kebab')
    }
  })
})

// ─── action=kebab ──────────────────────────────────────────────────────

describe('CaseConvert — action=kebab', () => {
  it("'helloWorld' -> 'hello-world'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'kebab', text: 'helloWorld' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'kebab') {
      expect(payload.result).toBe('hello-world')
      expect(payload.detectedSourceCase).toBe('camel')
    }
  })

  it("'parseHTTPResponse' -> 'parse-http-response' (acronym preserved)", async () => {
    const r = await CaseConvertTool.run(
      { action: 'kebab', text: 'parseHTTPResponse' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'kebab') {
      expect(payload.result).toBe('parse-http-response')
    }
  })

  it("'parseHTTPResponse' with preserveAcronyms:false -> 'parse-h-t-t-p-response'", async () => {
    const r = await CaseConvertTool.run(
      {
        action: 'kebab',
        text: 'parseHTTPResponse',
        preserveAcronyms: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'kebab') {
      expect(payload.result).toBe('parse-h-t-t-p-response')
    }
  })
})

// ─── action=snake ──────────────────────────────────────────────────────

describe('CaseConvert — action=snake', () => {
  it("'HelloWorld' -> 'hello_world' (detectedSourceCase=pascal)", async () => {
    const r = await CaseConvertTool.run(
      { action: 'snake', text: 'HelloWorld' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'snake') {
      expect(payload.result).toBe('hello_world')
      expect(payload.detectedSourceCase).toBe('pascal')
    }
  })
})

// ─── action=constant ───────────────────────────────────────────────────

describe('CaseConvert — action=constant', () => {
  it("'hello world' -> 'HELLO_WORLD'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'constant', text: 'hello world' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'constant') {
      expect(payload.result).toBe('HELLO_WORLD')
    }
  })
})

// ─── action=title ──────────────────────────────────────────────────────

describe('CaseConvert — action=title', () => {
  it("'hello-world' -> 'Hello World'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'title', text: 'hello-world' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'title') {
      expect(payload.result).toBe('Hello World')
    }
  })
})

// ─── action=lower ──────────────────────────────────────────────────────

describe('CaseConvert — action=lower', () => {
  it("'HELLO_WORLD' -> 'hello world'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'lower', text: 'HELLO_WORLD' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'lower') {
      expect(payload.result).toBe('hello world')
    }
  })
})

// ─── action=detect ─────────────────────────────────────────────────────

describe('CaseConvert — action=detect', () => {
  it.each([
    ['helloWorld', 'camel'],
    ['HelloWorld', 'pascal'],
    ['hello-world', 'kebab'],
    ['hello_world', 'snake'],
    ['HELLO_WORLD', 'constant'],
    ['Hello World', 'title'],
    ['hello world', 'lower'],
  ])('detects %s -> %s', async (text, expected) => {
    const r = await CaseConvertTool.run(
      { action: 'detect', text },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'detect') {
      expect(payload.style).toBe(expected)
    }
  })

  it("detects mixed: 'helloWorld-foo' -> 'mixed'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'detect', text: 'helloWorld-foo' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'detect') {
      expect(payload.style).toBe('mixed')
    }
  })

  it("detects empty/no-letter input -> 'unknown'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'detect', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'detect') {
      expect(payload.style).toBe('unknown')
    }
  })
})

// ─── action=split ──────────────────────────────────────────────────────

describe('CaseConvert — action=split', () => {
  it("splits 'parseHTTPResponse_v2' into words (acronym preserved)", async () => {
    const r = await CaseConvertTool.run(
      { action: 'split', text: 'parseHTTPResponse_v2' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'split') {
      expect(payload.words).toEqual([
        'parse',
        'HTTP',
        'Response',
        'v',
        '2',
      ])
    }
  })

  it("splits with preserveAcronyms:false yields single-letter acronym pieces", async () => {
    const r = await CaseConvertTool.run(
      {
        action: 'split',
        text: 'parseHTTPResponse',
        preserveAcronyms: false,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'split') {
      expect(payload.words).toEqual([
        'parse',
        'H',
        'T',
        'T',
        'P',
        'Response',
      ])
    }
  })

  it('returns empty array for empty input', async () => {
    const r = await CaseConvertTool.run(
      { action: 'split', text: '' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    if (payload.action === 'split') {
      expect(payload.words).toEqual([])
    }
  })
})

// ─── validation ────────────────────────────────────────────────────────

describe('CaseConvert — validation', () => {
  it("rejects unknown 'action'", async () => {
    const r = await CaseConvertTool.run(
      // deliberate cast: simulating a stray client value
      { action: 'titlecase' as 'camel', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/unknown action/)
  })

  it("rejects non-string 'action'", async () => {
    const r = await CaseConvertTool.run(
      { action: 42 as unknown as 'camel', text: 'hi' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'action' must be a string/)
  })

  it("rejects non-string 'text'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'camel', text: 123 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'text' must be a string/)
  })

  it("rejects non-boolean 'preserveAcronyms'", async () => {
    const r = await CaseConvertTool.run(
      {
        action: 'camel',
        text: 'hi',
        preserveAcronyms: 'yes' as unknown as boolean,
      },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'preserveAcronyms' must be a boolean/)
  })

  it("rejects non-string 'locale'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'camel', text: 'hi', locale: 5 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'locale' must be a string/)
  })

  it("rejects empty 'locale'", async () => {
    const r = await CaseConvertTool.run(
      { action: 'camel', text: 'hi', locale: '' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/'locale' must be a non-empty string/)
  })

  it('rejects non-object input', async () => {
    const r = await CaseConvertTool.run(
      null as unknown as Parameters<typeof CaseConvertTool.run>[0],
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/input must be an object/)
  })
})

// ─── runCaseConvertTool (direct helper) ────────────────────────────────

describe('runCaseConvertTool — direct helper', () => {
  it('returns the same payload shape the Tool serializes', () => {
    const p = runCaseConvertTool({ action: 'kebab', text: 'helloWorld' })
    expect(p).toEqual({
      action: 'kebab',
      result: 'hello-world',
      detectedSourceCase: 'camel',
    })
  })

  it('locale option threads through to the underlying converter', () => {
    // Turkish dotted/dotless i: 'I' -> 'ı' in tr locale, 'i' invariant.
    const tr = runCaseConvertTool({
      action: 'lower',
      text: 'I',
      locale: 'tr-TR',
    })
    if (tr.action === 'lower') {
      expect(tr.result).toBe('ı')
    }
    const inv = runCaseConvertTool({ action: 'lower', text: 'I' })
    if (inv.action === 'lower') {
      expect(inv.result).toBe('i')
    }
  })
})
