import { describe, it, expect } from 'vitest'
import { parseAddress, resolveTarget } from '../../../src/core/messaging/addresses'

describe('parseAddress', () => {
  it('parses qualified team address', () => {
    expect(parseAddress('team:demo/alice')).toEqual({ kind: 'team', team: 'demo', agent: 'alice' })
  })
  it('parses bare name', () => {
    expect(parseAddress('alice')).toEqual({ kind: 'bare', name: 'alice' })
  })
  it('parses broadcast', () => {
    expect(parseAddress('*')).toEqual({ kind: 'broadcast' })
  })
  it('parses uds', () => {
    expect(parseAddress('uds:/tmp/x.sock')).toEqual({ kind: 'uds', sock: '/tmp/x.sock' })
  })
  it('parses bridge', () => {
    expect(parseAddress('bridge:s_01ABC')).toEqual({ kind: 'bridge', id: 's_01ABC' })
  })
})

describe('resolveTarget', () => {
  it('bare name + caller team → qualified', () => {
    expect(resolveTarget('alice', { teamName: 'demo' })).toBe('team:demo/alice')
  })
  it('qualified passes through', () => {
    expect(resolveTarget('team:demo/alice', {})).toBe('team:demo/alice')
  })
  it('bare name without caller team throws', () => {
    expect(() => resolveTarget('alice', {})).toThrow(/teamName context required/)
  })
})
