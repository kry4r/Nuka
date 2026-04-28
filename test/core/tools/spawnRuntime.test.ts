// test/core/tools/spawnRuntime.test.ts
import { describe, it, expect } from 'vitest'
import { executeSpawn } from '../../../src/core/tools/spawnRuntime'
import type { Tool, ToolContext } from '../../../src/core/tools/types'

function makeCtx(signal?: AbortSignal): ToolContext {
  return { signal: signal ?? new AbortController().signal, cwd: process.cwd() }
}

function spawnTool<I = unknown>(opts: {
  command: string
  args?: (input: unknown) => string[]
  parseOutput?: (stdout: string) => unknown
  env?: NodeJS.ProcessEnv
}): Tool<I> {
  return {
    name: 'spawned',
    description: 'spawn-runtime',
    parameters: {},
    source: 'builtin',
    tags: ['core'],
    needsPermission: () => 'exec',
    runtime: {
      kind: 'spawn',
      command: opts.command,
      ...(opts.args !== undefined ? { args: opts.args } : {}),
      ...(opts.parseOutput !== undefined ? { parseOutput: opts.parseOutput } : {}),
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    },
    run: async () => ({ output: '', isError: false }),
  }
}

describe('executeSpawn', () => {
  it('captures stdout on happy path', async () => {
    const t = spawnTool({ command: 'echo', args: () => ['hi'] })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output).trim()).toBe('hi')
  })

  it('reports non-zero exit as isError with stderr in output', async () => {
    const t = spawnTool({
      command: 'sh',
      args: () => ['-c', 'echo bad >&2; exit 7'],
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/exit 7/)
    expect(String(r.output)).toMatch(/bad/)
  })

  it('honours abort signal — kills child and returns aborted', async () => {
    const ac = new AbortController()
    const t = spawnTool({ command: 'sh', args: () => ['-c', 'sleep 5'] })
    const p = executeSpawn(t, {}, makeCtx(ac.signal))
    setTimeout(() => ac.abort(), 50)
    const r = await p
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/aborted/i)
  })

  it('runs custom parseOutput and uses returned value', async () => {
    const t = spawnTool({
      command: 'echo',
      args: () => ['raw'],
      parseOutput: (stdout) => ({ text: `parsed:${stdout.trim()}` }),
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(false)
    expect(r.output).toBe('parsed:raw')
  })

  it('parseOutput returning a plain string flows through unchanged', async () => {
    const t = spawnTool({
      command: 'echo',
      args: () => ['x'],
      parseOutput: (stdout) => `prefix:${stdout.trim()}`,
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.output).toBe('prefix:x')
  })

  it('merges env into the spawned process', async () => {
    const t = spawnTool({
      command: 'sh',
      args: () => ['-c', 'echo $NUKA_TEST_VAR'],
      env: { NUKA_TEST_VAR: 'visible' },
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output).trim()).toBe('visible')
  })

  it('returns error when args() throws', async () => {
    const t = spawnTool({
      command: 'echo',
      args: () => { throw new Error('boom') },
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(true)
    expect(String(r.output)).toMatch(/boom/)
  })

  it('returns error when spawn fails (missing binary)', async () => {
    const t = spawnTool({
      command: '/no/such/command/nuka-test-missing',
      args: () => [],
    })
    const r = await executeSpawn(t, {}, makeCtx())
    expect(r.isError).toBe(true)
  })
})
