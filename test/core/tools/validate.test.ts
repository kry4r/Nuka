// test/core/tools/validate.test.ts
import { describe, it, expect } from 'vitest'
import { validateWithJsonSchema } from '../../../src/core/tools/validate'

describe('validateWithJsonSchema', () => {
  describe('type: string', () => {
    const schema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } }

    it('accepts valid input', () => {
      const r = validateWithJsonSchema({ x: 'hello' }, schema)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value).toMatchObject({ x: 'hello' })
    })

    it('rejects missing required field', () => {
      const r = validateWithJsonSchema({}, schema)
      expect(r.ok).toBe(false)
    })

    it('rejects wrong type', () => {
      const r = validateWithJsonSchema({ x: 42 }, schema)
      expect(r.ok).toBe(false)
    })
  })

  describe('minLength / maxLength', () => {
    const schema = { type: 'object', properties: { s: { type: 'string', minLength: 2, maxLength: 5 } } }

    it('rejects too-short string', () => {
      expect(validateWithJsonSchema({ s: 'a' }, schema).ok).toBe(false)
    })

    it('rejects too-long string', () => {
      expect(validateWithJsonSchema({ s: 'toolong' }, schema).ok).toBe(false)
    })

    it('accepts in-range string', () => {
      expect(validateWithJsonSchema({ s: 'ok' }, schema).ok).toBe(true)
    })
  })

  describe('type: number with minimum/maximum', () => {
    const schema = { type: 'object', properties: { n: { type: 'number', minimum: 1, maximum: 10 } } }

    it('rejects below minimum', () => {
      expect(validateWithJsonSchema({ n: 0 }, schema).ok).toBe(false)
    })

    it('rejects above maximum', () => {
      expect(validateWithJsonSchema({ n: 11 }, schema).ok).toBe(false)
    })

    it('accepts valid number', () => {
      expect(validateWithJsonSchema({ n: 5 }, schema).ok).toBe(true)
    })
  })

  describe('type: integer', () => {
    it('accepts integer for integer type', () => {
      const schema = { type: 'object', properties: { i: { type: 'integer' } } }
      expect(validateWithJsonSchema({ i: 3 }, schema).ok).toBe(true)
    })
  })

  describe('type: boolean', () => {
    it('accepts boolean', () => {
      const schema = { type: 'object', properties: { b: { type: 'boolean' } } }
      expect(validateWithJsonSchema({ b: true }, schema).ok).toBe(true)
    })

    it('rejects non-boolean', () => {
      const schema = { type: 'object', properties: { b: { type: 'boolean' } } }
      expect(validateWithJsonSchema({ b: 'yes' }, schema).ok).toBe(false)
    })
  })

  describe('type: array', () => {
    it('accepts array of strings', () => {
      const schema = { type: 'object', properties: { arr: { type: 'array', items: { type: 'string' } } } }
      expect(validateWithJsonSchema({ arr: ['a', 'b'] }, schema).ok).toBe(true)
    })

    it('rejects non-array', () => {
      const schema = { type: 'object', properties: { arr: { type: 'array', items: { type: 'string' } } } }
      expect(validateWithJsonSchema({ arr: 'hello' }, schema).ok).toBe(false)
    })
  })

  describe('enum', () => {
    it('accepts value in string enum', () => {
      const schema = { type: 'object', properties: { color: { enum: ['red', 'green', 'blue'] } } }
      expect(validateWithJsonSchema({ color: 'red' }, schema).ok).toBe(true)
    })

    it('rejects value not in enum', () => {
      const schema = { type: 'object', properties: { color: { enum: ['red', 'green', 'blue'] } } }
      expect(validateWithJsonSchema({ color: 'purple' }, schema).ok).toBe(false)
    })
  })

  describe('unknown keywords', () => {
    it('ignores unknown keywords and does not error', () => {
      const schema = {
        type: 'object',
        properties: { x: { type: 'string', 'x-custom-field': 'foo' } },
        'x-unknown': true,
      }
      expect(validateWithJsonSchema({ x: 'hi' }, schema).ok).toBe(true)
    })
  })

  describe('passthrough of extra fields', () => {
    it('allows extra properties not in schema', () => {
      const schema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } }
      const r = validateWithJsonSchema({ x: 'hi', extra: 123 }, schema)
      expect(r.ok).toBe(true)
    })
  })

  describe('optional fields', () => {
    it('allows missing optional field', () => {
      const schema = { type: 'object', properties: { opt: { type: 'string' } } }
      expect(validateWithJsonSchema({}, schema).ok).toBe(true)
    })
  })

  describe('error message', () => {
    it('returns human-readable error', () => {
      const schema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } }
      const r = validateWithJsonSchema({}, schema)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(typeof r.error).toBe('string')
    })
  })
})
