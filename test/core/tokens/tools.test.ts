// test/core/tokens/tools.test.ts
import { describe, expect, it } from 'vitest'
import { EstimateTokensTool } from '../../../src/core/tokens/tools'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('EstimateTokens tool', () => {
  it('estimates plain text using the default 4 bytes/token ratio', async () => {
    const r = await EstimateTokensTool.run({ text: 'abcdefgh' }, ctx) // 2 tokens
    expect(r.isError).toBe(false)
    expect(r.output).toContain('~2 tokens')
    expect(r.output).toContain('8 chars')
    expect(r.output).toContain('4 bytes/token')
  })

  it('uses the JSON ratio when fileExtension is provided', async () => {
    const r = await EstimateTokensTool.run(
      { text: 'abcdefgh', fileExtension: 'json' },
      ctx,
    )
    expect(r.isError).toBe(false)
    // 8 chars / 2 = 4 tokens
    expect(r.output).toContain('~4 tokens')
    expect(r.output).toContain('2 bytes/token')
    expect(r.output).toContain('ext=json')
  })

  it('strips a leading dot and lowercases the extension hint', async () => {
    const r = await EstimateTokensTool.run(
      { text: 'abcdefgh', fileExtension: '.JSONL' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toContain('ext=jsonl')
    expect(r.output).toContain('2 bytes/token')
  })

  it('handles empty text', async () => {
    const r = await EstimateTokensTool.run({ text: '' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('~0 tokens')
  })

  it('is read-only and parallel-safe', () => {
    expect(EstimateTokensTool.annotations?.readOnly).toBe(true)
    expect(EstimateTokensTool.annotations?.parallelSafe).toBe(true)
    expect(EstimateTokensTool.needsPermission(undefined as never)).toBe('none')
  })

  it('declares a non-empty schema with required text', () => {
    const params = EstimateTokensTool.parameters as {
      required?: string[]
      properties?: Record<string, unknown>
    }
    expect(params.required).toContain('text')
    expect(params.properties).toHaveProperty('text')
    expect(params.properties).toHaveProperty('fileExtension')
  })
})
