import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { loadHooks } from '../../../src/core/hooks/loader'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(os.tmpdir(), 'nuka-hooks-loader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadHooks', () => {
  it('returns [] for missing file (ENOENT)', async () => {
    const result = await loadHooks(join(dir, 'nonexistent.json'))
    expect(result).toEqual([])
  })

  it('returns [] for invalid JSON with a warning', async () => {
    await writeFile(join(dir, 'hooks.json'), '{ not json }', 'utf8')
    const result = await loadHooks(join(dir, 'hooks.json'))
    expect(result).toEqual([])
  })

  it('returns [] when top-level hooks key is missing', async () => {
    await writeFile(join(dir, 'hooks.json'), JSON.stringify({ other: [] }), 'utf8')
    const result = await loadHooks(join(dir, 'hooks.json'))
    expect(result).toEqual([])
  })

  it('loads valid entries, skips invalid ones', async () => {
    const content = JSON.stringify({
      hooks: [
        { event: 'beforeToolCall', tool: 'Bash', command: '/path/audit.sh' },
        { event: 'afterTurn', command: 'notify-send done' },
        { event: 'invalidEvent', command: 'foo.sh' },  // invalid event
        { event: 'afterToolCall' },                    // missing command
      ],
    })
    await writeFile(join(dir, 'hooks.json'), content, 'utf8')
    const result = await loadHooks(join(dir, 'hooks.json'))
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ event: 'beforeToolCall', tool: 'Bash', command: '/path/audit.sh' })
    expect(result[1]).toEqual({ event: 'afterTurn', command: 'notify-send done' })
  })

  it('parses optional timeoutMs', async () => {
    const content = JSON.stringify({
      hooks: [{ event: 'afterTurn', command: 'echo hi', timeoutMs: 5000 }],
    })
    await writeFile(join(dir, 'hooks.json'), content, 'utf8')
    const result = await loadHooks(join(dir, 'hooks.json'))
    expect(result[0]!.timeoutMs).toBe(5000)
  })

  it('returns [] for empty hooks array', async () => {
    await writeFile(join(dir, 'hooks.json'), JSON.stringify({ hooks: [] }), 'utf8')
    const result = await loadHooks(join(dir, 'hooks.json'))
    expect(result).toEqual([])
  })
})
