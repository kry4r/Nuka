// test/core/fileSearch/gitignoreFilter.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createGitignoreFilter,
  gitignoreFilter,
  loadGitignorePatterns,
} from '../../../src/core/fileSearch/gitignoreFilter'

describe('createGitignoreFilter — basics', () => {
  it('empty pattern list = include everything', () => {
    const fn = createGitignoreFilter([])
    expect(fn('any/path.ts')).toBe(true)
    expect(fn('node_modules/x.js')).toBe(true)
  })

  it('comments and blank lines are ignored at compile time', () => {
    // (loadGitignorePatterns drops them; we also tolerate them here)
    const fn = createGitignoreFilter([
      '# header comment',
      '',
      '   ',
      'foo.txt',
    ])
    expect(fn('foo.txt')).toBe(false)
    expect(fn('bar.txt')).toBe(true)
  })

  it('exact filename matches at any depth (no slash in pattern)', () => {
    const fn = createGitignoreFilter(['foo.log'])
    expect(fn('foo.log')).toBe(false)
    expect(fn('src/foo.log')).toBe(false)
    expect(fn('a/b/c/foo.log')).toBe(false)
    expect(fn('foo.log.bak')).toBe(true)
    expect(fn('bar.log')).toBe(true)
  })

  it('star matches within a single path segment', () => {
    const fn = createGitignoreFilter(['*.log'])
    expect(fn('a.log')).toBe(false)
    expect(fn('src/b.log')).toBe(false)
    expect(fn('a.txt')).toBe(true)
  })

  it('star does not cross slashes', () => {
    const fn = createGitignoreFilter(['/build/*.js'])
    expect(fn('build/x.js')).toBe(false)
    // `*` must not eat the slash; nested file should pass through.
    expect(fn('build/sub/x.js')).toBe(true)
  })
})

describe('createGitignoreFilter — anchoring', () => {
  it('leading slash anchors to repo root', () => {
    const fn = createGitignoreFilter(['/build'])
    expect(fn('build/out.js')).toBe(false)
    expect(fn('build')).toBe(false)
    // a `build` directory NOT at the root should pass through
    expect(fn('src/build/out.js')).toBe(true)
  })

  it('pattern with embedded slash is anchored', () => {
    const fn = createGitignoreFilter(['src/temp.ts'])
    expect(fn('src/temp.ts')).toBe(false)
    // basename match elsewhere does NOT trigger an anchored rule
    expect(fn('lib/src/temp.ts')).toBe(true)
  })

  it('un-anchored pattern matches at any depth', () => {
    const fn = createGitignoreFilter(['temp.ts'])
    expect(fn('temp.ts')).toBe(false)
    expect(fn('src/temp.ts')).toBe(false)
    expect(fn('a/b/c/temp.ts')).toBe(false)
  })
})

describe('createGitignoreFilter — directories', () => {
  it('trailing slash = dir-only — ignores everything beneath', () => {
    const fn = createGitignoreFilter(['build/'])
    // walker emits files; we should ignore files under `build/...`
    expect(fn('build/x.js')).toBe(false)
    expect(fn('build/sub/y.js')).toBe(false)
    expect(fn('src/build/x.js')).toBe(false) // un-anchored
  })

  it('anchored dir-only pattern', () => {
    const fn = createGitignoreFilter(['/dist/'])
    expect(fn('dist/x.js')).toBe(false)
    expect(fn('src/dist/x.js')).toBe(true)
  })
})

describe('createGitignoreFilter — double-star (**)', () => {
  it('leading **/ matches any number of dirs', () => {
    const fn = createGitignoreFilter(['**/foo.txt'])
    expect(fn('foo.txt')).toBe(false)
    expect(fn('a/foo.txt')).toBe(false)
    expect(fn('a/b/c/foo.txt')).toBe(false)
  })

  it('mid /**/ matches zero-or-more dirs in the middle', () => {
    const fn = createGitignoreFilter(['src/**/snapshot.ts'])
    expect(fn('src/snapshot.ts')).toBe(false)
    expect(fn('src/a/snapshot.ts')).toBe(false)
    expect(fn('src/a/b/snapshot.ts')).toBe(false)
    expect(fn('lib/src/snapshot.ts')).toBe(true)
  })

  it('trailing /** matches everything beneath', () => {
    const fn = createGitignoreFilter(['vendor/**'])
    expect(fn('vendor/x.js')).toBe(false)
    expect(fn('vendor/a/b/c.js')).toBe(false)
    expect(fn('src/vendor/x.js')).toBe(true)
  })
})

