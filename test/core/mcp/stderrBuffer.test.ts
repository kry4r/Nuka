import { describe, it, expect } from 'vitest'
import { RingBuffer, DEFAULT_STDERR_BUFFER_BYTES } from '../../../src/core/mcp/stderrBuffer'

describe('RingBuffer', () => {
  it('exports DEFAULT_STDERR_BUFFER_BYTES = 64 MiB', () => {
    expect(DEFAULT_STDERR_BUFFER_BYTES).toBe(64 * 1024 * 1024)
  })

  it('starts empty', () => {
    const buf = new RingBuffer(100)
    expect(buf.read()).toBe('')
    expect(buf.size()).toBe(0)
  })

  it('throws RangeError for maxBytes <= 0', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError)
    expect(() => new RingBuffer(-1)).toThrow(RangeError)
  })

  it('stores data up to maxBytes', () => {
    const buf = new RingBuffer(100)
    buf.write('a'.repeat(50))
    expect(buf.size()).toBe(50)
    expect(buf.read()).toBe('a'.repeat(50))
  })

  it('evicts oldest bytes when buffer is full (FIFO eviction)', () => {
    const buf = new RingBuffer(100)
    buf.write('a'.repeat(100))
    buf.write('b'.repeat(100))
    // After two 100-byte writes into a 100-byte buffer,
    // only the last 100 bytes (all 'b') should remain.
    expect(buf.size()).toBe(100)
    expect(buf.read()).toBe('b'.repeat(100))
  })

  it('keeps last 100 bytes when 200 bytes are written', () => {
    const buf = new RingBuffer(100)
    buf.write('x'.repeat(200))
    expect(buf.size()).toBe(100)
    expect(buf.read()).toBe('x'.repeat(100))
  })

  it('accepts Buffer chunks', () => {
    const buf = new RingBuffer(100)
    buf.write(Buffer.from('hello'))
    expect(buf.read()).toBe('hello')
  })

  it('accumulates multiple writes', () => {
    const buf = new RingBuffer(100)
    buf.write('foo')
    buf.write('bar')
    expect(buf.read()).toBe('foobar')
    expect(buf.size()).toBe(6)
  })

  it('splits at exact boundary correctly', () => {
    const buf = new RingBuffer(10)
    buf.write('1234567890') // exactly fills buffer
    expect(buf.read()).toBe('1234567890')
    buf.write('AB') // pushes 2 bytes
    expect(buf.read()).toBe('34567890AB')
    expect(buf.size()).toBe(10)
  })
})
