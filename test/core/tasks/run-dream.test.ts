import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runDream } from '../../../src/core/tasks/run-dream'

describe('runDream', () => {
  it('writes consolidated output to memdir', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-rd-'))
    const fakeFork = vi.fn().mockResolvedValue({ text: 'Consolidated memory entry.' })
    const task = {
      id: 't1',
      kind: 'dream' as const,
      description: 'memdir consolidation',
      state: 'running' as const,
      outputFile: path.join(home, 'out.log'),
      spec: {
        kind: 'dream' as const,
        description: 'memdir consolidation',
        consolidationPrompt: 'Consolidate these entries: ...',
        parentSessionId: 'system',
      },
    }
    const signal = new AbortController().signal
    await runDream(task as any, signal, { home, runFork: fakeFork })
    const memdir = path.join(home, '.nuka', 'memdir')
    const files = fs.readdirSync(memdir).filter(f => f.startsWith('consolidated-'))
    expect(files.length).toBe(1)
    expect(fs.readFileSync(path.join(memdir, files[0]!), 'utf8')).toBe('Consolidated memory entry.')
  })

  it('throws without deps', async () => {
    const task = {
      id: 't1', kind: 'dream' as const, description: 'test',
      state: 'running' as const, outputFile: '/tmp/out.log',
      spec: { kind: 'dream' as const, description: 'test', consolidationPrompt: 'p', parentSessionId: 's' },
    }
    await expect(runDream(task as any, new AbortController().signal)).rejects.toThrow('deps required')
  })

  it('releases lock on completion', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-rd-'))
    const memdir = path.join(home, '.nuka', 'memdir')
    fs.mkdirSync(memdir, { recursive: true })
    // Pre-create lock
    fs.writeFileSync(path.join(memdir, '.dream.lock'), '{}')
    const task = {
      id: 't2', kind: 'dream' as const, description: 'test',
      state: 'running' as const, outputFile: '/tmp/out.log',
      spec: { kind: 'dream' as const, description: 'test', consolidationPrompt: 'p', parentSessionId: 's' },
    }
    await runDream(task as any, new AbortController().signal, { home, runFork: async () => ({ text: 'done' }) })
    expect(fs.existsSync(path.join(memdir, '.dream.lock'))).toBe(false)
  })
})
