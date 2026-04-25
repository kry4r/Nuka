// test/core/testing/assertions.test.ts
import { describe, it, expect } from 'vitest'
import { matches, snapshotDiff } from '../../../src/core/testing/assertions'

const ctx = (last: string, frames?: string[]) => ({
  lastFrame: last,
  frames: frames ?? [last],
})

describe('matches()', () => {
  it('contains: passes / fails', () => {
    expect(matches({ contains: 'foo' }, ctx('foobar'))).toEqual({ ok: true })
    const r = matches({ contains: 'baz' }, ctx('foobar'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/expected last frame/)
  })

  it('notContains', () => {
    expect(matches({ notContains: 'x' }, ctx('abc'))).toEqual({ ok: true })
    expect(matches({ notContains: 'a' }, ctx('abc')).ok).toBe(false)
  })

  it('regex', () => {
    expect(matches({ regex: '^foo$' }, ctx('foo'))).toEqual({ ok: true })
    expect(matches({ regex: '^foo$' }, ctx('foobar')).ok).toBe(false)
  })

  it('equals (after ANSI strip)', () => {
    expect(matches({ equals: 'hi' }, ctx('\u001B[31mhi\u001B[0m'))).toEqual({ ok: true })
  })

  it('frameCount', () => {
    expect(matches({ frameCount: 3 }, ctx('x', ['a', 'b', 'x']))).toEqual({ ok: true })
    expect(matches({ frameCount: 5 }, ctx('x', ['a', 'b', 'x'])).ok).toBe(false)
  })

  it('lastFrameMatches.regex / .contains', () => {
    expect(matches({ lastFrameMatches: { regex: '^h' } }, ctx('hello'))).toEqual({ ok: true })
    expect(matches({ lastFrameMatches: { contains: 'ell' } }, ctx('hello'))).toEqual({ ok: true })
    expect(matches({ lastFrameMatches: { contains: 'XYZ' } }, ctx('hello')).ok).toBe(false)
  })

  it('strips ANSI before matching', () => {
    expect(matches({ contains: 'red' }, ctx('\u001B[31mred\u001B[0m'))).toEqual({ ok: true })
  })
})

describe('snapshotDiff()', () => {
  it('returns "snapshots are equal" when identical', () => {
    expect(snapshotDiff('a\nb', 'a\nb')).toBe('snapshots are equal')
  })

  it('points to first differing line', () => {
    const out = snapshotDiff('a\nb\nc', 'a\nB\nc')
    expect(out).toMatch(/first diff at line 2/)
    expect(out).toContain('- b')
    expect(out).toContain('+ B')
  })

  it('handles missing/extra trailing lines', () => {
    const out = snapshotDiff('a\nb', 'a\nb\nc')
    expect(out).toMatch(/first diff at line 3/)
    expect(out).toContain('+ c')
  })
})