describe('createGitignoreFilter — negations', () => {
  it('! re-includes a file that an earlier pattern excluded', () => {
    const fn = createGitignoreFilter(['*.log', '!keep.log'])
    expect(fn('foo.log')).toBe(false)
    expect(fn('keep.log')).toBe(true)
    expect(fn('src/keep.log')).toBe(true)
  })

  it('order matters — last match wins', () => {
    const fn = createGitignoreFilter([
      '*.log',
      '!keep.log',
      'keep.log', // re-exclude
    ])
    expect(fn('keep.log')).toBe(false)
  })

  it('escaped \\! is a literal bang prefix', () => {
    // pattern matches a file literally called `!important.txt`
    const fn = createGitignoreFilter(['\\!important.txt'])
    expect(fn('!important.txt')).toBe(false)
    expect(fn('important.txt')).toBe(true)
  })
})

describe('createGitignoreFilter — single-char glob (?)', () => {
  it('? matches exactly one non-slash char', () => {
    const fn = createGitignoreFilter(['te?t.ts'])
    expect(fn('test.ts')).toBe(false)
    expect(fn('temt.ts')).toBe(false)
    expect(fn('teest.ts')).toBe(true)
    // does not cross /
    expect(fn('te/t.ts')).toBe(true)
  })
})

describe('createGitignoreFilter — realistic patterns', () => {
  it('typical Node project gitignore', () => {
    const fn = createGitignoreFilter([
      'node_modules',
      'dist/',
      'coverage/',
      '*.log',
      '.env',
      '.env.*',
      '!.env.example',
      '/build',
    ])
    expect(fn('node_modules/foo/index.js')).toBe(false)
    expect(fn('dist/main.js')).toBe(false)
    expect(fn('coverage/lcov.info')).toBe(false)
    expect(fn('errors.log')).toBe(false)
    expect(fn('.env')).toBe(false)
    expect(fn('.env.local')).toBe(false)
    expect(fn('.env.example')).toBe(true)
    expect(fn('build/out.js')).toBe(false)
    expect(fn('src/build/out.js')).toBe(true) // /build is anchored
    expect(fn('src/index.ts')).toBe(true)
    expect(fn('package.json')).toBe(true)
  })
})

describe('loadGitignorePatterns — IO', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-gitignore-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns empty list when no ignore files are present', async () => {
    const patterns = await loadGitignorePatterns(dir)
    expect(patterns).toEqual([])
  })

  it('reads .gitignore and strips comments + blanks', async () => {
    await writeFile(
      join(dir, '.gitignore'),
      [
        '# this is a comment',
        '',
        '   ',
        'node_modules',
        '*.log',
        '   # trailing comment line still ignored',
      ].join('\n'),
    )
    const patterns = await loadGitignorePatterns(dir)
    // Comment-only line that has leading whitespace is still treated
    // as content by our minimal trim — but our implementation only
    // strips trailing whitespace and skips empty lines and `#`-leading
    // ones, so the `   # …` line is kept verbatim. That's acceptable
    // for our use case (it just becomes a literal pattern that won't
    // match anything realistic).
    expect(patterns).toContain('node_modules')
    expect(patterns).toContain('*.log')
    expect(patterns).not.toContain('# this is a comment')
    expect(patterns).not.toContain('')
  })

  it('reads .ignore and .rgignore in addition to .gitignore', async () => {
    await writeFile(join(dir, '.gitignore'), 'a.txt\n')
    await writeFile(join(dir, '.ignore'), 'b.txt\n')
    await writeFile(join(dir, '.rgignore'), 'c.txt\n')
    const patterns = await loadGitignorePatterns(dir)
    expect(patterns).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })
})

describe('gitignoreFilter — end-to-end', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-gitignore-e2e-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('combines load + compile for a working predicate', async () => {
    await writeFile(
      join(dir, '.gitignore'),
      ['node_modules', 'dist/', '*.log', '!keep.log'].join('\n'),
    )
    const fn = await gitignoreFilter(dir)
    expect(fn('src/index.ts')).toBe(true)
    expect(fn('node_modules/x/index.js')).toBe(false)
    expect(fn('dist/bundle.js')).toBe(false)
    expect(fn('errors.log')).toBe(false)
    expect(fn('keep.log')).toBe(true)
  })

  it('no ignore files → always-true predicate', async () => {
    const fn = await gitignoreFilter(dir)
    expect(fn('a.ts')).toBe(true)
    expect(fn('whatever/x.js')).toBe(true)
  })
})
