// test/core/jsonFormat/jsonFormatTool.test.ts
//
// Spec for the JsonFormatTool wrapper. Covers the documented input
// surface (value XOR valueText), the option pass-through (indent,
// sortKeys, compact, maxDepth, maxStringLength), and the validation
// rejections (missing both / both supplied / non-numeric option /
// malformed JSON text). The pure-helper coverage lives in
// `jsonFormat.test.ts`; here we only assert the Tool wiring.

import { describe, expect, it } from 'vitest'
import {
  JSON_FORMAT_TOOL_NAME,
  JsonFormatTool,
  runJsonFormat,
  type JsonFormatInput,
  type JsonFormatResult,
} from '../../../src/core/jsonFormat/jsonFormatTool'
import type { ToolContext, ToolResult } from '../../../src/core/tools/types'

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return { signal, cwd: process.cwd() }
}

function parsePayload(r: ToolResult): JsonFormatResult {
  expect(r.isError).toBe(false)
  expect(typeof r.output).toBe('string')
  return JSON.parse(r.output as string) as JsonFormatResult
}

// ─── metadata ────────────────────────────────────────────────────

describe('JsonFormat tool — schema + metadata', () => {
  it('exposes the documented name', () => {
    expect(JsonFormatTool.name).toBe(JSON_FORMAT_TOOL_NAME)
    expect(JSON_FORMAT_TOOL_NAME).toBe('JsonFormat')
  })

  it('is read-only, parallel-safe, and needs no permissions', () => {
    expect(JsonFormatTool.annotations?.readOnly).toBe(true)
    expect(JsonFormatTool.annotations?.parallelSafe).toBe(true)
    expect(JsonFormatTool.needsPermission({ value: null })).toBe('none')
  })

  it('loads under the core activation rule and surfaces format keywords', () => {
    expect(JsonFormatTool.tags).toContain('core')
    expect(JsonFormatTool.tags).toContain('jsonFormat')
    expect(JsonFormatTool.searchHint).toContain('json')
    expect(JsonFormatTool.searchHint).toContain('pretty')
  })

  it('declares the documented option properties on the JSON schema', () => {
    const params = JsonFormatTool.parameters as {
      properties?: Record<string, unknown>
    }
    const props = params.properties ?? {}
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'value',
        'valueText',
        'indent',
        'maxLineLength',
        'maxDepth',
        'maxArrayLength',
        'maxStringLength',
        'sortKeys',
        'compact',
      ]),
    )
  })
})

// ─── happy paths ────────────────────────────────────────────────

