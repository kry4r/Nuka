import { describe, it, expect } from 'vitest'
import {
  truncateMcpResult,
  truncateDescription,
  MAX_MCP_DESCRIPTION_CHARS,
} from '../../../src/core/mcp/truncate'

describe('truncateMcpResult', () => {
  it('passes through small results unchanged', () => {
    const r = truncateMcpResult(['hello', 'world'], 100)
    expect(r.text).toBe('hello\nworld')
    expect(r.truncated).toBe(false)
    expect(r.originalLength).toBe('hello\nworld'.length)
  })

  it('truncates large results and appends the notice', () => {
    const big = 'a'.repeat(250_000)
    const r = truncateMcpResult([big], 100_000)
    expect(r.truncated).toBe(true)
    expect(r.originalLength).toBe(250_000)
    expect(r.text).toMatch(/\.\.\.\[truncated 150000 chars of 250000\]\.\.\.$/)
    expect(r.text.startsWith('a'.repeat(100_000))).toBe(true)
  })

  it('counts the joined (newline-separated) length', () => {
    const parts = ['a'.repeat(60), 'b'.repeat(60)]
    const r = truncateMcpResult(parts, 50)
    expect(r.truncated).toBe(true)
    // joined length is 60 + 1 (newline) + 60 = 121
    expect(r.originalLength).toBe(121)
  })
})

describe('truncateDescription', () => {
  it('leaves short descriptions alone', () => {
    expect(truncateDescription('short desc')).toBe('short desc')
  })

  it('truncates 5000 chars down to the limit with an ellipsis', () => {
    const s = 'x'.repeat(5000)
    const r = truncateDescription(s)
    expect(r.length).toBe(MAX_MCP_DESCRIPTION_CHARS)
    expect(r.endsWith('…')).toBe(true)
  })

  it('respects a custom limit', () => {
    const r = truncateDescription('abcdef', 4)
    expect(r).toBe('abc…')
  })
})
