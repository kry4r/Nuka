// test/core/jsonFormat/jsonFormat.test.ts
import { describe, it, expect } from 'vitest'
import {
  formatJSON,
  formatJSONCompact,
  type FormatJSONOptions,
} from '../../../src/core/jsonFormat'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('formatJSON — primitives', () => {
  it('null', () => {
    expect(formatJSON(null)).toBe('null')
  })
  it('undefined → null', () => {
    expect(formatJSON(undefined)).toBe('null')
  })
  it('boolean true', () => {
    expect(formatJSON(true)).toBe('true')
  })
  it('boolean false', () => {
    expect(formatJSON(false)).toBe('false')
  })
  it('integer', () => {
    expect(formatJSON(42)).toBe('42')
  })
  it('float', () => {
    expect(formatJSON(3.14)).toBe('3.14')
  })
  it('negative number', () => {
    expect(formatJSON(-5)).toBe('-5')
  })
  it('zero', () => {
    expect(formatJSON(0)).toBe('0')
  })
  it('string with no escapes', () => {
    expect(formatJSON('hello')).toBe('"hello"')
  })
  it('string with special chars', () => {
    expect(formatJSON('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"')
  })
  it('empty string', () => {
    expect(formatJSON('')).toBe('""')
  })
})

// ---------------------------------------------------------------------------
// Non-finite numbers / BigInt
// ---------------------------------------------------------------------------

describe('formatJSON — non-finite numbers', () => {
  it('NaN → null by default', () => {
    expect(formatJSON(NaN)).toBe('null')
  })
  it('Infinity → null by default', () => {
    expect(formatJSON(Infinity)).toBe('null')
  })
  it('-Infinity → null by default', () => {
    expect(formatJSON(-Infinity)).toBe('null')
  })
  it('NaN → "NaN" with nonFiniteAsString', () => {
    expect(formatJSON(NaN, { nonFiniteAsString: true })).toBe('"NaN"')
  })
  it('Infinity → "Infinity" with nonFiniteAsString', () => {
    expect(formatJSON(Infinity, { nonFiniteAsString: true })).toBe('"Infinity"')
  })
  it('-Infinity → "-Infinity" with nonFiniteAsString', () => {
    expect(formatJSON(-Infinity, { nonFiniteAsString: true })).toBe('"-Infinity"')
  })
})

describe('formatJSON — bigint', () => {
  it('bigint → quoted decimal by default', () => {
    expect(formatJSON(123n)).toBe('"123"')
  })
  it('bigint → throw when bigintHandler="throw"', () => {
    expect(() => formatJSON(123n, { bigintHandler: 'throw' })).toThrowError(
      /BigInt/,
    )
  })
  it('bigint → custom function', () => {
    expect(
      formatJSON(123n, { bigintHandler: v => String(v) }),
    ).toBe('123')
  })
})

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

describe('formatJSON — arrays', () => {
  it('empty array', () => {
    expect(formatJSON([])).toBe('[]')
  })
  it('single-element array inline', () => {
    expect(formatJSON([1])).toBe('[1]')
  })
  it('short array stays inline', () => {
    expect(formatJSON([1, 2, 3])).toBe('[1, 2, 3]')
  })
  it('mixed-type short array stays inline', () => {
    expect(formatJSON([1, 'hello', true, null])).toBe(
      '[1, "hello", true, null]',
    )
  })
  it('long array expands to multi-line', () => {
    const arr = Array.from({ length: 12 }, (_, i) => i)
    const out = formatJSON(arr, { maxLineLength: 20 })
    const lines = out.split('\n')
    expect(lines[0]).toBe('[')
    expect(lines[lines.length - 1]).toBe(']')
    // Each element on its own line + brackets
    expect(lines.length).toBe(arr.length + 2)
    expect(lines[1]).toBe('  0,')
    expect(lines[lines.length - 2]).toBe('  11')
  })
  it('nested array — outer expands when inner forces it', () => {
    const out = formatJSON(
      [1, [2, 3, 4, 5, 6, 7, 8, 9, 10]],
      { maxLineLength: 10 },
    )
    expect(out).toContain('\n')
    expect(out).toContain('[\n')
  })
})

describe('formatJSON — maxArrayLength', () => {
  it('truncates long arrays inline', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const out = formatJSON(arr, { maxArrayLength: 3 })
    expect(out).toBe('[1, 2, 3, "…, +7 more"]')
  })
  it('truncates long arrays multi-line', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i * 100)
    const out = formatJSON(arr, { maxArrayLength: 2, maxLineLength: 1 })
    expect(out.split('\n')[1]).toBe('  0,')
    expect(out.split('\n')[2]).toBe('  100,')
    expect(out.split('\n')[3]).toBe('  "…, +48 more"')
  })
})

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

