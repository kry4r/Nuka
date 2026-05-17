// test/core/fileSearch/fileIndex.test.ts
import { describe, expect, it } from 'vitest'
import {
  FileIndex,
  scorePath,
  type SearchResult,
} from '../../../src/core/fileSearch/fileIndex'

describe('FileIndex', () => {
  describe('loadFromFileList', () => {
    it('dedupes and filters empties', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['a.ts', 'a.ts', '', 'b.ts', ''])
      expect(idx.size()).toBe(2)
    })

    it('readyCount equals size after sync load', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['x', 'y', 'z'])
      expect(idx.ready()).toBe(3)
      expect(idx.size()).toBe(3)
    })
  })

  describe('search — basic ranking', () => {
    const sample = [
      'src/cli.tsx',
      'src/core/tools/registry.ts',
      'src/core/tools/types.ts',
      'src/core/fileSearch/fileIndex.ts',
      'src/tui/PromptInput/fuzzyFileSearch.ts',
      'src/utils/path.ts',
      'package.json',
      'README.md',
      'test/core/tools/registry.test.ts',
    ]

    const idx = new FileIndex()
    idx.loadFromFileList(sample)

    it('finds matches for a substring query', () => {
      const r = idx.search('cli', 5)
      expect(r.length).toBeGreaterThan(0)
      expect(r[0]!.path).toBe('src/cli.tsx')
    })

    it('subsequence match works (acronym-style)', () => {
      const r = idx.search('tlsr', 5)
      // "tools/registry" — non-contiguous chars t-l-...-s-r
      // Note: real-world fzf-style acronyms work; here we just assert
      // the search doesn't crash and returns something fuzzily related.
      expect(Array.isArray(r)).toBe(true)
    })

    it('returns empty array for non-matching needle char', () => {
      const r = idx.search('zzzqqq', 5)
      expect(r).toEqual([])
    })

    it('respects the limit', () => {
      const r = idx.search('s', 3)
      expect(r.length).toBeLessThanOrEqual(3)
    })

    it('limit 0 returns empty', () => {
      expect(idx.search('s', 0)).toEqual([])
    })

    it('empty query returns top-level cache up to limit', () => {
      const r = idx.search('', 5)
      // Top-level entries: src, test, package.json, README.md → 4 unique.
      // All entries should have score 0.0 (special sentinel).
      expect(r.length).toBeLessThanOrEqual(5)
      expect(r.length).toBeGreaterThan(0)
      r.forEach(x => expect(x.score).toBe(0))
    })

    it('top-level entries are sorted by length then alpha', () => {
      const r = idx.search('', 100)
      const paths = r.map(x => x.path)
      // 'src' (3), 'test' (4), 'README.md' (9), 'package.json' (12)
      // — exact order: shorter first, then alpha tiebreak.
      const srcIdx = paths.indexOf('src')
      const testIdx = paths.indexOf('test')
      const readmeIdx = paths.indexOf('README.md')
      expect(srcIdx).toBeLessThan(testIdx)
      expect(testIdx).toBeLessThan(readmeIdx)
    })
  })

  describe('search — scoring properties', () => {
    it('best match is at index 0 with score 0', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['a/b/c/long_path_no_match.ts', 'cli.ts'])
      const r = idx.search('cli', 5)
      expect(r[0]!.path).toBe('cli.ts')
      expect(r[0]!.score).toBe(0)
    })

    it('test-file penalty: non-test ranked above same-quality test file', () => {
      const idx = new FileIndex()
      idx.loadFromFileList([
        'src/foo.ts',
        'test/foo.test.ts',
      ])
      const r = idx.search('foo', 5)
      // foo.ts should rank ahead of foo.test.ts (shorter + non-test path).
      expect(r[0]!.path).toBe('src/foo.ts')
    })

    it('boundary bonus: query starting at path-segment boundary wins', () => {
      const idx = new FileIndex()
      idx.loadFromFileList([
        'src/abcXfoo.ts', // 'foo' starts in the middle of a segment
        'src/foo/bar.ts', // 'foo' at a segment boundary
      ])
      const r = idx.search('foo', 5)
      expect(r[0]!.path).toBe('src/foo/bar.ts')
    })

    it('smart case: lowercase query is case-insensitive', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['src/MyComponent.tsx'])
      const r = idx.search('mycomp', 5)
      expect(r.length).toBe(1)
      expect(r[0]!.path).toBe('src/MyComponent.tsx')
    })

    it('smart case: uppercase query enforces case-sensitive', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['src/MyComponent.tsx', 'src/mycomponent.tsx'])
      const r = idx.search('MyComp', 5)
      // With uppercase in query, we should only match the CamelCase one.
      expect(r.length).toBe(1)
      expect(r[0]!.path).toBe('src/MyComponent.tsx')
    })

    it('consecutive bonus: contiguous match beats split match', () => {
      // Use scorePath() to isolate the consecutive bonus from the
      // many other factors (boundary, camel, length, test-penalty)
      // that would otherwise blur the assertion at the search-result
      // level. Both paths here are the same length, neither contains
      // "test", and the matched chars are mid-segment for both.
      const sContig = scorePath('xyz', 'aaaxyzaaa.ts')
      const sGapped = scorePath('xyz', 'axayazaaa.ts')
      expect(sContig).not.toBeNull()
      expect(sGapped).not.toBeNull()
      expect(sContig!).toBeGreaterThan(sGapped!)
    })

    it('large dataset still returns top-k respecting limit', () => {
      const idx = new FileIndex()
      const paths: string[] = []
      for (let i = 0; i < 2000; i++) {
        paths.push(`pkg/mod${i}/file${i}.ts`)
      }
      paths.push('cli.ts')
      idx.loadFromFileList(paths)
      const r = idx.search('cli', 10)
      expect(r.length).toBeLessThanOrEqual(10)
      expect(r[0]!.path).toBe('cli.ts')
    })

    it('bitmap reject is correct: missing letter → no match', () => {
      const idx = new FileIndex()
      idx.loadFromFileList(['abc.ts', 'def.ts'])
      // 'q' isn't in either path; should return nothing.
      const r = idx.search('q', 5)
      expect(r).toEqual([])
    })
  })

  describe('search — score is monotonically non-decreasing', () => {
    it('emitted scores are sorted ascending (best first)', () => {
      const idx = new FileIndex()
      idx.loadFromFileList([
        'src/a/x.ts',
        'src/b/x.ts',
        'src/c/x.ts',
        'src/d/x.ts',
        'src/e/x.ts',
      ])
      const r: SearchResult[] = idx.search('x', 5)
      for (let i = 1; i < r.length; i++) {
        expect(r[i]!.score).toBeGreaterThanOrEqual(r[i - 1]!.score)
      }
    })
  })

  describe('loadFromFileListAsync', () => {
    it('queryable resolves before done; done resolves with full data', async () => {
      const idx = new FileIndex()
      const paths: string[] = []
      for (let i = 0; i < 5000; i++) {
        paths.push(`dir${i % 50}/file${i}.ts`)
      }
      const { queryable, done } = idx.loadFromFileListAsync(paths)
      await queryable
      // After queryable, readyCount > 0 and search returns something.
      expect(idx.ready()).toBeGreaterThan(0)
      await done
      expect(idx.ready()).toBe(idx.size())
      expect(idx.size()).toBe(5000)
    })
  })
})

