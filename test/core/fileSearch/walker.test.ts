// test/core/fileSearch/walker.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SKIP_DIRS,
  walkFiles,
} from '../../../src/core/fileSearch/walker'

async function makeTree(root: string): Promise<void> {
  // root/
  //   a.ts
  //   b.ts
  //   .dotfile
  //   src/
  //     index.ts
  //     deep/
  //       nested.ts
  //   node_modules/
  //     dep/index.js          (must be skipped)
  //   .git/
  //     HEAD                  (must be skipped)
  //   dist/
  //     bundle.js             (must be skipped)
  await writeFile(join(root, 'a.ts'), '')
  await writeFile(join(root, 'b.ts'), '')
  await writeFile(join(root, '.dotfile'), '')
  await mkdir(join(root, 'src', 'deep'), { recursive: true })
  await writeFile(join(root, 'src', 'index.ts'), '')
  await writeFile(join(root, 'src', 'deep', 'nested.ts'), '')
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), '')
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main')
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'bundle.js'), '')
}

describe('walkFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-fileSearch-'))
    await makeTree(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns relative forward-slash paths', async () => {
    const files = await walkFiles({ rootDir: dir })
    // All paths should be relative and use forward slashes (even on Windows).
    for (const p of files) {
      expect(p.startsWith('/')).toBe(false)
      expect(p.includes('\\')).toBe(false)
    }
  })

  it('walks files at multiple depths', async () => {
    const files = await walkFiles({ rootDir: dir })
    expect(files).toContain('a.ts')
    expect(files).toContain('b.ts')
    expect(files).toContain('src/index.ts')
    expect(files).toContain('src/deep/nested.ts')
  })

  it('skips default-skip dirs (node_modules, .git, dist)', async () => {
    const files = await walkFiles({ rootDir: dir })
    expect(files.some(f => f.startsWith('node_modules/'))).toBe(false)
    expect(files.some(f => f.startsWith('.git/'))).toBe(false)
    expect(files.some(f => f.startsWith('dist/'))).toBe(false)
  })

  it('skips dotfiles by default', async () => {
    const files = await walkFiles({ rootDir: dir })
    expect(files).not.toContain('.dotfile')
  })

  it('includes dotfiles when includeDotfiles: true', async () => {
    const files = await walkFiles({ rootDir: dir, includeDotfiles: true })
    expect(files).toContain('.dotfile')
    // .git still respects skip-list even with includeDotfiles
    expect(files.some(f => f.startsWith('.git/'))).toBe(false)
  })

  it('respects maxDepth', async () => {
    const files = await walkFiles({ rootDir: dir, maxDepth: 1 })
    // depth 0 = direct children only when depth-incremented before
    // recursion. With maxDepth=1 we should see src/index.ts but NOT
    // src/deep/nested.ts.
    expect(files).toContain('a.ts')
    expect(files).toContain('src/index.ts')
    expect(files).not.toContain('src/deep/nested.ts')
  })

  it('respects maxEntries', async () => {
    const files = await walkFiles({ rootDir: dir, maxEntries: 2 })
    expect(files.length).toBeLessThanOrEqual(2)
  })

  it('respects extraSkipDirs', async () => {
    const files = await walkFiles({
      rootDir: dir,
      extraSkipDirs: ['src'],
    })
    expect(files.some(f => f.startsWith('src/'))).toBe(false)
    expect(files).toContain('a.ts')
  })

  it('skipDirs overrides the defaults entirely', async () => {
    const files = await walkFiles({
      rootDir: dir,
      skipDirs: [], // walk EVERYTHING (well, except dotfiles)
    })
    // Now node_modules entries should appear (no longer skipped).
    expect(files.some(f => f.startsWith('node_modules/'))).toBe(true)
  })

  it('shouldInclude filters out paths', async () => {
    const files = await walkFiles({
      rootDir: dir,
      shouldInclude: p => p.endsWith('.ts'),
    })
    expect(files.every(f => f.endsWith('.ts'))).toBe(true)
    expect(files.length).toBeGreaterThan(0)
  })

  it('handles missing root directory gracefully', async () => {
    const files = await walkFiles({
      rootDir: join(dir, 'does-not-exist'),
    })
    expect(files).toEqual([])
  })

  it('respects an aborted signal', async () => {
    const ac = new AbortController()
    ac.abort()
    const files = await walkFiles({ rootDir: dir, signal: ac.signal })
    expect(files).toEqual([])
  })

  it('DEFAULT_SKIP_DIRS includes the usual suspects', () => {
    expect(DEFAULT_SKIP_DIRS.has('.git')).toBe(true)
    expect(DEFAULT_SKIP_DIRS.has('node_modules')).toBe(true)
    expect(DEFAULT_SKIP_DIRS.has('dist')).toBe(true)
  })
})