describe('formatJSON — objects', () => {
  it('empty object', () => {
    expect(formatJSON({})).toBe('{}')
  })
  it('single-key short object inline', () => {
    expect(formatJSON({ a: 1 })).toBe('{ "a": 1 }')
  })
  it('two-key short object inline', () => {
    expect(formatJSON({ a: 1, b: 2 })).toBe('{ "a": 1, "b": 2 }')
  })
  it('long object expands', () => {
    const out = formatJSON(
      { name: 'this-is-a-really-long-name', value: 42 },
      { maxLineLength: 20 },
    )
    expect(out.split('\n').length).toBe(4)
    expect(out).toContain('  "name":')
    expect(out).toContain('  "value":')
  })
  it('nested object inline when short', () => {
    expect(formatJSON({ outer: { a: 1 } })).toBe('{ "outer": { "a": 1 } }')
  })
  it('nested object expands when long', () => {
    const out = formatJSON(
      { outer: { longishKey: 'longishValue' } },
      { maxLineLength: 12 },
    )
    expect(out).toContain('\n')
    expect(out).toContain('{\n')
  })
})

describe('formatJSON — sortKeys', () => {
  it('preserves insertion order by default', () => {
    expect(formatJSON({ b: 1, a: 2, c: 3 })).toBe(
      '{ "b": 1, "a": 2, "c": 3 }',
    )
  })
  it('alphabetical when sortKeys=true', () => {
    expect(formatJSON({ b: 1, a: 2, c: 3 }, { sortKeys: true })).toBe(
      '{ "a": 2, "b": 1, "c": 3 }',
    )
  })
  it('custom comparator', () => {
    const out = formatJSON(
      { a: 1, b: 2, c: 3 },
      { sortKeys: (x, y) => y.localeCompare(x) }, // reverse
    )
    expect(out).toBe('{ "c": 3, "b": 2, "a": 1 }')
  })
})

// ---------------------------------------------------------------------------
// maxDepth
// ---------------------------------------------------------------------------

describe('formatJSON — maxDepth', () => {
  it('truncates nested objects past depth', () => {
    const v = { a: { b: { c: { d: 1 } } } }
    const out = formatJSON(v, { maxDepth: 2 })
    // depth 0 = root, depth 1 = inner; depth 2 hits the truncation
    expect(out).toContain('"…"')
    expect(out).not.toContain('"d"')
  })
  it('truncates nested arrays past depth', () => {
    const v = [[[[1]]]]
    const out = formatJSON(v, { maxDepth: 2 })
    expect(out).toContain('"…"')
  })
  it('preserves all when depth is unlimited', () => {
    const out = formatJSON({ a: { b: { c: 1 } } })
    expect(out).toContain('"c": 1')
  })
})

// ---------------------------------------------------------------------------
// maxStringLength
// ---------------------------------------------------------------------------

