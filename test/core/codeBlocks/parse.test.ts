import { describe, it, expect } from 'vitest'
import {
  extractCodeBlocks,
  splitByCodeFences,
  replaceCodeBlocks,
  findFirstCodeBlock,
  unwrapSingleCodeBlock,
} from '../../../src/core/codeBlocks'

describe('extractCodeBlocks', () => {
  it('returns [] for empty input', () => {
    expect(extractCodeBlocks('')).toEqual([])
  })

  it('returns [] for plain prose without fences', () => {
    expect(extractCodeBlocks('hello world\nno code here')).toEqual([])
  })

  it('parses a single backtick block with language', () => {
    const text = 'before\n```ts\nconst x = 1\n```\nafter'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    const b = blocks[0]!
    expect(b.lang).toBe('ts')
    expect(b.content).toBe('const x = 1\n')
    expect(b.startLine).toBe(2)
    expect(b.endLine).toBe(4)
    expect(b.closed).toBe(true)
    expect(b.fenceChar).toBe('`')
    expect(b.fenceLength).toBe(3)
  })

  it('parses a fence with no language tag', () => {
    const text = '```\nplain\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe(null)
    expect(blocks[0]!.content).toBe('plain\n')
  })

  it('trims the language to the first whitespace-separated token', () => {
    const text = '```js hl_lines="1-3" linenos\nfoo\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks[0]!.lang).toBe('js')
  })

  it('parses multiple blocks with mixed languages', () => {
    const text =
      'intro\n```py\na = 1\n```\nmiddle\n```ts\nlet b: number\n```\nend'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.lang).toBe('py')
    expect(blocks[0]!.content).toBe('a = 1\n')
    expect(blocks[1]!.lang).toBe('ts')
    expect(blocks[1]!.content).toBe('let b: number\n')
  })

  it('parses tilde fences', () => {
    const text = '~~~rust\nfn main() {}\n~~~'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.fenceChar).toBe('~')
    expect(blocks[0]!.lang).toBe('rust')
    expect(blocks[0]!.content).toBe('fn main() {}\n')
  })

  it('does not close a backtick block on a tilde fence', () => {
    const text = '```\ncode\n~~~\nstill code\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.content).toBe('code\n~~~\nstill code\n')
  })

  it('supports nested fences via longer outer fence', () => {
    const text =
      '````md\n# Heading\n```ts\nconst x = 1\n```\n````\nafter'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('md')
    expect(blocks[0]!.fenceLength).toBe(4)
    expect(blocks[0]!.content).toBe('# Heading\n```ts\nconst x = 1\n```\n')
  })

  it('rejects close fence shorter than open fence', () => {
    const text = '````ts\nhello\n```\nworld\n````'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.content).toBe('hello\n```\nworld\n')
    expect(blocks[0]!.fenceLength).toBe(4)
  })

  it('accepts close fence longer than open fence', () => {
    const text = '```ts\nhello\n``````'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.content).toBe('hello\n')
    expect(blocks[0]!.closed).toBe(true)
  })

  it('rejects backtick info-string containing a backtick', () => {
    // CommonMark §4.5: a backtick info-string may not contain `.
    // The first line's would-be opener is rejected; the line-3 ``` becomes
    // a NEW opener with no info, and falls through to EOF (unclosed).
    const text = '```ts `x`\ncode\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.startLine).toBe(3)
    expect(blocks[0]!.closed).toBe(false)
    expect(blocks[0]!.lang).toBe(null)
  })

  it('allows tilde info-string with backticks', () => {
    const text = '~~~ts `x`\ncode\n~~~'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('ts')
  })

  it('allows ≤3-space indent on opening fence', () => {
    const text = '   ```js\nfoo\n   ```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('js')
  })

  it('does not treat 4-space indent as a fence', () => {
    const text = '    ```js\nfoo\n    ```'
    expect(extractCodeBlocks(text)).toEqual([])
  })

  it('reports unclosed blocks with closed=false to EOF', () => {
    const text = '```ts\nconst x = 1\nconst y = 2'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.closed).toBe(false)
    expect(blocks[0]!.content).toBe('const x = 1\nconst y = 2')
    expect(blocks[0]!.endLine).toBe(3)
  })

  it('handles CRLF line endings', () => {
    const text = '```ts\r\nconst x = 1\r\n```\r\n'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.content).toBe('const x = 1\r\n')
    expect(blocks[0]!.lang).toBe('ts')
    expect(blocks[0]!.closed).toBe(true)
  })

  it('preserves exact offsets that reproduce the input', () => {
    const text = 'pre\n```js\nfoo\nbar\n```\npost'
    const blocks = extractCodeBlocks(text)
    const b = blocks[0]!
    expect(text.slice(b.startOffset, b.endOffset)).toBe('```js\nfoo\nbar\n```\n')
  })

  it('does not support 4-space indented (non-fenced) code blocks', () => {
    // Documented gap — indented code blocks are skipped on purpose.
    const text = '    var x = 1\n    var y = 2'
    expect(extractCodeBlocks(text)).toEqual([])
  })
})