describe('JsonFormat — direct value', () => {
  it('formats a simple object with default indent=2', async () => {
    // Force multi-line by setting a tiny maxLineLength.
    const r = await JsonFormatTool.run(
      { value: { a: 1, b: 'hi' }, maxLineLength: 5 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.inputType).toBe('value')
    expect(payload.result).toContain('\n')
    expect(payload.result).toContain('  "a": 1')
    expect(payload.result).toContain('  "b": "hi"')
  })

  it('inlines small values within the default budget', async () => {
    const r = await JsonFormatTool.run({ value: [1, 2, 3] }, mkCtx())
    const payload = parsePayload(r)
    expect(payload.result).toBe('[1, 2, 3]')
    expect(payload.truncationsApplied).toBe(false)
  })

  it('accepts null as a direct value (not treated as absent)', async () => {
    const r = await JsonFormatTool.run({ value: null }, mkCtx())
    const payload = parsePayload(r)
    expect(payload.result).toBe('null')
    expect(payload.inputType).toBe('value')
  })

  it('accepts string / number / boolean roots', async () => {
    const cases: Array<{ input: unknown; expected: string }> = [
      { input: 'hello', expected: '"hello"' },
      { input: 42, expected: '42' },
      { input: true, expected: 'true' },
    ]
    for (const c of cases) {
      const r = await JsonFormatTool.run({ value: c.input }, mkCtx())
      const payload = parsePayload(r)
      expect(payload.result).toBe(c.expected)
    }
  })
})

describe('JsonFormat — valueText', () => {
  it('parses then formats', async () => {
    const r = await JsonFormatTool.run(
      { valueText: '{"a":1,"b":2}' },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.inputType).toBe('valueText')
    // Default inline budget keeps this on one line.
    expect(payload.result).toBe('{ "a": 1, "b": 2 }')
  })

  it('returns a structured invalid-JSON error for malformed text', async () => {
    const r = await JsonFormatTool.run(
      { valueText: '{ not: json }' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(typeof r.output).toBe('string')
    expect(r.output as string).toMatch(/invalid JSON in 'valueText'/)
  })
})

// ─── option pass-through ────────────────────────────────────────

describe('JsonFormat — compact mode', () => {
  it('forces single-line output regardless of size', async () => {
    const r = await JsonFormatTool.run(
      {
        value: { a: 'this-is-a-really-long-name', b: 'and-another' },
        compact: true,
      },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).not.toContain('\n')
    // `formatJSONCompact` is `formatJSON` with maxLineLength=Infinity —
    // separators remain spaced; what we get is "force single-line".
    expect(payload.result).toBe(
      '{ "a": "this-is-a-really-long-name", "b": "and-another" }',
    )
  })

  it('produces single-line output even when the same value would expand in non-compact mode', async () => {
    const value = { a: 'this-is-a-really-long-name', b: 'and-another' }
    const expanded = await JsonFormatTool.run(
      { value, maxLineLength: 20 },
      mkCtx(),
    )
    const compact = await JsonFormatTool.run(
      { value, maxLineLength: 20, compact: true },
      mkCtx(),
    )
    expect(parsePayload(expanded).result).toContain('\n')
    expect(parsePayload(compact).result).not.toContain('\n')
  })
})

describe('JsonFormat — maxLineLength', () => {
  it('inlines when fits', async () => {
    const r = await JsonFormatTool.run(
      { value: { a: 1, b: 2 }, maxLineLength: 80 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).not.toContain('\n')
  })

  it('expands when over budget', async () => {
    const r = await JsonFormatTool.run(
      { value: { a: 1, b: 2, c: 3 }, maxLineLength: 5 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).toContain('\n')
  })
})

describe('JsonFormat — sortKeys', () => {
  it('preserves insertion order when sortKeys absent', async () => {
    const r = await JsonFormatTool.run(
      { value: { b: 1, a: 2, c: 3 } },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).toBe('{ "b": 1, "a": 2, "c": 3 }')
  })

  it('sorts alphabetically when sortKeys=true', async () => {
    const r = await JsonFormatTool.run(
      { value: { b: 1, a: 2, c: 3 }, sortKeys: true },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).toBe('{ "a": 2, "b": 1, "c": 3 }')
  })
})

describe('JsonFormat — maxDepth', () => {
  it('replaces deeply nested nodes with ellipsis and sets truncationsApplied', async () => {
    const r = await JsonFormatTool.run(
      { value: { a: { b: { c: { d: 1 } } } }, maxDepth: 2 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    expect(payload.result).toContain('"…"')
    expect(payload.result).not.toContain('"d"')
    expect(payload.truncationsApplied).toBe(true)
  })
})

describe('JsonFormat — maxStringLength', () => {
  it('truncates long strings with the +N marker and flags truncation', async () => {
    const r = await JsonFormatTool.run(
      { value: 'abcdefghij', maxStringLength: 4 },
      mkCtx(),
    )
    const payload = parsePayload(r)
    // First 4 chars + "…+6"
    expect(payload.result).toBe('"abcd…+6"')
    expect(payload.truncationsApplied).toBe(true)
  })
})

// ─── input validation ──────────────────────────────────────────

describe('JsonFormat — input validation', () => {
  it('rejects when neither value nor valueText supplied', async () => {
    const r = await JsonFormatTool.run({} as JsonFormatInput, mkCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(
      /exactly one of 'value' or 'valueText'/,
    )
  })

  it('rejects when both value AND valueText supplied (XOR)', async () => {
    const r = await JsonFormatTool.run(
      { value: { a: 1 }, valueText: '{"a":1}' },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/mutually exclusive/)
  })

  it('rejects when input is not an object', async () => {
    const r = await JsonFormatTool.run(
      null as unknown as JsonFormatInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/input must be an object/)
  })

  it('rejects non-numeric option values', async () => {
    const r = await JsonFormatTool.run(
      // `indent` should be a number, not a string. Cast so TS doesn't
      // catch us — the tool's runtime guard must.
      { value: { a: 1 }, indent: 'two' as unknown as number },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/option 'indent'/)
  })

  it('rejects negative cap values', async () => {
    const r = await JsonFormatTool.run(
      { value: { a: 1 }, maxStringLength: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/must be >= 0/)
  })

  it('treats explicit value: undefined as missing', async () => {
    // Edge case: caller passes `{ value: undefined }`. The XOR check
    // should treat that as "no value supplied" and require valueText.
    const r = await JsonFormatTool.run(
      { value: undefined } as JsonFormatInput,
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(
      /exactly one of 'value' or 'valueText'/,
    )
  })
})

// ─── runJsonFormat unit ────────────────────────────────────────

describe('runJsonFormat — pure helper', () => {
  it('round-trips the inputType tag', () => {
    const a = runJsonFormat({ x: 1 }, 'value', { value: { x: 1 } })
    expect(a.inputType).toBe('value')
    const b = runJsonFormat({ x: 1 }, 'valueText', { valueText: '{"x":1}' })
    expect(b.inputType).toBe('valueText')
  })

  it('returns truncationsApplied=false for non-truncating output', () => {
    const r = runJsonFormat({ x: 1 }, 'value', {})
    expect(r.truncationsApplied).toBe(false)
  })

  it('detects array-truncation markers', () => {
    const arr = Array.from({ length: 10 }, (_, i) => i)
    const r = runJsonFormat(arr, 'value', { maxArrayLength: 3 })
    expect(r.truncationsApplied).toBe(true)
    expect(r.result).toContain('+7 more')
  })
})