describe('walkFiles — respectGitignore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-fileSearch-gi-'))
    // tree:
    //   a.ts
    //   b.ts
    //   ignored.log
    //   src/
    //     index.ts
    //     debug.log
    //   logs/
    //     keep-me.txt
    await writeFile(join(dir, 'a.ts'), '')
    await writeFile(join(dir, 'b.ts'), '')
    await writeFile(join(dir, 'ignored.log'), '')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'index.ts'), '')
    await writeFile(join(dir, 'src', 'debug.log'), '')
    await mkdir(join(dir, 'logs'), { recursive: true })
    await writeFile(join(dir, 'logs', 'keep-me.txt'), '')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('default (respectGitignore omitted) → no gitignore IO, same behavior', async () => {
    // Write a .gitignore that WOULD exclude things if respected; the
    // default code path must IGNORE this file and return all .log files.
    await writeFile(join(dir, '.gitignore'), '*.log\n')
    const files = await walkFiles({ rootDir: dir })
    expect(files).toContain('a.ts')
    expect(files).toContain('ignored.log')
    expect(files).toContain('src/debug.log')
  })

  it('respectGitignore: true with .gitignore → ignored files skipped', async () => {
    await writeFile(join(dir, '.gitignore'), '*.log\n')
    const files = await walkFiles({ rootDir: dir, respectGitignore: true })
    expect(files).toContain('a.ts')
    expect(files).toContain('b.ts')
    expect(files).toContain('src/index.ts')
    expect(files).toContain('logs/keep-me.txt')
    // The two .log files are now excluded by .gitignore.
    expect(files).not.toContain('ignored.log')
    expect(files).not.toContain('src/debug.log')
  })

  it('respectGitignore: true AND custom shouldInclude → both predicates AND-ed', async () => {
    await writeFile(join(dir, '.gitignore'), '*.log\n')
    const files = await walkFiles({
      rootDir: dir,
      respectGitignore: true,
      // caller-side filter: only `.ts`
      shouldInclude: p => p.endsWith('.ts'),
    })
    // .ts files NOT ignored by gitignore → kept
    expect(files).toContain('a.ts')
    expect(files).toContain('b.ts')
    expect(files).toContain('src/index.ts')
    // .log files: caller filter drops them anyway
    expect(files).not.toContain('ignored.log')
    expect(files).not.toContain('src/debug.log')
    // .txt: gitignore allows, caller filter rejects (AND-ed)
    expect(files).not.toContain('logs/keep-me.txt')
    // everything must be .ts
    expect(files.every(f => f.endsWith('.ts'))).toBe(true)
  })

  it('respectGitignore: true with NO .gitignore → graceful no-op', async () => {
    // No .gitignore present in `dir`. Walk should not throw and should
    // return the full set (modulo dotfiles / skip-dirs).
    const files = await walkFiles({ rootDir: dir, respectGitignore: true })
    expect(files).toContain('a.ts')
    expect(files).toContain('b.ts')
    expect(files).toContain('ignored.log')
    expect(files).toContain('src/index.ts')
    expect(files).toContain('src/debug.log')
    expect(files).toContain('logs/keep-me.txt')
  })

  it('gitignoreRoot points to a different repo → uses that root', async () => {
    // dir has NO .gitignore. otherDir has a .gitignore that excludes
    // `*.log`. With gitignoreRoot=otherDir, the walker should pull the
    // patterns from otherDir but still walk `dir`.
    const otherDir = await mkdtemp(join(tmpdir(), 'nuka-fileSearch-gi-other-'))
    try {
      await writeFile(join(otherDir, '.gitignore'), '*.log\n')
      const files = await walkFiles({
        rootDir: dir,
        respectGitignore: true,
        gitignoreRoot: otherDir,
      })
      // .log files excluded by otherDir's gitignore
      expect(files).not.toContain('ignored.log')
      expect(files).not.toContain('src/debug.log')
      // everything else stays
      expect(files).toContain('a.ts')
      expect(files).toContain('src/index.ts')
      expect(files).toContain('logs/keep-me.txt')
    } finally {
      await rm(otherDir, { recursive: true, force: true })
    }
  })
})