describe('formatJSON — maxStringLength', () => {
  it('truncates long strings inline', () => {
    const out = formatJSON('abcdefghij', { maxStringLength: 4 })
    expect(out).toBe('"abcd…+6"')
  })
  it('leaves short strings alone', () => {
    expect(formatJSON('abc', { maxStringLength: 100 })).toBe('"abc"')
  })
  it('truncates strings inside arrays', () => {
    const out = formatJSON(['short', 'verylongstring'], { maxStringLength: 5 })
    expect(out).toContain('"short"')
    // "verylongstring" → first 5 chars "veryl" + "…+9"
    expect(out).toContain('"veryl…+9"')
  })
})

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

describe('formatJSON — cycles', () => {
  it('self-cycle → "[Circular]" placeholder', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    const out = formatJSON(a)
    expect(out).toBe('{ "self": "[Circular]" }')
  })
  it('array self-cycle → "[Circular]" placeholder', () => {
    const a: unknown[] = []
    a.push(a)
    const out = formatJSON(a)
    expect(out).toBe('["[Circular]"]')
  })
  it('cross-cycle through nested objects', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b' }
    a.peer = b
    b.peer = a
    const out = formatJSON(a)
    expect(out).toContain('"[Circular]"')
  })
  it('cycle → throw when cycleHandler="throw"', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => formatJSON(a, { cycleHandler: 'throw' })).toThrowError(
      /circular/i,
    )
  })
  it('cycle → custom function', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    const out = formatJSON(a, {
      cycleHandler: path => JSON.stringify(`<cycle:${path.join('.')}>`),
    })
    expect(out).toBe('{ "self": "<cycle:self>" }')
  })
  it('shared subtree is NOT a cycle', () => {
    const shared = { val: 1 }
    const obj = { a: shared, b: shared }
    const out = formatJSON(obj)
    expect(out).toBe('{ "a": { "val": 1 }, "b": { "val": 1 } }')
  })
})

// ---------------------------------------------------------------------------
// Indent
// ---------------------------------------------------------------------------

describe('formatJSON — indent', () => {
  it('default indent of 2', () => {
    const out = formatJSON({ a: 1, b: 2 }, { maxLineLength: 5 })
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}')
  })
  it('indent of 4', () => {
    const out = formatJSON({ a: 1 }, { indent: 4, maxLineLength: 5 })
    expect(out).toBe('{\n    "a": 1\n}')
  })
  it('indent of 0 forces compact', () => {
    const out = formatJSON({ a: 1, b: [1, 2, 3] }, { indent: 0 })
    expect(out).toBe('{ "a": 1, "b": [1, 2, 3] }')
  })
  it('negative indent clamped to 0', () => {
    const out = formatJSON({ a: 1 }, { indent: -3 })
    expect(out).toBe('{ "a": 1 }')
  })
})

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

