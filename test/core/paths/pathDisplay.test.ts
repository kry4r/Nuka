// test/core/paths/pathDisplay.test.ts
//
// Unit tests for the pathDisplay formatter. All tests pass an explicit
// `home` and / or `cwd` so they don't depend on the host machine.

import { describe, it, expect } from 'vitest'
import {
  tildify,
  unhomedir,
  truncatePathMiddle,
  relativizeForDisplay,
  displayPath,
  splitPath,
} from '../../../src/core/paths/pathDisplay'

const HOME = '/Users/alice'
const WIN_HOME = 'C:\\Users\\alice'

describe('tildify', () => {
  it('returns empty string unchanged', () => {
    expect(tildify('', { home: HOME })).toBe('')
  })

  it('replaces the homedir prefix with ~ on posix paths', () => {
    expect(tildify('/Users/alice/projects/foo.ts', { home: HOME })).toBe(
      '~/projects/foo.ts',
    )
  })

  it('returns ~ when the path is exactly the homedir', () => {
    expect(tildify('/Users/alice', { home: HOME })).toBe('~')
  })

  it('leaves an absolute path outside homedir unchanged', () => {
    expect(tildify('/etc/passwd', { home: HOME })).toBe('/etc/passwd')
  })

  it('does not tildify a sibling whose name shares the homedir prefix', () => {
    // `/Users/alice2` must NOT match against home `/Users/alice`.
    expect(tildify('/Users/alice2/foo', { home: HOME })).toBe(
      '/Users/alice2/foo',
    )
  })

  it('leaves a relative path unchanged', () => {
    expect(tildify('relative/path/foo.ts', { home: HOME })).toBe(
      'relative/path/foo.ts',
    )
    expect(tildify('./foo.ts', { home: HOME })).toBe('./foo.ts')
    expect(tildify('../up.ts', { home: HOME })).toBe('../up.ts')
  })

  it('handles Windows drive paths', () => {
    expect(
      tildify('C:\\Users\\alice\\Docs\\file.ts', { home: WIN_HOME }),
    ).toBe('~\\Docs\\file.ts')
  })

  it('handles a homedir that is just /', () => {
    expect(tildify('/etc/foo', { home: '/' })).toBe('~/etc/foo')
  })

  it('returns input unchanged when home is empty', () => {
    expect(tildify('/Users/alice/foo', { home: '' })).toBe('/Users/alice/foo')
  })
})

describe('unhomedir', () => {
  it('is the inverse of tildify for posix paths', () => {
    const abs = '/Users/alice/projects/foo.ts'
    expect(unhomedir(tildify(abs, { home: HOME }), { home: HOME })).toBe(abs)
  })

  it('expands ~ alone to the homedir', () => {
    expect(unhomedir('~', { home: HOME })).toBe(HOME)
  })

  it('leaves a path that does not start with ~ unchanged', () => {
    expect(unhomedir('/etc/passwd', { home: HOME })).toBe('/etc/passwd')
    expect(unhomedir('relative/file', { home: HOME })).toBe('relative/file')
  })

  it('expands ~\\ on Windows', () => {
    expect(unhomedir('~\\Docs\\f.ts', { home: WIN_HOME })).toBe(
      'C:\\Users\\alice\\Docs\\f.ts',
    )
  })

  it('returns empty input as empty', () => {
    expect(unhomedir('', { home: HOME })).toBe('')
  })
})

describe('truncatePathMiddle', () => {
  it('returns short paths unchanged', () => {
    expect(truncatePathMiddle('/a/b.ts', 20)).toBe('/a/b.ts')
  })

  it('returns the same string when maxLen exceeds path length', () => {
    expect(truncatePathMiddle('/a/very/long/path/file.ts', 500)).toBe(
      '/a/very/long/path/file.ts',
    )
  })

  it('truncates a long path keeping the filename intact', () => {
    const out = truncatePathMiddle(
      '/a/very/deeply/nested/middle/segments/short.ts',
      24,
    )
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out.endsWith('/short.ts')).toBe(true)
    expect(out).toContain('...')
    // First segment preserved so we know we're somewhere under /a.
    expect(out.startsWith('/a/')).toBe(true)
  })

  it('uses the same separator as the input', () => {
    const out = truncatePathMiddle(
      'C:\\a\\very\\deep\\path\\to\\file.ts',
      18,
    )
    expect(out).toContain('\\')
    expect(out.endsWith('\\file.ts')).toBe(true)
  })

  it('middle-truncates a very long filename, preserving the extension', () => {
    const filename = 'x'.repeat(60) + '.ts'
    const out = truncatePathMiddle('/dir/' + filename, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('.ts')).toBe(true)
    expect(out).toContain('...')
  })

  it('uses a custom ellipsis', () => {
    const out = truncatePathMiddle(
      '/a/b/c/d/e/f/g/short.ts',
      16,
      { ellipsis: '*' },
    )
    expect(out.length).toBeLessThanOrEqual(16)
    expect(out).toContain('*')
    expect(out).not.toContain('...')
  })

  it('rejects maxLen < 1', () => {
    expect(() => truncatePathMiddle('/a/b.ts', 0)).toThrow(RangeError)
  })

  it('handles empty input', () => {
    expect(truncatePathMiddle('', 10)).toBe('')
  })

  it('handles a path with .. segments', () => {
    const out = truncatePathMiddle('../../up/up/up/up/up/file.ts', 18)
    expect(out.length).toBeLessThanOrEqual(18)
    expect(out.endsWith('/file.ts')).toBe(true)
  })
})

