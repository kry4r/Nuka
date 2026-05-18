import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  teamMemoryPath,
  teamMemoryDir,
  isTeamMemoryEnabled,
  validateTeamMemKey,
  PathTraversalError,
} from '../../../src/core/memdir/teamMemPaths'

describe('teamMemoryPath', () => {
  it('returns <home>/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md', () => {
    const p = teamMemoryPath('acme', '/repo/app', '/h')
    // sha1 of '/repo/app' is deterministic; we just assert the shape.
    expect(p.startsWith('/h/.nuka/team-memory/acme/')).toBe(true)
    expect(p.endsWith('/MEMORY.md')).toBe(true)
  })

  it('produces different hashes for different cwd values', () => {
    const a = teamMemoryPath('acme', '/repo/a', '/h')
    const b = teamMemoryPath('acme', '/repo/b', '/h')
    expect(a).not.toBe(b)
  })

  it('isolates two teams sharing the same cwd', () => {
    const a = teamMemoryPath('teamA', '/repo/x', '/h')
    const b = teamMemoryPath('teamB', '/repo/x', '/h')
    expect(a).not.toBe(b)
    expect(a.includes('/teamA/')).toBe(true)
    expect(b.includes('/teamB/')).toBe(true)
  })
})

describe('isTeamMemoryEnabled', () => {
  it('returns true when teamId is a non-empty string', () => {
    expect(isTeamMemoryEnabled({ teamId: 'acme' })).toBe(true)
  })

  it('returns false when teamId is undefined', () => {
    expect(isTeamMemoryEnabled({})).toBe(false)
  })
})

describe('validateTeamMemKey', () => {
  it('accepts a simple relative key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tm-key-ok-'))
    try {
      const resolved = await validateTeamMemKey('acme', '/repo/app', 'sub/file.md', home)
      expect(resolved.startsWith(teamMemoryDir('acme', '/repo/app', home))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects keys with .. traversal', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '../escape.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with null bytes', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', 'bad\0file.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with absolute paths', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '/etc/passwd', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects keys with backslashes', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '..\\evil.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects URL-encoded traversal', async () => {
    await expect(
      validateTeamMemKey('acme', '/repo/app', '%2e%2e%2fevil.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects NFKC-normalized unicode separator (fullwidth solidus)', async () => {
    // U+FF0F (fullwidth solidus) normalizes to ASCII '/' under NFKC.
    // Sanitizer must reject so downstream filesystems / layers that do
    // normalize cannot be tricked into seeing a separator.
    await expect(
      validateTeamMemKey('acme', '/repo/app', '..\uFF0Fevil.md', '/h'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('rejects symlink-based escape', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tm-symlink-'))
    try {
      const teamDir = teamMemoryDir('acme', '/repo/app', home)
      mkdirSync(teamDir, { recursive: true })
      // Create a symlink inside teamDir pointing OUT of teamDir.
      const outside = mkdtempSync(join(tmpdir(), 'nuka-tm-outside-'))
      symlinkSync(outside, join(teamDir, 'escape'))
      await expect(
        validateTeamMemKey('acme', '/repo/app', 'escape/x.md', home),
      ).rejects.toBeInstanceOf(PathTraversalError)
      rmSync(outside, { recursive: true, force: true })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