describe('formatJSON — markers', () => {
  const m: FormatJSONOptions = {
    markers: {
      numberOpen: '<n>',
      numberClose: '</n>',
      stringOpen: '<s>',
      stringClose: '</s>',
      booleanOpen: '<b>',
      booleanClose: '</b>',
      nullOpen: '<z>',
      nullClose: '</z>',
      keyOpen: '<k>',
      keyClose: '</k>',
    },
  }
  it('wraps number', () => {
    expect(formatJSON(42, m)).toBe('<n>42</n>')
  })
  it('wraps boolean', () => {
    expect(formatJSON(true, m)).toBe('<b>true</b>')
  })
  it('wraps string', () => {
    expect(formatJSON('hi', m)).toBe('<s>"hi"</s>')
  })
  it('wraps null', () => {
    expect(formatJSON(null, m)).toBe('<z>null</z>')
  })
  it('NaN with markers uses null marker (no nonFiniteAsString)', () => {
    expect(formatJSON(NaN, m)).toBe('<z>null</z>')
  })
  it('wraps keys and values inside object', () => {
    expect(formatJSON({ a: 1 }, m)).toBe('{ <k>"a"</k>: <n>1</n> }')
  })
  it('marker bytes do not push value past inline budget', () => {
    // {a: 1} measures 10 sans markers, fits in 12.
    const out = formatJSON({ a: 1 }, { ...m, maxLineLength: 12 })
    expect(out).toBe('{ <k>"a"</k>: <n>1</n> }')
  })
  it('no markers = no extra bytes', () => {
    expect(formatJSON(42)).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// formatJSONCompact
// ---------------------------------------------------------------------------

describe('formatJSONCompact', () => {
  it('inlines a long object', () => {
    const longish = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }
    const out = formatJSONCompact(longish)
    expect(out).not.toContain('\n')
    expect(out).toContain('"a"')
    expect(out).toContain('"h"')
  })
  it('inlines a long array', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i)
    const out = formatJSONCompact(arr)
    expect(out).not.toContain('\n')
    expect(out.startsWith('[0, 1, 2')).toBe(true)
  })
  it('still respects maxDepth', () => {
    const out = formatJSONCompact(
      { a: { b: { c: { d: 1 } } } },
      { maxDepth: 1 },
    )
    expect(out).toContain('"…"')
  })
  it('still respects maxStringLength', () => {
    const out = formatJSONCompact('abcdef', { maxStringLength: 3 })
    expect(out).toBe('"abc…+3"')
  })
})

// ---------------------------------------------------------------------------
// toJSON
// ---------------------------------------------------------------------------

describe('formatJSON — toJSON hook', () => {
  it('honors object toJSON', () => {
    const obj = {
      toJSON() {
        return { replaced: true }
      },
    }
    expect(formatJSON(obj)).toBe('{ "replaced": true }')
  })
  it('honors Date.toJSON', () => {
    const d = new Date('2025-01-01T00:00:00Z')
    expect(formatJSON(d)).toBe('"2025-01-01T00:00:00.000Z"')
  })
})

// ---------------------------------------------------------------------------
// Function/symbol values
// ---------------------------------------------------------------------------

describe('formatJSON — non-serializable values', () => {
  it('function as root → null', () => {
    expect(formatJSON(() => 42)).toBe('null')
  })
  it('function inside object → key dropped', () => {
    const out = formatJSON({ a: 1, fn: () => 2, b: 3 })
    expect(out).toBe('{ "a": 1, "b": 3 }')
  })
  it('function inside array → null', () => {
    const out = formatJSON([1, () => 2, 3])
    expect(out).toBe('[1, null, 3]')
  })
  it('symbol value inside object → key dropped', () => {
    const out = formatJSON({ a: 1, s: Symbol('x'), b: 3 })
    expect(out).toBe('{ "a": 1, "b": 3 }')
  })
})

// ---------------------------------------------------------------------------
// Realistic shape
// ---------------------------------------------------------------------------

describe('formatJSON — realistic shapes', () => {
  it('shallow record inline', () => {
    const payload = { ok: true, count: 3, items: ['a', 'b', 'c'] }
    expect(formatJSON(payload)).toBe(
      '{ "ok": true, "count": 3, "items": ["a", "b", "c"] }',
    )
  })
  it('nested with tight budget multi-lines', () => {
    const payload = {
      user: { id: 1234567, name: 'aliceTheLongNamed' },
      tags: ['admin', 'beta', 'extended-user-tag'],
    }
    const out = formatJSON(payload, { maxLineLength: 30 })
    // Outer should expand
    expect(out.split('\n').length).toBeGreaterThan(1)
    expect(out).toContain('"user"')
    expect(out).toContain('"tags"')
    // Inner objects/arrays may still inline if they fit at their indent
  })
  it('multi-line stays as JSON (each line parses when concatenated)', () => {
    const v = { a: [1, 2, 3, 4, 5], b: 'hi', c: { x: 1, y: 2 } }
    const out = formatJSON(v, { maxLineLength: 12 })
    // Round-trip parseability — strip whitespace and re-parse
    expect(JSON.parse(out)).toEqual(v)
  })
})