describe('relativizeForDisplay', () => {
  const cwd = '/Users/alice/projects/nuka'

  it('returns "." when target equals cwd', () => {
    expect(relativizeForDisplay(cwd, cwd)).toBe('.')
  })

  it('returns a relative path when target is inside cwd', () => {
    expect(
      relativizeForDisplay('/Users/alice/projects/nuka/src/main.ts', cwd),
    ).toBe('src/main.ts')
  })

  it('returns tildified absolute when target is outside cwd by default', () => {
    expect(
      relativizeForDisplay('/Users/alice/other/file.ts', cwd, {
        home: HOME,
      }),
    ).toBe('~/other/file.ts')
  })

  it('returns the relative ../ form when within maxRelativeUp', () => {
    const out = relativizeForDisplay(
      '/Users/alice/projects/other/file.ts',
      cwd,
      { maxRelativeUp: 1 },
    )
    expect(out).toBe('../other/file.ts')
  })

  it('falls back to tildify when relative would exceed maxRelativeUp', () => {
    const out = relativizeForDisplay(
      '/Users/alice/other/deep/file.ts',
      cwd,
      { maxRelativeUp: 1, home: HOME },
    )
    expect(out).toBe('~/other/deep/file.ts')
  })

  it('returns target unchanged when target is relative', () => {
    expect(relativizeForDisplay('rel/file.ts', cwd)).toBe('rel/file.ts')
  })

  it('falls back to tildify when cwd is not absolute', () => {
    expect(
      relativizeForDisplay('/Users/alice/foo.ts', 'not/absolute', {
        home: HOME,
      }),
    ).toBe('~/foo.ts')
  })

  it('handles empty input', () => {
    expect(relativizeForDisplay('', cwd)).toBe('')
  })

  it('respects preferRelativeWhenWithin=false', () => {
    expect(
      relativizeForDisplay(
        '/Users/alice/projects/nuka/src/main.ts',
        cwd,
        { preferRelativeWhenWithin: false, home: HOME },
      ),
    ).toBe('~/projects/nuka/src/main.ts')
  })
})

describe('displayPath', () => {
  const cwd = '/Users/alice/projects/nuka'

  it('returns empty input as empty', () => {
    expect(displayPath('')).toBe('')
  })

  it('relativises + tildifies + truncates in one call', () => {
    const out = displayPath(
      '/Users/alice/projects/nuka/src/a/b/c/d/e/file.ts',
      { cwd, home: HOME, maxLen: 24 },
    )
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out.endsWith('/file.ts')).toBe(true)
  })

  it('tildifies when target is outside cwd', () => {
    expect(
      displayPath('/Users/alice/foo.ts', { cwd, home: HOME }),
    ).toBe('~/foo.ts')
  })

  it('omits truncation when maxLen is not set', () => {
    expect(
      displayPath('/Users/alice/projects/nuka/src/main.ts', {
        cwd,
        home: HOME,
      }),
    ).toBe('src/main.ts')
  })

  it('only tildifies when no cwd is given', () => {
    expect(
      displayPath('/Users/alice/foo/bar.ts', { home: HOME }),
    ).toBe('~/foo/bar.ts')
  })

  it('rejects maxLen < 1', () => {
    expect(() =>
      displayPath('/a/b.ts', { maxLen: 0, home: HOME }),
    ).toThrow(RangeError)
  })

  it('passes through custom ellipsis to the truncator', () => {
    const out = displayPath(
      '/Users/alice/projects/nuka/very/deep/nested/file.ts',
      { cwd, home: HOME, maxLen: 18, ellipsis: '*' },
    )
    expect(out).toContain('*')
    expect(out).not.toContain('...')
  })
})

describe('splitPath', () => {
  it('returns three empty strings for empty input', () => {
    expect(splitPath('')).toEqual({ dir: '', base: '', ext: '' })
  })

  it('splits a posix path with extension', () => {
    expect(splitPath('/a/b/c.ts')).toEqual({
      dir: '/a/b',
      base: 'c.ts',
      ext: '.ts',
    })
  })

  it('handles a path with no extension', () => {
    expect(splitPath('/a/b/c')).toEqual({
      dir: '/a/b',
      base: 'c',
      ext: '',
    })
  })

  it('handles a dotfile (leading dot, no extension)', () => {
    expect(splitPath('/a/.bashrc')).toEqual({
      dir: '/a',
      base: '.bashrc',
      ext: '',
    })
  })

  it('handles a Windows path', () => {
    expect(splitPath('C:\\Users\\alice\\file.ts')).toEqual({
      dir: 'C:\\Users\\alice',
      base: 'file.ts',
      ext: '.ts',
    })
  })

  it('handles a bare filename', () => {
    expect(splitPath('file.ts')).toEqual({
      dir: '.',
      base: 'file.ts',
      ext: '.ts',
    })
  })
})
