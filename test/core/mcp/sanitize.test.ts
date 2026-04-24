import { describe, it, expect } from 'vitest'
import { sanitizeToolText } from '../../../src/core/mcp/sanitize'

describe('sanitizeToolText', () => {
  it('passes through plain ASCII text unchanged', () => {
    expect(sanitizeToolText('hello world')).toBe('hello world')
  })

  it('preserves tab (U+0009)', () => {
    expect(sanitizeToolText('a\tb')).toBe('a\tb')
  })

  it('preserves newline (U+000A)', () => {
    expect(sanitizeToolText('a\nb')).toBe('a\nb')
  })

  it('preserves carriage return (U+000D)', () => {
    expect(sanitizeToolText('a\rb')).toBe('a\rb')
  })

  it('strips BOM (U+FEFF)', () => {
    expect(sanitizeToolText('\uFEFFhello')).toBe('hello')
    expect(sanitizeToolText('hello\uFEFF')).toBe('hello')
  })

  it('strips NUL (U+0000)', () => {
    expect(sanitizeToolText('a\u0000b')).toBe('ab')
  })

  it('strips C0 controls: U+0001–U+0008', () => {
    for (let cp = 0x01; cp <= 0x08; cp++) {
      const ch = String.fromCodePoint(cp)
      expect(sanitizeToolText(`a${ch}b`)).toBe('ab')
    }
  })

  it('strips VT (U+000B) and FF (U+000C)', () => {
    expect(sanitizeToolText('a\u000Bb')).toBe('ab')
    expect(sanitizeToolText('a\u000Cb')).toBe('ab')
  })

  it('strips C0 controls: U+000E–U+001F (except tab/LF/CR which are preserved)', () => {
    for (let cp = 0x0e; cp <= 0x1f; cp++) {
      const ch = String.fromCodePoint(cp)
      expect(sanitizeToolText(`a${ch}b`)).toBe('ab')
    }
  })

  it('strips C1 controls: U+0080–U+009F', () => {
    for (let cp = 0x80; cp <= 0x9f; cp++) {
      const ch = String.fromCodePoint(cp)
      expect(sanitizeToolText(`a${ch}b`)).toBe('ab')
    }
  })

  it('strips zero-width space (U+200B)', () => {
    expect(sanitizeToolText('a\u200Bb')).toBe('ab')
  })

  it('strips zero-width non-joiner (U+200C)', () => {
    expect(sanitizeToolText('a\u200Cb')).toBe('ab')
  })

  it('strips zero-width joiner (U+200D)', () => {
    expect(sanitizeToolText('a\u200Db')).toBe('ab')
  })

  it('strips word joiner (U+2060)', () => {
    expect(sanitizeToolText('a\u2060b')).toBe('ab')
  })

  it('strips all four categories simultaneously', () => {
    // BOM + NUL + C1 (U+0080) + zero-width (U+200B)
    const input = '\uFEFF\u0000\u0080\u200Bhello\t\n\r'
    const result = sanitizeToolText(input)
    // All control chars gone; hello, tab, newline, CR preserved
    expect(result).toBe('hello\t\n\r')
  })

  it('preserves Unicode letters and emoji', () => {
    const s = 'Héllo 世界 🎉'
    expect(sanitizeToolText(s)).toBe(s)
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeToolText('')).toBe('')
  })
})
