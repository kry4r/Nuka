// test/core/tools/content.test.ts
import { describe, it, expect } from 'vitest'
import { serializeContentBlocks } from '../../../src/core/tools/content'
import type { ContentBlock } from '../../../src/core/tools/content'

describe('serializeContentBlocks', () => {
  it('serializes text blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello world' }]
    expect(serializeContentBlocks(blocks)).toBe('hello world')
  })

  it('serializes image blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'image', path: '/tmp/img.png', mimeType: 'image/png' }]
    const out = serializeContentBlocks(blocks)
    expect(out).toContain('image/png')
    expect(out).toContain('/tmp/img.png')
  })

  it('serializes resource blocks with uri and text', () => {
    const blocks: ContentBlock[] = [{ type: 'resource', uri: 'file:///foo.txt', text: 'content here' }]
    const out = serializeContentBlocks(blocks)
    expect(out).toContain('file:///foo.txt')
    expect(out).toContain('content here')
  })

  it('serializes resource blocks without text', () => {
    const blocks: ContentBlock[] = [{ type: 'resource', uri: 'file:///foo.txt' }]
    expect(serializeContentBlocks(blocks)).toContain('file:///foo.txt')
  })

  it('joins multiple blocks with newline', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const out = serializeContentBlocks(blocks)
    expect(out).toBe('first\nsecond')
  })

  it('returns empty string for empty array', () => {
    expect(serializeContentBlocks([])).toBe('')
  })
})