describe('splitByCodeFences', () => {
  it('returns [] for empty input', () => {
    expect(splitByCodeFences('')).toEqual([])
  })

  it('returns single prose segment for prose-only input', () => {
    const segs = splitByCodeFences('hello')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ type: 'prose', text: 'hello' })
  })

  it('interleaves prose and code in order', () => {
    const text = 'a\n```\nb\n```\nc'
    const segs = splitByCodeFences(text)
    expect(segs).toHaveLength(3)
    expect(segs[0]!.type).toBe('prose')
    expect(segs[1]!.type).toBe('code')
    expect(segs[2]!.type).toBe('prose')
    if (segs[0]!.type === 'prose') expect(segs[0]!.text).toBe('a\n')
    // The trailing block fence consumes its own newline; what remains is 'c'.
    if (segs[2]!.type === 'prose') expect(segs[2]!.text).toBe('c')
  })

  it('omits empty prose between adjacent blocks', () => {
    const text = '```\nx\n```\n```\ny\n```'
    const segs = splitByCodeFences(text)
    const codeCount = segs.filter(s => s.type === 'code').length
    expect(codeCount).toBe(2)
  })
})

describe('replaceCodeBlocks', () => {
  it('returns text unchanged when no fences', () => {
    expect(replaceCodeBlocks('plain', () => 'XX')).toBe('plain')
  })

  it('replaces each block with the transformer output', () => {
    const text = 'pre\n```ts\nfoo\n```\npost'
    const out = replaceCodeBlocks(text, b => `[${b.lang}:${b.content.trim()}]`)
    expect(out).toBe('pre\n[ts:foo]post')
  })

  it('preserves prose between multiple blocks', () => {
    const text = '```\na\n```\nmid\n```\nb\n```'
    const out = replaceCodeBlocks(text, () => 'X')
    expect(out).toBe('Xmid\nX')
  })
})

describe('findFirstCodeBlock', () => {
  it('returns null when no blocks', () => {
    expect(findFirstCodeBlock('')).toBe(null)
    expect(findFirstCodeBlock('plain')).toBe(null)
  })

  it('returns first block when no filter', () => {
    const text = '```py\na\n```\n```ts\nb\n```'
    expect(findFirstCodeBlock(text)?.lang).toBe('py')
  })

  it('filters by lang (case-insensitive)', () => {
    const text = '```py\na\n```\n```TS\nb\n```'
    expect(findFirstCodeBlock(text, 'ts')?.lang).toBe('TS')
  })

  it('filters by null lang to find untagged blocks', () => {
    const text = '```ts\na\n```\n```\nplain\n```'
    expect(findFirstCodeBlock(text, null)?.lang).toBe(null)
  })

  it('returns null when no block matches lang', () => {
    expect(findFirstCodeBlock('```ts\na\n```', 'py')).toBe(null)
  })
})

describe('unwrapSingleCodeBlock', () => {
  it('returns null for empty input', () => {
    expect(unwrapSingleCodeBlock('')).toBe(null)
  })

  it('returns null for prose only', () => {
    expect(unwrapSingleCodeBlock('hello')).toBe(null)
  })

  it('returns content for a sole block', () => {
    expect(unwrapSingleCodeBlock('```ts\nfoo\n```')).toBe('foo\n')
  })

  it('tolerates whitespace prose around', () => {
    expect(unwrapSingleCodeBlock('\n\n```\nbar\n```\n   ')).toBe('bar\n')
  })

  it('returns null when prose has content', () => {
    expect(unwrapSingleCodeBlock('hi\n```\nbar\n```')).toBe(null)
  })

  it('returns null with multiple blocks', () => {
    expect(unwrapSingleCodeBlock('```\na\n```\n```\nb\n```')).toBe(null)
  })

  it('still unwraps unclosed sole block', () => {
    expect(unwrapSingleCodeBlock('```ts\nfoo')).toBe('foo')
  })
})
