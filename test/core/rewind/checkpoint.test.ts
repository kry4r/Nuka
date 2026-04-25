// test/core/rewind/checkpoint.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CheckpointLog,
  captureFileSnapshot,
  filePathsFromToolInput,
} from '../../../src/core/rewind/checkpoint'
import { restore } from '../../../src/core/rewind/restore'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-checkpoint-test-'))
}

describe('filePathsFromToolInput', () => {
  it('returns the path for Write', () => {
    expect(filePathsFromToolInput('Write', { path: '/a/b.txt', content: 'x' })).toEqual(['/a/b.txt'])
  })
  it('returns the path for Edit', () => {
    expect(filePathsFromToolInput('Edit', { path: '/a/b.txt' })).toEqual(['/a/b.txt'])
  })
  it('returns empty for unrelated tools', () => {
    expect(filePathsFromToolInput('Read', { path: '/a/b.txt' })).toEqual([])
    expect(filePathsFromToolInput('Bash', { command: 'rm -rf /' })).toEqual([])
  })
  it('returns empty when path is missing/non-string', () => {
    expect(filePathsFromToolInput('Write', {})).toEqual([])
    expect(filePathsFromToolInput('Write', { path: 123 })).toEqual([])
  })
})

describe('captureFileSnapshot', () => {
  it('returns sha1+bytes for an existing file', async () => {
    const dir = await tmpDir()
    const p = path.join(dir, 'f.txt')
    await fs.writeFile(p, 'hello', 'utf8')
    const snap = await captureFileSnapshot(p)
    expect(snap.path).toBe(p)
    expect(snap.bytes).toBe(5)
    expect(snap.sha1).toMatch(/^[0-9a-f]{40}$/)
  })

  it('returns a zero-byte snapshot for a missing file (no throw)', async () => {
    const snap = await captureFileSnapshot('/nonexistent-nuka-' + Math.random())
    expect(snap.bytes).toBe(0)
    expect(snap.sha1).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('CheckpointLog', () => {
  it('buckets snapshots per turn and per path', () => {
    const log = new CheckpointLog()
    log.record('t1', { path: '/a', sha1: 'a'.repeat(40), bytes: 1, ts: 1 })
    log.record('t1', { path: '/b', sha1: 'b'.repeat(40), bytes: 2, ts: 2 })
    log.record('t2', { path: '/a', sha1: 'c'.repeat(40), bytes: 3, ts: 3 })
    const t1 = log.find('t1')!
    expect(Array.from(t1.files.keys()).sort()).toEqual(['/a', '/b'])
    const t2 = log.find('t2')!
    expect(t2.files.get('/a')?.bytes).toBe(3)
  })

  it('ring-buffers to maxTurns', () => {
    const log = new CheckpointLog({ maxTurns: 2 })
    log.record('a', { path: '/x', sha1: '0'.repeat(40), bytes: 0, ts: 0 })
    log.record('b', { path: '/x', sha1: '0'.repeat(40), bytes: 0, ts: 0 })
    log.record('c', { path: '/x', sha1: '0'.repeat(40), bytes: 0, ts: 0 })
    expect(log.list().map(t => t.turnId)).toEqual(['b', 'c'])
  })
})

describe('restore()', () => {
  it('returns { ok:false, reason:"fileCheckpointing disabled" } when flag is off', async () => {
    const log = new CheckpointLog()
    log.record('t1', { path: '/a', sha1: '0'.repeat(40), bytes: 0, ts: 0 })
    const res = await restore(log, 't1', { fileCheckpointing: false })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('fileCheckpointing disabled')
  })

  it('never touches the filesystem when disabled — even with unknown turn', async () => {
    const log = new CheckpointLog()
    const res = await restore(log, 'bogus', { fileCheckpointing: false })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('fileCheckpointing disabled')
  })

  it('returns a not-yet-implemented skip when flag is on but path is deferred', async () => {
    const log = new CheckpointLog()
    log.record('t1', { path: '/a', sha1: '0'.repeat(40), bytes: 0, ts: 0 })
    const res = await restore(log, 't1', { fileCheckpointing: true })
    expect(res.ok).toBe(false)
  })

  it('returns unknown-turn skip when turnId not in log (flag on)', async () => {
    const log = new CheckpointLog()
    const res = await restore(log, 'nope', { fileCheckpointing: true })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/unknown turn/)
  })
})
