// test/core/memdir/parser.test.ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseMemoryFile,
  formatMemoryEntry,
  formatMemoryFile,
  type MemoryEntry,
} from '../../../src/core/memdir/parser'
import {
  memoryPath,
  loadMemory,
  appendMemory,
  writeAllMemory,
  clearMemory,
} from '../../../src/core/memdir/index'

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-memdir-'))
}

const sample: MemoryEntry = {
  ts: '2026-04-25T11:30:00Z',
  sessionId: 'abc-123',
  keywords: ['auth', 'bcrypt'],
  score: 0.7,
  body: 'User cares about constant-time bcrypt comparison in src/auth/login.ts.',
}

describe('memdir parser', () => {
  it('parses a single entry', () => {
    const text = formatMemoryEntry(sample)
    const out = parseMemoryFile(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.ts).toBe(sample.ts)
    expect(out[0]!.sessionId).toBe('abc-123')
    expect(out[0]!.keywords).toEqual(['auth', 'bcrypt'])
    expect(out[0]!.score).toBe(0.7)
    expect(out[0]!.body).toContain('bcrypt')
  })

  it('parses multiple entries', () => {
    const a: MemoryEntry = { ...sample, sessionId: 's1' }
    const b: MemoryEntry = { ...sample, sessionId: 's2', keywords: ['lsp'], body: 'second body' }
    const text = formatMemoryFile([a, b])
    const out = parseMemoryFile(text)
    expect(out).toHaveLength(2)
    expect(out[0]!.sessionId).toBe('s1')
    expect(out[1]!.sessionId).toBe('s2')
    expect(out[1]!.body).toBe('second body')
  })

  it('drops entries with malformed YAML', () => {
    const text = `---\nthis is: not [valid yaml: at all\n---\n\nbody\n`
    expect(parseMemoryFile(text)).toEqual([])
  })

  it('drops entries missing required fields', () => {
    const text = `---\nkeywords: [a]\n---\n\nbody\n` // no ts/sessionId
    expect(parseMemoryFile(text)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(parseMemoryFile('')).toEqual([])
    expect(parseMemoryFile('   \n\n')).toEqual([])
  })

  it('round-trips through format + parse', () => {
    const text = formatMemoryFile([sample, { ...sample, sessionId: 's2' }])
    const reparsed = parseMemoryFile(text)
    expect(reparsed).toHaveLength(2)
    expect(reparsed[0]!.body).toBe(sample.body)
  })
})

describe('memdir storage', () => {
  it('memoryPath sits inside ~/.nuka/memory/<sha1>/', () => {
    const p = memoryPath('/proj/foo', '/fake/home')
    expect(p.startsWith('/fake/home/.nuka/memory/')).toBe(true)
    expect(p.endsWith('/MEMORY.md')).toBe(true)
    // Stable across calls
    expect(memoryPath('/proj/foo', '/fake/home')).toBe(p)
    // Different cwd → different path
    expect(memoryPath('/proj/bar', '/fake/home')).not.toBe(p)
  })

  it('loadMemory returns [] when file does not exist', async () => {
    const home = await tmpHome()
    expect(await loadMemory('/some/cwd', home)).toEqual([])
  })

  it('appendMemory creates the file then grows it', async () => {
    const home = await tmpHome()
    await appendMemory('/proj', sample, home)
    let entries = await loadMemory('/proj', home)
    expect(entries).toHaveLength(1)

    await appendMemory('/proj', { ...sample, sessionId: 's2', body: 'second' }, home)
    entries = await loadMemory('/proj', home)
    expect(entries).toHaveLength(2)
    expect(entries[1]!.body).toBe('second')
  })

  it('clearMemory removes the file (loadMemory then sees none)', async () => {
    const home = await tmpHome()
    await appendMemory('/proj', sample, home)
    expect(await loadMemory('/proj', home)).toHaveLength(1)
    await clearMemory('/proj', home)
    expect(await loadMemory('/proj', home)).toEqual([])
  })

  it('writeAllMemory replaces existing entries', async () => {
    const home = await tmpHome()
    await appendMemory('/proj', sample, home)
    await appendMemory('/proj', { ...sample, sessionId: 's2' }, home)
    await writeAllMemory('/proj', [{ ...sample, sessionId: 'sNEW' }], home)
    const entries = await loadMemory('/proj', home)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sessionId).toBe('sNEW')
  })
})