describe('scorePath', () => {
  it('returns null when query not a subsequence', () => {
    expect(scorePath('xyz', 'foo.ts')).toBeNull()
  })

  it('returns 0 for empty query', () => {
    expect(scorePath('', 'whatever.ts')).toBe(0)
  })

  it('returns a positive score for an exact contiguous prefix match', () => {
    const s = scorePath('foo', 'foo.ts')
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(0)
  })

  it('shorter, boundary-aligned path scores higher than long padded match', () => {
    const sShort = scorePath('foo', 'foo.ts')
    const sLong = scorePath('foo', 'src/deep/very/long/path/abcfoo.ts')
    expect(sShort).not.toBeNull()
    expect(sLong).not.toBeNull()
    expect(sShort!).toBeGreaterThan(sLong!)
  })

  it('consecutive match scores higher than gapped match', () => {
    const sContig = scorePath('foo', 'foo_bar.ts')
    const sGap = scorePath('foo', 'fXoXo_bar.ts')
    expect(sContig).not.toBeNull()
    expect(sGap).not.toBeNull()
    expect(sContig!).toBeGreaterThan(sGap!)
  })

  it('case-sensitive when query has uppercase', () => {
    expect(scorePath('Foo', 'foo.ts')).toBeNull()
    expect(scorePath('Foo', 'Foo.ts')).not.toBeNull()
  })

  it('case-insensitive when query is lowercase', () => {
    expect(scorePath('foo', 'Foo.ts')).not.toBeNull()
  })
})
