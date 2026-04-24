import { describe, it, expect } from 'vitest'
import { normalizeMcpName, buildMcpToolName, parseMcpToolName } from '../../../src/core/mcp/names'

describe('normalizeMcpName', () => {
  it('replaces spaces with underscores', () => {
    expect(normalizeMcpName('my server')).toBe('my_server')
  })

  it('collapses repeated separators', () => {
    expect(normalizeMcpName('a--b')).toBe('a_b')
  })

  it('trims leading and trailing underscores', () => {
    expect(normalizeMcpName('__x__')).toBe('x')
  })

  it('throws when result is empty', () => {
    expect(() => normalizeMcpName('!!!')).toThrow()
  })
})

describe('buildMcpToolName', () => {
  it('produces mcp__server__tool format', () => {
    expect(buildMcpToolName('my server', 'read file')).toBe('mcp__my_server__read_file')
  })
})

describe('parseMcpToolName', () => {
  it('parses simple three-segment name', () => {
    expect(parseMcpToolName('mcp__a__b')).toEqual({ server: 'a', tool: 'b' })
  })

  it('treats extra segments as part of tool name', () => {
    expect(parseMcpToolName('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b__c' })
  })

  it('returns null for non-mcp name', () => {
    expect(parseMcpToolName('nope')).toBeNull()
  })

  it('returns null when only two segments', () => {
    expect(parseMcpToolName('mcp__only')).toBeNull()
  })
})
