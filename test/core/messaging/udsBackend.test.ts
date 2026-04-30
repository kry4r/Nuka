import { describe, it, expect } from 'vitest'
import { UdsBackend } from '../../../src/core/messaging/udsBackend'

describe('UdsBackend stub', () => {
  it('send returns false (not implemented)', async () => {
    const b = new UdsBackend()
    expect(await b.send({ id: '1', from: 'a', to: 'uds:/x', summary: 's', message: 'm', sentAt: 0 })).toBe(false)
  })
  it('subscribe returns no-op', () => {
    const b = new UdsBackend()
    const off = b.subscribe('uds:/x', () => {})
    off()
    expect(typeof off).toBe('function')
  })
  it('pending returns 0', () => {
    const b = new UdsBackend()
    expect(b.pending('uds:/x')).toBe(0)
  })
  it('drain returns empty array', () => {
    const b = new UdsBackend()
    expect(b.drain('uds:/x')).toEqual([])
  })
})
