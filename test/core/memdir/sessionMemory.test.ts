// test/core/memdir/sessionMemory.test.ts
//
// Coverage for `getSessionMemoryContent` + helpers. Uses a fresh
// `os.tmpdir()` per test to act as the fake `$HOME`. No mocks — the real
// `fs` is exercised end-to-end.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  extractMemoryLinks,
  getSessionMemoryContent,
  projectIdForCwd,
  sessionMemoryDir,
  sessionMemoryFilePath,
  stripFrontmatter,
} from '../../../src/core/memdir/sessionMemory'

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-sess-mem-'))
}

async function writeMemory(
  home: string,
  cwd: string,
  rel: string,
  content: string,
): Promise<string> {
  const dir = sessionMemoryDir(cwd, home)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
  return file
}

describe('sessionMemoryFilePath', () => {
  it('resolves to ~/.nuka/projects/<sha1>/memory/MEMORY.md', () => {
    const home = '/h'
    const cwd = '/projects/foo'
    const hash = projectIdForCwd(cwd)
    expect(sessionMemoryFilePath(cwd, home)).toBe(
      path.join(home, '.nuka', 'projects', hash, 'memory', 'MEMORY.md'),
    )
  })

  it('produces the same hash for the same cwd, different for different cwds', () => {
    expect(projectIdForCwd('/a')).toBe(projectIdForCwd('/a'))
    expect(projectIdForCwd('/a')).not.toBe(projectIdForCwd('/b'))
  })
})

describe('stripFrontmatter', () => {
  it('drops a clean frontmatter block', () => {
    const input = '---\nkey: value\nother: 1\n---\nbody line\nmore\n'
    expect(stripFrontmatter(input)).toBe('body line\nmore\n')
  })

  it('returns input untouched when frontmatter is unterminated', () => {
    const input = '---\nkey: value\nbody without close\n'
    expect(stripFrontmatter(input)).toBe(input)
  })

  it('returns input untouched when there is no frontmatter', () => {
    const input = 'plain body\n## heading\n'
    expect(stripFrontmatter(input)).toBe(input)
  })

  it('handles closing fence at EOF', () => {
    const input = '---\nx: 1\n---'
    expect(stripFrontmatter(input)).toBe('')
  })
})

describe('extractMemoryLinks', () => {
  it('returns relative and absolute references on their own line', () => {
    const text = [
      'Intro paragraph.',
      '@./notes.md',
      'Some text',
      '@/abs/path.md',
      '  @nested/sub.md  ',
      'inline @nope.md should be skipped',
    ].join('\n')
    expect(extractMemoryLinks(text)).toEqual([
      './notes.md',
      '/abs/path.md',
      'nested/sub.md',
    ])
  })

  it('ignores @-handles that do not look like paths', () => {
    expect(extractMemoryLinks('@username\n@team-handle\n')).toEqual([])
  })

  it('returns [] on empty input', () => {
    expect(extractMemoryLinks('')).toEqual([])
  })
})

describe('getSessionMemoryContent', () => {
  let home: string
  const cwd = '/test/cwd'

  beforeEach(async () => {
    home = await tmpHome()
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })

  it('returns null when no memory directory exists', async () => {
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBeNull()
  })

  it('returns null when MEMORY.md does not exist (dir present)', async () => {
    await fs.mkdir(sessionMemoryDir(cwd, home), { recursive: true })
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBeNull()
  })

  it('returns null when MEMORY.md is empty after trim', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', '   \n\n\t\n')
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBeNull()
  })

  it('returns the body when MEMORY.md has only content (no frontmatter)', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', 'first line\nsecond line\n')
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBe('first line\nsecond line')
  })

  it('strips frontmatter from MEMORY.md', async () => {
    await writeMemory(
      home,
      cwd,
      'MEMORY.md',
      '---\ntitle: my mem\n---\nactual body\n',
    )
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBe('actual body')
  })

  it('tolerates malformed frontmatter without throwing', async () => {
    // Unterminated fence — should return file content as-is.
    const raw = '---\nbroken: yes\n\nno close\nbody here\n'
    await writeMemory(home, cwd, 'MEMORY.md', raw)
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBe(raw.trim())
  })

  it('inlines linked files referenced by @relative.md', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', 'top\n@./notes.md\n')
    await writeMemory(home, cwd, 'notes.md', 'note body')
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toContain('top')
    expect(out).toContain('note body')
    expect(out).toContain('<!-- @./notes.md -->')
  })

  it('strips frontmatter from inlined linked files', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', '@./notes.md\n')
    await writeMemory(
      home,
      cwd,
      'notes.md',
      '---\ntitle: notes\n---\nclean body\n',
    )
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toContain('clean body')
    expect(out).not.toContain('title: notes')
  })

  it('rejects @-links that escape the memory directory', async () => {
    await fs.mkdir(sessionMemoryDir(cwd, home), { recursive: true })
    const outside = path.join(home, 'outside.md')
    await fs.writeFile(outside, 'secret data\n', 'utf8')
    await writeMemory(home, cwd, 'MEMORY.md', `@../outside.md\n@${outside}\n`)
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).not.toContain('secret data')
  })

  it('detects cycles and emits [cycle] placeholder', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', '@./a.md\n')
    await writeMemory(home, cwd, 'a.md', '@./b.md\n')
    await writeMemory(home, cwd, 'b.md', '@./a.md\n')
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toContain('[cycle]')
  })

  it('caps depth via maxDepth option', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', '@./a.md\n')
    await writeMemory(home, cwd, 'a.md', '@./b.md\nA-body')
    await writeMemory(home, cwd, 'b.md', '@./c.md\nB-body')
    await writeMemory(home, cwd, 'c.md', 'C-body\n')
    const out = await getSessionMemoryContent({
      home,
      cwd,
      maxDepth: 1,
    })
    expect(out).toContain('A-body')
    // At depth 1, the walker reads a.md but does NOT follow its @./b.md link.
    expect(out).not.toContain('B-body')
    expect(out).not.toContain('C-body')
  })

  it('caps total inlined files via maxFiles option', async () => {
    await writeMemory(home, cwd, 'MEMORY.md', '@./a.md\n@./b.md\n')
    await writeMemory(home, cwd, 'a.md', 'A-body')
    await writeMemory(home, cwd, 'b.md', 'B-body')
    // maxFiles=2 → MEMORY.md + one link
    const out = await getSessionMemoryContent({ home, cwd, maxFiles: 2 })
    expect(out).toContain('A-body')
    expect(out).not.toContain('B-body')
  })

  it('handles large files by truncating to maxBytesPerFile', async () => {
    const big = 'x'.repeat(50_000)
    await writeMemory(home, cwd, 'MEMORY.md', big)
    const out = await getSessionMemoryContent({
      home,
      cwd,
      maxBytesPerFile: 4096,
    })
    expect(out?.length).toBeLessThanOrEqual(4096)
    expect(out?.startsWith('xxxx')).toBe(true)
  })

  it('does not throw when MEMORY.md is a directory (returns null)', async () => {
    const dir = sessionMemoryDir(cwd, home)
    await fs.mkdir(path.join(dir, 'MEMORY.md'), { recursive: true })
    const out = await getSessionMemoryContent({ home, cwd })
    expect(out).toBeNull()
  })
})
