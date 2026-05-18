import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { loadTeamMemory } from '../../../src/core/memdir'
import { teamMemoryPath } from '../../../src/core/memdir/teamMemPaths'
import { formatMemoryEntry, type MemoryEntry } from '../../../src/core/memdir/parser'

function writeTeamFile(home: string, teamId: string, cwd: string, body: string): void {
  const p = teamMemoryPath(teamId, cwd, home)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body, 'utf8')
}

function mkEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    ts: '2026-05-18T00:00:00Z',
    sessionId: 's1',
    keywords: ['alpha', 'beta'],
    body: 'Body of the team-memory note.',
    ...overrides,
  }
}

describe('loadTeamMemory', () => {
  it('returns [] when the file does not exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-empty-'))
    try {
      const out = await loadTeamMemory('acme', '/repo/app', home)
      expect(out).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('parses entries from disk', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-parse-'))
    try {
      writeTeamFile(home, 'acme', '/repo/app', formatMemoryEntry(mkEntry()))
      const out = await loadTeamMemory('acme', '/repo/app', home)
      expect(out).toHaveLength(1)
      expect(out[0]?.body).toContain('Body of the team-memory note.')
      expect(out[0]?.keywords).toEqual(['alpha', 'beta'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('isolates entries across teams sharing the same cwd', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-isolate-'))
    try {
      writeTeamFile(
        home,
        'teamA',
        '/repo/x',
        formatMemoryEntry(
          mkEntry({ sessionId: 'a', keywords: ['a'], body: 'team A note' }),
        ),
      )
      writeTeamFile(
        home,
        'teamB',
        '/repo/x',
        formatMemoryEntry(
          mkEntry({ sessionId: 'b', keywords: ['b'], body: 'team B note' }),
        ),
      )

      const a = await loadTeamMemory('teamA', '/repo/x', home)
      const b = await loadTeamMemory('teamB', '/repo/x', home)
      expect(a[0]?.body).toContain('team A note')
      expect(b[0]?.body).toContain('team B note')
      // Cross-team contamination check.
      expect(a.some(e => e.body.includes('team B'))).toBe(false)
      expect(b.some(e => e.body.includes('team A'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('isolates entries across different cwd under the same team', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-tml-cwd-'))
    try {
      writeTeamFile(
        home,
        'acme',
        '/repo/x',
        formatMemoryEntry(
          mkEntry({ sessionId: 'x', keywords: ['x'], body: 'cwd x note' }),
        ),
      )
      writeTeamFile(
        home,
        'acme',
        '/repo/y',
        formatMemoryEntry(
          mkEntry({ sessionId: 'y', keywords: ['y'], body: 'cwd y note' }),
        ),
      )
      const x = await loadTeamMemory('acme', '/repo/x', home)
      const y = await loadTeamMemory('acme', '/repo/y', home)
      expect(x[0]?.body).toContain('cwd x note')
      expect(y[0]?.body).toContain('cwd y note')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
